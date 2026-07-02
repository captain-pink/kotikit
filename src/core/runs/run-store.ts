import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KotikitError } from "../../util/result.js";
import type { KotikitGraphState } from "../schemas/graph-state.js";
import { KotikitGraphStateSchema } from "../schemas/graph-state.js";
import { assertSafeLocalId } from "./safe-id.js";

type RunStatus = KotikitGraphState["status"];

export type RunRecord = {
  id: string;
  flowId: string;
  flowVersion: string;
  manifestHash: string;
  graphHash: string;
  stateSchemaVersion: string;
  nodeVersions: Record<string, string>;
  status: RunStatus;
  currentNodeId?: string;
  nextNodeIndex: number;
  state: KotikitGraphState;
  createdAt: string;
  updatedAt: string;
};

export type RunStore = {
  createRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord>;
  updateRunState(
    runId: string,
    patch: Partial<Omit<RunRecord, "id" | "createdAt">>
  ): Promise<RunRecord>;
  listRuns(): Promise<RunRecord[]>;
};

export function createRunStore(root: string): RunStore {
  const runsDir = join(root, ".kotikit", "runs");

  return {
    async createRun(run: RunRecord): Promise<void> {
      assertSafeLocalId("run", run.id);
      await writeJsonAtomic(runPath(runsDir, run.id), normalizeRun(run));
    },
    async getRun(runId: string): Promise<RunRecord> {
      assertSafeLocalId("run", runId);
      try {
        return parseRunJson(await readFile(runPath(runsDir, runId), "utf8"), runId);
      } catch (err) {
        if (err instanceof KotikitError) throw err;
        if ((err as { code?: string }).code === "ENOENT") throw missingRunError(runId);
        throw err;
      }
    },
    async updateRunState(
      runId: string,
      patch: Partial<Omit<RunRecord, "id" | "createdAt">>
    ): Promise<RunRecord> {
      const current = await this.getRun(runId);
      const updated = normalizeRun({
        ...current,
        ...patch,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      });
      await writeJsonAtomic(runPath(runsDir, runId), updated);
      return updated;
    },
    async listRuns(): Promise<RunRecord[]> {
      try {
        const entries = await readdir(runsDir);
        const runs = await Promise.all(
          entries
            .filter((entry) => entry.endsWith(".json"))
            .map(async (entry) =>
              parseRunJson(await readFile(join(runsDir, entry), "utf8"), runIdFromEntry(entry))
            )
        );
        return runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return [];
        throw err;
      }
    },
  };
}

function parseRunJson(json: string, expectedRunId: string): RunRecord {
  assertSafeLocalId("run", expectedRunId);
  try {
    const run = normalizeRun(JSON.parse(json));
    if (run.id !== expectedRunId) {
      throw new KotikitError(
        "This kotikit run has inconsistent metadata.",
        "Run file names must match the persisted run id."
      );
    }
    return run;
  } catch (err) {
    if (err instanceof KotikitError) throw err;
    if (err instanceof SyntaxError) throw invalidRunError();
    throw err;
  }
}

function normalizeRun(raw: unknown): RunRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidRunError();
  }

  const candidate = raw as Partial<RunRecord>;
  const run = {
    id: requireString(candidate.id, "id"),
    flowId: requireString(candidate.flowId, "flowId"),
    flowVersion: requireString(candidate.flowVersion, "flowVersion"),
    manifestHash: requireString(candidate.manifestHash, "manifestHash"),
    graphHash: requireString(candidate.graphHash, "graphHash"),
    stateSchemaVersion: requireString(candidate.stateSchemaVersion, "stateSchemaVersion"),
    nodeVersions: normalizeNodeVersions(candidate.nodeVersions),
    status: normalizeStatus(candidate.status),
    currentNodeId:
      candidate.currentNodeId === undefined
        ? undefined
        : requireString(candidate.currentNodeId, "currentNodeId"),
    nextNodeIndex: requireNumber(candidate.nextNodeIndex, "nextNodeIndex"),
    state: normalizeGraphState(candidate.state),
    createdAt: requireString(candidate.createdAt, "createdAt"),
    updatedAt: requireString(candidate.updatedAt, "updatedAt"),
  };
  assertRunStateMatchesMetadata(run);
  return run;
}

function normalizeNodeVersions(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KotikitError("This kotikit run is missing node version metadata.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, version]) => [key, requireString(version, key)])
  );
}

function normalizeStatus(value: unknown): RunStatus {
  const parsed = KotikitGraphStateSchema.shape.status.safeParse(value);
  if (!parsed.success) {
    throw new KotikitError("This kotikit run has an invalid status.");
  }
  return parsed.data;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new KotikitError(`This kotikit run is missing ${field}.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new KotikitError(`This kotikit run is missing ${field}.`);
  }
  return value;
}

function normalizeGraphState(value: unknown): KotikitGraphState {
  const parsed = KotikitGraphStateSchema.safeParse(value);
  if (!parsed.success) throw invalidRunError();
  return parsed.data;
}

function assertRunStateMatchesMetadata(run: RunRecord): void {
  const expected: Array<[string, string, string]> = [
    ["runId", run.id, run.state.runId],
    ["flowId", run.flowId, run.state.flowId],
    ["flowVersion", run.flowVersion, run.state.flowVersion],
    ["graphHash", run.graphHash, run.state.graphHash],
    ["status", run.status, run.state.status],
    ["schemaVersion", run.stateSchemaVersion, run.state.schemaVersion],
  ];
  const mismatch = expected.find(([_field, metadata, state]) => metadata !== state);
  if (mismatch !== undefined) {
    throw new KotikitError(
      "This kotikit run has inconsistent metadata.",
      `Run metadata field "${mismatch[0]}" must match the embedded graph state.`
    );
  }
}

function missingRunError(runId: string): KotikitError {
  return new KotikitError(
    `I couldn't find kotikit run "${runId}".`,
    "Check the run id or start a new kotikit flow."
  );
}

function invalidRunError(): KotikitError {
  return new KotikitError(
    "This kotikit run has an invalid format.",
    "Delete the run file or start a new kotikit flow."
  );
}

function runIdFromEntry(entry: string): string {
  return entry.slice(0, -".json".length);
}

function runPath(runsDir: string, runId: string): string {
  return join(runsDir, `${assertSafeLocalId("run", runId)}.json`);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpPath, path);
}
