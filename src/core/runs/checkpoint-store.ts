import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { KotikitError } from "../../util/result.js";
import { assertSafeLocalId } from "./safe-id.js";

export const CheckpointRecordSchema = z.strictObject({
  runId: z.string().min(1),
  graphHash: z.string().min(1),
  nextNodeIndex: z.number().int().nonnegative(),
  savedAt: z.iso.datetime(),
});

export type CheckpointRecord = {
  runId: string;
  graphHash: string;
  nextNodeIndex: number;
  savedAt: string;
};

export type CheckpointStore = {
  writeCheckpoint(checkpoint: CheckpointRecord): Promise<void>;
  getCheckpoint(runId: string): Promise<CheckpointRecord | null>;
};

export function createCheckpointStore(root: string): CheckpointStore {
  const checkpointDir = join(root, ".kotikit", "checkpoints");

  return {
    async writeCheckpoint(checkpoint: CheckpointRecord): Promise<void> {
      const parsed = parseCheckpointRecord(checkpoint);
      assertSafeLocalId("run", parsed.runId);
      await writeJsonAtomic(checkpointPath(checkpointDir, parsed.runId), parsed);
    },
    async getCheckpoint(runId: string): Promise<CheckpointRecord | null> {
      assertSafeLocalId("run", runId);
      try {
        return parseCheckpointRecord(
          JSON.parse(await readFile(checkpointPath(checkpointDir, runId), "utf8"))
        );
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return null;
        if (err instanceof KotikitError) throw err;
        if (err instanceof SyntaxError) {
          throw new KotikitError(
            "This kotikit checkpoint has an invalid format.",
            "Delete the checkpoint file or restart the flow."
          );
        }
        throw err;
      }
    },
  };
}

function checkpointPath(checkpointDir: string, runId: string): string {
  return join(checkpointDir, `${assertSafeLocalId("run", runId)}.json`);
}

function parseCheckpointRecord(raw: unknown): CheckpointRecord {
  try {
    return CheckpointRecordSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new KotikitError(
        "This kotikit checkpoint has an invalid format.",
        "Delete the checkpoint file or restart the flow."
      );
    }
    throw err;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpPath, path);
}
