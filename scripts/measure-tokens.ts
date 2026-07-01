#!/usr/bin/env bun

/**
 * Measure the response size of each kotikit MCP tool against a fixture project.
 *
 * Usage:   bun run scripts/measure-tokens.ts
 *
 * Prints a TSV table:
 *   tool                                            bytes   ~tokens
 *   kotikit_flow_list                                 412       108
 *   kotikit_start                                    1234       325
 *   ...
 *
 * Re-run after changing tool payloads. Paste the output into docs/TOKENS.md.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { writeConfig } from "../src/config/load.js";
import { defaultConfig } from "../src/config/schema.js";
import { initComponentsDb, upsertComponent } from "../src/db/components-db.js";
import { openDb } from "../src/db/sqlite.js";
import { buildServer, type ToolRegistry } from "../src/mcp/server.js";
import { componentsDbPath } from "../src/util/paths.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function callTool(registry: ToolRegistry, name: string, args: unknown): Promise<ToolResult> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`Tool not found: ${name}`);
  return handler(args);
}

function seedNodeModules(root: string): void {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  for (const t of ["tsc", "eslint", "prettier", "vitest"]) {
    writeFileSync(join(bin, t), "#!/bin/sh\n");
  }
}

function seedDsComponent(root: string, name: string, variantAxes: string[]): void {
  const slug = name.toLowerCase();
  const dir = `${root}/design-system/components`;
  mkdirSync(dir, { recursive: true });
  const json = {
    name,
    key: `k-${slug}`,
    fileKey: "f",
    path: `components/${slug}.json`,
    variants: variantAxes.map((a) => ({ propertyName: a, values: ["primary", "secondary"] })),
    properties: { Disabled: { type: "BOOLEAN" as const } },
    updatedAt: "2026-05-29T00:00:00.000Z",
  };
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(json, null, 2));

  // Also seed components.db row
  const db = openDb(componentsDbPath(root));
  initComponentsDb(db);
  upsertComponent(db, {
    name,
    path: `components/${slug}.json`,
    key: `k-${slug}`,
    fileKey: "f",
    props: variantAxes.join(" "),
  });
  db.close();
}

async function setupFixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "kotikit-measure-"));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Measure");
  seedNodeModules(root);

  // Init config (so kotikit_config_status returns initialized: true)
  const cfg = defaultConfig();
  await writeConfig(root, cfg);

  // Seed 3 DS components
  for (const name of ["Button", "Card", "Input"]) {
    seedDsComponent(root, name, ["Variant", "Size"]);
  }

  return root;
}

interface Row {
  tool: string;
  bytes: number;
  notes?: string;
}

function bytesToTokens(bytes: number): number {
  // Anthropic-ish heuristic: ~3.8 bytes per token for JSON-ish payloads
  return Math.round(bytes / 3.8);
}

async function measure(
  registry: ToolRegistry,
  name: string,
  args: unknown,
  label = name
): Promise<Row> {
  try {
    const result = await callTool(registry, name, args);
    const bytes = Buffer.byteLength(JSON.stringify(result), "utf-8");
    return { tool: label, bytes };
  } catch (err) {
    return { tool: label, bytes: 0, notes: `error: ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  const root = await setupFixture();
  const registry = buildServer({ root }).registry;

  const rows: Row[] = [];

  rows.push(await measure(registry, "kotikit_config_status", {}));
  rows.push(await measure(registry, "kotikit_config_get", {}));
  rows.push(await measure(registry, "kotikit_flow_list", {}));
  rows.push(await measure(registry, "kotikit_flow_validate", { flowId: "create-screen" }));

  const start = await measure(
    registry,
    "kotikit_start",
    { flowId: "create-screen", input: { userIntent: "Create a profile page." } },
    "kotikit_start (create-screen)"
  );
  rows.push(start);
  rows.push(await measure(registry, "kotikit_list_artifacts", {}, "kotikit_list_artifacts (all)"));
  rows.push(await measure(registry, "kotikit_doctor", {}));
  rows.push(await measure(registry, "kotikit_ds_search", { query: "but*" }));
  rows.push(await measure(registry, "kotikit_search_design_system", { query: "but*" }));
  rows.push(await measure(registry, "kotikit_icons_search", { query: "arrow*" }));
  rows.push(
    await measure(registry, "kotikit_ds_get_component", { path: "components/button.json" })
  );
  rows.push(await measure(registry, "kotikit_get_system_prompt", { kind: "brainstorm" }));

  // Print table
  const labelWidth = Math.max(...rows.map((r) => r.tool.length), 32);
  console.log("");
  console.log(
    `${"tool".padEnd(labelWidth)}  ${"bytes".padStart(8)}  ${"~tokens".padStart(8)}  notes`
  );
  console.log(`${"-".repeat(labelWidth)}  ${"-".repeat(8)}  ${"-".repeat(8)}  ${"-".repeat(8)}`);
  for (const r of rows) {
    console.log(
      `${r.tool.padEnd(labelWidth)}  ${String(r.bytes).padStart(8)}  ${String(bytesToTokens(r.bytes)).padStart(8)}  ${r.notes ?? ""}`
    );
  }
  console.log("");

  // Cleanup
  rmSync(root, { recursive: true, force: true });
}

await main();
