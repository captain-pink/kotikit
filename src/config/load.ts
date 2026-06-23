import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { configPath } from "../util/paths";
import { KotikitError } from "../util/result";
import type { Config } from "./schema";
import { parseConfig } from "./schema";

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

type SpawnFn = (cmd: string[]) => Promise<{ stdout: string; exitCode: number }>;

/**
 * Internal helper — exported only so tests can inject a stub spawn function.
 * Resolve secret references in a token string:
 * - "${ENV_VAR}" → process.env.ENV_VAR (undefined if not set)
 * - "op://…"    → shells out to `op read <value>`, strips trailing newline
 * - Plain string → returned unchanged
 * - undefined   → undefined
 */
export async function resolveSecretImpl(
  value: string | undefined,
  spawn: SpawnFn
): Promise<string | undefined> {
  if (value === undefined) return undefined;

  const envMatch = value.match(/^\$\{([^}]+)\}$/);
  if (envMatch) return process.env[envMatch[1]];

  if (value.startsWith("op://")) {
    try {
      const result = await spawn(["op", "read", value]);
      if (result.exitCode !== 0) return undefined;
      return result.stdout.replace(/\r?\n$/, ""); // strip trailing newline
    } catch {
      return undefined; // op not installed / failed — graceful fallback
    }
  }

  return value; // plain string
}

/** Default spawn implementation using Bun.spawn. */
async function bunSpawn(cmd: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { stdout, exitCode };
}

/**
 * Resolve secret references in a token string.
 * - "${ENV_VAR}" → process.env.ENV_VAR (undefined if not set)
 * - "op://…"    → resolved via `op read` CLI
 * - Plain string → returned unchanged
 * - undefined   → undefined
 */
export async function resolveSecret(value: string | undefined): Promise<string | undefined> {
  return resolveSecretImpl(value, bunSpawn);
}
