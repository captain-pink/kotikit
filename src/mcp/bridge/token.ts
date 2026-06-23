import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const BridgeConfigSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1024).max(65535),
  token: z.string().min(12),
  projectRoot: z.string(),
  projectName: z.string(),
  startedAt: z.string(),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

/** Path inline (avoids dep on src/util/paths.ts P5-A2 work). */
const bridgePath = (root: string): string => `${root}/.kotikit/bridge.json`;

/**
 * Generate a URL-safe 12-character token.
 * Uses crypto.randomUUID() → strips dashes → takes first 12 hex chars.
 * Result is always lowercase hexadecimal [a-z0-9].
 */
export function generateBridgeToken(): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  return raw.slice(0, 12);
}

/** Atomic write: writeFile to <path>.tmp + rename, so a kill mid-write cannot corrupt. */
export async function writeBridgeConfig(root: string, cfg: BridgeConfig): Promise<void> {
  BridgeConfigSchema.parse(cfg); // validate before writing
  const path = bridgePath(root);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
  await rename(tmp, path);
}

/** Read + parse. Returns null on missing or malformed (no throw). */
export async function readBridgeConfig(root: string): Promise<BridgeConfig | null> {
  const path = bridgePath(root);
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, "utf-8");
    const raw = JSON.parse(text);
    const result = BridgeConfigSchema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

/** Remove the bridge config file. No-op if absent. */
export async function clearBridgeConfig(root: string): Promise<void> {
  const path = bridgePath(root);
  if (existsSync(path)) await unlink(path);
}
