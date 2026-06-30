import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KotikitError } from "../../../util/result.js";
import { createCheckpointStore } from "../checkpoint-store.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-checkpoint-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createCheckpointStore", () => {
  it("writes and reads checkpoints", async () => {
    const store = createCheckpointStore(root);
    const checkpoint = validCheckpoint();

    await store.writeCheckpoint(checkpoint);

    await expect(store.getCheckpoint("run-1")).resolves.toEqual(checkpoint);
  });

  it("rejects run ids that could escape the checkpoint directory", async () => {
    const store = createCheckpointStore(root);

    await expect(
      store.writeCheckpoint({
        runId: "../../escape",
        graphHash: "graph-hash",
        nextNodeIndex: 2,
        savedAt: "2026-06-30T00:00:00.000Z",
      })
    ).rejects.toThrow(KotikitError);
    await expect(store.getCheckpoint("../../escape")).rejects.toThrow(KotikitError);
  });

  it("rejects invalid checkpoint writes", async () => {
    const store = createCheckpointStore(root);

    await expect(
      store.writeCheckpoint({
        ...validCheckpoint(),
        nextNodeIndex: -1,
      })
    ).rejects.toThrow(KotikitError);
  });

  it("rejects invalid persisted checkpoints", async () => {
    const store = createCheckpointStore(root);
    const checkpointDir = join(root, ".kotikit", "checkpoints");
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(
      join(checkpointDir, "run-1.json"),
      `${JSON.stringify({ ...validCheckpoint(), graphHash: "", nextNodeIndex: -1 })}\n`
    );

    await expect(store.getCheckpoint("run-1")).rejects.toThrow(KotikitError);
  });
});

function validCheckpoint() {
  return {
    runId: "run-1",
    graphHash: "graph-hash",
    nextNodeIndex: 2,
    savedAt: "2026-06-30T00:00:00.000Z",
  };
}
