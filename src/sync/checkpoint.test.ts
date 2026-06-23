import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkpointPath } from "../util/paths.js";
import {
  type Checkpoint,
  clearCheckpoint,
  hasCheckpoint,
  readCheckpoint,
  writeCheckpoint,
} from "./checkpoint.js";

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-checkpoint-"));
  tmpDirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function sampleCheckpoint(startedAt: string = new Date().toISOString()): Checkpoint {
  return {
    version: 1,
    startedAt,
    files: [
      { fileKey: "fileA", stage: "components" },
      { fileKey: "fileB", stage: "node_details", cursor: { processed: 100, batchSize: 100 } },
    ],
  };
}

describe("checkpoint", () => {
  it("readCheckpoint returns null when no file exists", async () => {
    const root = mkTmp();
    expect(await readCheckpoint(root)).toBeNull();
    expect(await hasCheckpoint(root)).toBe(false);
  });

  it("write then read round-trips", async () => {
    const root = mkTmp();
    const checkpoint = sampleCheckpoint();
    await writeCheckpoint(root, checkpoint);
    expect(await hasCheckpoint(root)).toBe(true);
    const got = await readCheckpoint(root);
    expect(got).toEqual(checkpoint);
  });

  it("writes to <path>.tmp first, then renames (atomic)", async () => {
    const root = mkTmp();
    const checkpoint = sampleCheckpoint();
    // Pre-seed a sentinel to ensure the real file is replaced, not appended
    const path = checkpointPath(root);
    // Create parent dir manually before writing
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}"); // garbage to be overwritten
    await writeCheckpoint(root, checkpoint);
    // No leftover .tmp
    expect(existsSync(`${path}.tmp`)).toBe(false);
    // Real file has the new content
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.startedAt).toBe(checkpoint.startedAt);
  });

  it("readCheckpoint returns null on malformed JSON", async () => {
    const root = mkTmp();
    // Manually drop garbage
    const path = checkpointPath(root);
    // Make sure the design-system dir exists first
    await writeCheckpoint(root, sampleCheckpoint());
    writeFileSync(path, "not valid json{{{");
    expect(await readCheckpoint(root)).toBeNull();
    // File is untouched (we don't delete on parse failure — just return null)
    expect(existsSync(path)).toBe(true);
  });

  it("readCheckpoint returns null on schema mismatch", async () => {
    const root = mkTmp();
    await writeCheckpoint(root, sampleCheckpoint());
    const path = checkpointPath(root);
    writeFileSync(path, JSON.stringify({ version: 999, files: [] }));
    expect(await readCheckpoint(root)).toBeNull();
  });

  it("readCheckpoint returns null for stale checkpoints", async () => {
    const root = mkTmp();
    await writeCheckpoint(root, sampleCheckpoint("2026-01-01T00:00:00.000Z"));
    const got = await readCheckpoint(root, {
      maxAgeMs: 60_000,
      nowMs: () => Date.parse("2026-01-01T00:02:00.000Z"),
    });
    expect(got).toBeNull();
  });

  it("clearCheckpoint removes the file", async () => {
    const root = mkTmp();
    await writeCheckpoint(root, sampleCheckpoint());
    expect(await hasCheckpoint(root)).toBe(true);
    await clearCheckpoint(root);
    expect(await hasCheckpoint(root)).toBe(false);
  });

  it("clearCheckpoint is a no-op when no file exists", async () => {
    const root = mkTmp();
    await clearCheckpoint(root); // should not throw
    expect(await hasCheckpoint(root)).toBe(false);
  });

  it("writeCheckpoint validates with zod and throws on invalid input", async () => {
    const root = mkTmp();
    // @ts-expect-error - intentionally bad shape
    await expect(writeCheckpoint(root, { version: 2, files: [] })).rejects.toThrow();
  });
});
