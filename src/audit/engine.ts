import type { Database } from "bun:sqlite";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { searchRegistry, type RegistryRow } from "../db/registry-db.js";
import { ComponentJsonSchema } from "../sync/component-shape.js";
import { designSystemDir } from "../util/paths.js";
import { nowIso } from "../util/ids.js";
import { AuditReportSchema, type AuditReport, type AuditEntry } from "./schema.js";

export interface RunAuditOpts {
  root: string;
  registryDb: Database;
}

/**
 * Walk component-kind registry rows and classify each into
 * synced-ok / synced-mismatched / design-only / code-only.
 *
 * For synced rows, compare variant axis names between DS JSON and the code .tsx
 * via a regex over the cva(...) block.
 */
export async function runAudit(opts: RunAuditOpts): Promise<AuditReport> {
  const rows = searchRegistry(opts.registryDb, { kind: "component", limit: 1000 });

  const entries: AuditEntry[] = [];
  let syncedOk = 0;
  let syncedMismatched = 0;
  let designOnly = 0;
  let codeOnly = 0;

  for (const row of rows) {
    const entry = await classifyRow(opts.root, row);
    entries.push(entry);
    switch (entry.outcome) {
      case "synced-ok": syncedOk++; break;
      case "synced-mismatched": syncedMismatched++; break;
      case "design-only": designOnly++; break;
      case "code-only": codeOnly++; break;
    }
  }

  const report: AuditReport = {
    version: 1,
    ranAt: nowIso(),
    summary: { syncedOk, syncedMismatched, designOnly, codeOnly },
    entries,
  };
  return AuditReportSchema.parse(report);
}

async function classifyRow(root: string, row: RegistryRow): Promise<AuditEntry> {
  const dsPath = row.dsPath;
  const codePath = row.codePath;

  // Pure design-only / code-only
  if (dsPath && !codePath) {
    return { name: row.name, outcome: "design-only", dsPath, codePath: null };
  }
  if (!dsPath && codePath) {
    return { name: row.name, outcome: "code-only", dsPath: null, codePath };
  }
  if (!dsPath && !codePath) {
    // Defensive: degenerate row. Treat as design-only (the registry shouldn't permit this).
    return { name: row.name, outcome: "design-only", dsPath: null, codePath: null };
  }

  // Both present — compare variants.
  // dsPath is relative to design-system/; codePath is relative to project root.
  const dsAbs = `${designSystemDir(root)}/${dsPath}`;
  const codeAbs = join(root, codePath as string);

  // File-existence reclassification per plan: if DS JSON missing → code-only;
  // if code file missing → design-only.
  if (!existsSync(dsAbs)) {
    return { name: row.name, outcome: "code-only", dsPath: null, codePath };
  }
  if (!existsSync(codeAbs)) {
    return { name: row.name, outcome: "design-only", dsPath, codePath: null };
  }

  // Parse DS JSON and extract variant axis names (lowercased)
  let dsVariantAxes: string[];
  try {
    const text = await readFile(dsAbs, "utf-8");
    const parsed = ComponentJsonSchema.parse(JSON.parse(text));
    dsVariantAxes = parsed.variants.map(v => v.propertyName.toLowerCase()).sort();
  } catch {
    // Treat unparseable DS JSON as missing — code-only.
    return { name: row.name, outcome: "code-only", dsPath: null, codePath };
  }

  // Extract code variant axes via regex over the cva(...) block
  let codeVariantAxes: string[];
  try {
    const codeText = await readFile(codeAbs, "utf-8");
    codeVariantAxes = extractCvaVariantKeys(codeText).sort();
  } catch {
    return { name: row.name, outcome: "design-only", dsPath, codePath: null };
  }

  // Compare sets
  const dsSet = new Set(dsVariantAxes);
  const codeSet = new Set(codeVariantAxes);
  const dsOnly = dsVariantAxes.filter(v => !codeSet.has(v));
  const codeOnly = codeVariantAxes.filter(v => !dsSet.has(v));

  if (dsOnly.length === 0 && codeOnly.length === 0) {
    return { name: row.name, outcome: "synced-ok", dsPath, codePath };
  }
  return {
    name: row.name,
    outcome: "synced-mismatched",
    dsPath,
    codePath,
    variantDelta: { dsOnly, codeOnly },
  };
}

/**
 * Extract variant axis keys from a `cva(<base>, { variants: { <key>: {...}, ... } })` call.
 * Returns lowercased keys. Returns [] if no cva block found.
 *
 * Strategy: locate the "variants:" token, then use brace-counting to extract the
 * full variants object body, then match top-level `<key>: {` patterns within it.
 * This handles both single-line and multi-line cva calls.
 */
function extractCvaVariantKeys(source: string): string[] {
  // Find the start of the variants object after "variants:"
  const variantsKeyMatch = /variants\s*:\s*\{/g.exec(source);
  if (!variantsKeyMatch) return [];

  // The index right after the opening brace of the variants object
  const bodyStart = variantsKeyMatch.index + variantsKeyMatch[0].length;

  // Walk forward counting braces to find the matching close brace
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }

  if (depth !== 0) return []; // unbalanced — bail out

  // The variants object body (between the outer braces)
  const block = source.slice(bodyStart, i - 1);
  return parseTopLevelKeys(block);
}

/**
 * Extract top-level keys from a variants object body.
 * A top-level key is an identifier followed by `: {` where the `{` is at depth 0
 * within the block. We use brace-counting to skip nested objects and only collect
 * keys that appear at the top level.
 */
function parseTopLevelKeys(block: string): string[] {
  const keys: string[] = [];
  // Match identifier: { at the current depth-0 position
  const keyRe = /(?:^|[\s,\n])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(block)) !== null) {
    // Verify this { is at depth 0 by counting braces in the block up to this match
    const upTo = m.index;
    let depth = 0;
    for (let i = 0; i < upTo; i++) {
      if (block[i] === "{") depth++;
      else if (block[i] === "}") depth--;
    }
    if (depth === 0) {
      keys.push(m[1]!.toLowerCase());
    }
  }
  return Array.from(new Set(keys));
}
