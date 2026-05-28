import { z } from "zod";
import { readFile, writeFile, rename, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { checkpointPath } from "../util/paths.js";

export const CheckpointStageSchema = z.enum([
  "metadata",
  "components",
  "component_sets",
  "styles",
  "variables",
  "node_details",
  "icons",
  "done",
]);
export type CheckpointStage = z.infer<typeof CheckpointStageSchema>;

export const FileCheckpointSchema = z.object({
  fileKey: z.string(),
  stage: CheckpointStageSchema,
  cursor: z
    .object({
      processed: z.number().int().nonnegative(),
      batchSize: z.number().int().positive(),
    })
    .optional(),
});
export type FileCheckpoint = z.infer<typeof FileCheckpointSchema>;

export const CheckpointSchema = z.object({
  version: z.literal(1),
  startedAt: z.string(),
  files: z.array(FileCheckpointSchema),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

/**
 * Read the checkpoint, returning null if absent or malformed.
 * A malformed checkpoint logs to stderr and returns null — never throws.
 */
export async function readCheckpoint(root: string): Promise<Checkpoint | null> {
  const path = checkpointPath(root);
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, "utf-8");
    const raw = JSON.parse(text);
    const result = CheckpointSchema.safeParse(raw);
    if (!result.success) {
      process.stderr.write("[kotikit] discarding malformed checkpoint\n");
      return null;
    }
    return result.data;
  } catch {
    process.stderr.write("[kotikit] discarding malformed checkpoint\n");
    return null;
  }
}

/**
 * Atomically write the checkpoint:
 *   writeFile(path + ".tmp", json)
 *   rename(path + ".tmp", path)
 * so a process kill mid-write cannot corrupt the real file.
 */
export async function writeCheckpoint(
  root: string,
  cp: Checkpoint
): Promise<void> {
  const path = checkpointPath(root);
  // Validate before writing
  CheckpointSchema.parse(cp);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(cp, null, 2) + "\n", "utf-8");
  await rename(tmpPath, path);
}

/** Remove the checkpoint file if it exists. No-op if absent. */
export async function clearCheckpoint(root: string): Promise<void> {
  const path = checkpointPath(root);
  if (existsSync(path)) await unlink(path);
}

/** True if a checkpoint file exists on disk. */
export async function hasCheckpoint(root: string): Promise<boolean> {
  return existsSync(checkpointPath(root));
}
