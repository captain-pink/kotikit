import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { manifestPath } from "../util/paths.js";

export const SyncManifestSchema = z.object({
  version: z.literal(1),
  lastSyncAt: z.string(),
  files: z.array(z.object({
    key: z.string(),
    name: z.string(),
    componentCount: z.number().int().nonnegative(),
    iconCount: z.number().int().nonnegative(),
  })),
  conflicts: z.array(z.object({
    name: z.string(),
    winnerFileKey: z.string(),
    losers: z.array(z.object({
      fileKey: z.string(),
      key: z.string(),
    })),
  })).default([]),
});
export type SyncManifest = z.infer<typeof SyncManifestSchema>;

export async function writeManifest(root: string, manifest: SyncManifest): Promise<void> {
  SyncManifestSchema.parse(manifest);
  const path = manifestPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}
