import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { parseConfig } from "./schema";
import type { Config } from "./schema";
import { configPath } from "../util/paths";
import { KotikitError } from "../util/result";

/** Returns the resolved Config, or null if .kotikit/config.json does not exist. */
export async function loadConfig(root: string): Promise<Config | null> {
  const path = configPath(root);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    const text = await readFile(path, "utf-8");
    raw = JSON.parse(text);
  } catch {
    throw new KotikitError(
      "The kotikit config file could not be read.",
      `Check that ${configPath(root)} is valid JSON.`
    );
  }
  return parseConfig(raw);
}

/** Returns true if .kotikit/config.json exists. */
export async function configExists(root: string): Promise<boolean> {
  return existsSync(configPath(root));
}

/** Write a Config to .kotikit/config.json (creates .kotikit/ dir if needed). */
export async function writeConfig(root: string, config: Config): Promise<void> {
  const path = configPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Resolve secret references in a token string.
 * - "${ENV_VAR}" → process.env.ENV_VAR (undefined if not set)
 * - "op://…" → returned unchanged (Phase 2 wires `op read`)
 * - Plain string → returned unchanged
 * - undefined → undefined
 */
export function resolveSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const envMatch = value.match(/^\$\{([^}]+)\}$/);
  if (envMatch) {
    return process.env[envMatch[1]];
  }
  return value; // op:// or plain string: return as-is
}
