import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KotikitError } from "../../../util/result.js";
import { createRunStore, type RunRecord } from "../run-store.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-run-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createRunStore", () => {
  it("creates, reads, updates, and lists runs", async () => {
    const store = createRunStore(root);
    const run = fixtureRun();

    await store.createRun(run);
    await expect(store.getRun(run.id)).resolves.toEqual(run);

    await store.updateRunState(run.id, {
      status: "waiting-for-user",
      nextNodeIndex: 2,
      state: {
        ...run.state,
        status: "waiting-for-user",
        pendingQuestion: { id: "q1", prompt: "What screen should I draft?" },
      },
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      id: run.id,
      status: "waiting-for-user",
      nextNodeIndex: 2,
      state: {
        status: "waiting-for-user",
        pendingQuestion: { id: "q1" },
      },
    });
    await expect(store.listRuns()).resolves.toHaveLength(1);
  });

  it("rejects run ids that could escape the run directory", async () => {
    const store = createRunStore(root);

    await expect(store.createRun({ ...fixtureRun(), id: "../../escape" })).rejects.toThrow(
      KotikitError
    );
    await expect(store.getRun("../../escape")).rejects.toThrow(KotikitError);
  });

  it("rejects run records whose metadata disagrees with graph state", async () => {
    const store = createRunStore(root);
    const run = fixtureRun();

    await expect(
      store.createRun({
        ...run,
        state: { ...run.state, runId: "different-run" },
      })
    ).rejects.toThrow(KotikitError);
    await expect(
      store.createRun({
        ...run,
        state: { ...run.state, graphHash: "different-graph-hash" },
      })
    ).rejects.toThrow(KotikitError);
    await expect(
      store.createRun({
        ...run,
        state: { ...run.state, status: "waiting-for-user" },
      })
    ).rejects.toThrow(KotikitError);
  });

  it("wraps invalid persisted run records in friendly errors", async () => {
    const store = createRunStore(root);
    const runsDir = join(root, ".kotikit", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "run-1.json"), "{ malformed json\n");

    await expect(store.getRun("run-1")).rejects.toThrow("invalid format");
    await expect(store.listRuns()).rejects.toThrow(KotikitError);
  });

  it("rejects persisted runs whose file id disagrees with the record id", async () => {
    const store = createRunStore(root);
    const runsDir = join(root, ".kotikit", "runs");
    const run = fixtureRun();
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "run-1.json"),
      `${JSON.stringify({
        ...run,
        id: "other-run",
        state: { ...run.state, runId: "other-run" },
      })}\n`
    );

    await expect(store.getRun("run-1")).rejects.toThrow(KotikitError);
    await expect(store.listRuns()).rejects.toThrow(KotikitError);
  });

  it("rejects persisted runs with malformed current node metadata", async () => {
    const store = createRunStore(root);
    const runsDir = join(root, ".kotikit", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "run-1.json"),
      `${JSON.stringify({ ...fixtureRun(), currentNodeId: 123 })}\n`
    );

    await expect(store.getRun("run-1")).rejects.toThrow(KotikitError);
  });
});

function fixtureRun(): RunRecord {
  return {
    id: "run-1",
    flowId: "fixture-flow",
    flowVersion: "1.0.0",
    manifestHash: "manifest-hash",
    graphHash: "graph-hash",
    stateSchemaVersion: "KotikitGraphState/v1",
    nodeVersions: { "fixture.start": "1.0.0" },
    status: "running",
    nextNodeIndex: 0,
    state: {
      schemaVersion: "KotikitGraphState/v1",
      runId: "run-1",
      flowId: "fixture-flow",
      flowVersion: "1.0.0",
      graphHash: "graph-hash",
      status: "running",
      project: { root },
      artifacts: [],
      errors: [],
    },
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  };
}
