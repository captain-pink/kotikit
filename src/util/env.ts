import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface LoadDotEnvOptions {
  /** Replace existing process.env keys only when their current value is empty. */
  overrideEmpty?: boolean;
}

/**
 * Parse a .env file's contents into a Record<string, string>.
 * Supports:
 *   - KEY=VALUE lines
 *   - export KEY=VALUE
 *   - # comments (full-line only)
 *   - blank lines
 *   - single- and double-quoted values (quotes stripped, no escaping in V1)
 * Unsupported (silently ignored): variable interpolation (${VAR} inside values), multi-line values.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Allow "export KEY=VALUE"
    const stripped = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue; // skip invalid identifiers
    let value = stripped.slice(eq + 1).trim();
    // Strip surrounding single or double quotes (no escaping in V1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load <root>/.env into process.env, WITHOUT clobbering keys that already exist.
 * When overrideEmpty is true, empty placeholders such as FIGMA_TOKEN= can be
 * refreshed from a later .env edit without replacing non-empty shell values.
 * No-op if the file is missing or unreadable.
 * Returns the set of keys that were freshly injected (for diagnostics / tests).
 */
export async function loadDotEnv(root: string, options: LoadDotEnvOptions = {}): Promise<string[]> {
  const path = `${root}/.env`;
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const parsed = parseDotEnv(text);
  return Object.entries(parsed)
    .filter(([key]) => {
      const existing = process.env[key];
      return existing === undefined || (options.overrideEmpty === true && existing === "");
    })
    .map(([key, value]) => {
      process.env[key] = value;
      return key;
    });
}
