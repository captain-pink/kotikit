#!/usr/bin/env bun
/**
 * Measure the response size of each kotikit MCP tool against a fixture project.
 *
 * Usage:   bun run scripts/measure-tokens.ts
 *
 * Prints a TSV table:
 *   tool                                            bytes   ~tokens
 *   kotikit_spec_list                                 412       108
 *   kotikit_scaffold_start (3 components, compact)   1234       325
 *   ...
 *
 * Re-run after changing tool payloads. Paste the output into docs/TOKENS.md.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import simpleGit from "simple-git";

import { registerSpecTools } from "../src/mcp/tools/spec.js";
import { registerConfigTools } from "../src/mcp/tools/config.js";
import { registerFlowTools } from "../src/mcp/tools/flow.js";
import { registerBrainstormTools } from "../src/mcp/tools/brainstorm.js";
import { registerDsSearchTools } from "../src/mcp/tools/ds-search.js";
import { registerIconsSearchTools } from "../src/mcp/tools/icons-search.js";
import { registerPlanCodeTools } from "../src/mcp/tools/plan-code.js";
import { registerImplementCodeTools } from "../src/mcp/tools/implement-code.js";
import { registerRegistryTools } from "../src/mcp/tools/registry.js";
import { registerScaffoldTools } from "../src/mcp/tools/scaffold.js";
import { registerPlanDesignTools } from "../src/mcp/tools/plan-design.js";
import { registerDesignScreenTools } from "../src/mcp/tools/design-screen.js";
import { registerDesignApplyTools } from "../src/mcp/tools/design-apply.js";
import { registerAuditTools } from "../src/mcp/tools/audit.js";
import { registerSystemPromptTools } from "../src/mcp/tools/system-prompt.js";

import { loadConfig, writeConfig } from "../src/config/load.js";
import { defaultConfig } from "../src/config/schema.js";
import type { ToolContext } from "../src/mcp/context.js";
import type { ToolRegistry } from "../src/mcp/server.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { openDb } from "../src/db/sqlite.js";
import { initRegistryDb, upsertRegistry } from "../src/db/registry-db.js";
import { registryDbPath, componentsDbPath } from "../src/util/paths.js";
import { initComponentsDb, upsertComponent } from "../src/db/components-db.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function buildRegistry(root: string): ToolRegistry {
  const tools: Tool[] = [];
  const handlers = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const registry: ToolRegistry = { tools, handlers };
  const ctx: ToolContext = { root, loadConfig: () => loadConfig(root) };
  registerConfigTools(registry, ctx);
  registerSpecTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerDsSearchTools(registry, ctx);
  registerIconsSearchTools(registry, ctx);
  registerPlanCodeTools(registry, ctx);
  registerImplementCodeTools(registry, ctx);
  registerRegistryTools(registry, ctx);
  registerScaffoldTools(registry, ctx);
  registerPlanDesignTools(registry, ctx);
  registerDesignScreenTools(registry, ctx);
  registerDesignApplyTools(registry, ctx);
  registerAuditTools(registry, ctx);
  registerSystemPromptTools(registry, ctx);
  return registry;
}

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
    variants: variantAxes.map(a => ({ propertyName: a, values: ["primary", "secondary"] })),
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

function seedDsRegistry(root: string, name: string): void {
  const db = openDb(registryDbPath(root));
  initRegistryDb(db);
  upsertRegistry(db, {
    kind: "component", name,
    dsPath: `components/${name.toLowerCase()}.json`,
    codePath: null,
    status: "design-only",
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
    seedDsRegistry(root, name);
  }

  // Seed a single-screen spec via spec_create through the tool
  const registry = buildRegistry(root);
  await callTool(registry, "kotikit_spec_create", {
    draft: {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "User profile screen.",
        functional: ["Display name and avatar"],
        states: { default: "Shown", loading: "Spinner", empty: "No data", error: "Error", filled: "Full data" },
        components: [{ name: "Button" }, { name: "Card" }],
        acceptanceCriteria: ["renders", "edit button works"],
      },
    },
  });
  // Plan + design plan for design_get_screen measurement
  await callTool(registry, "kotikit_plan_code", { scope: "profile-page" });
  await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });

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

async function measure(registry: ToolRegistry, name: string, args: unknown, label = name): Promise<Row> {
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
  const registry = buildRegistry(root);

  const rows: Row[] = [];

  // Phase 1
  rows.push(await measure(registry, "kotikit_config_status", {}));
  rows.push(await measure(registry, "kotikit_config_get", {}));
  rows.push(await measure(registry, "kotikit_spec_list", {}));
  rows.push(await measure(registry, "kotikit_spec_get", { scope: "profile-page" }));
  rows.push(await measure(registry, "kotikit_brainstorm_start", { idea: "a profile page" }, "kotikit_brainstorm_start (Phase 6 ref)"));

  // Phase 2
  rows.push(await measure(registry, "kotikit_ds_search", { query: "but*" }));
  rows.push(await measure(registry, "kotikit_icons_search", { query: "arrow*" }));
  rows.push(await measure(registry, "kotikit_ds_get_component", { path: "components/button.json" }));

  // Phase 3 — measure BOTH default (lazy) AND expand=true
  rows.push(await measure(registry, "kotikit_implement_code_start", { scope: "profile-page" }, "kotikit_implement_code_start (default: refs)"));
  rows.push(await measure(registry, "kotikit_implement_code_start", { scope: "profile-page", expand: true }, "kotikit_implement_code_start (expand: full)"));
  rows.push(await measure(registry, "kotikit_plan_code", { scope: "profile-page" }));

  // Phase 4 — measure BOTH default (compact, pageSize 3) AND expand
  rows.push(await measure(registry, "kotikit_scaffold_start", {}, "kotikit_scaffold_start (default: compact, pageSize 3)"));
  rows.push(await measure(registry, "kotikit_scaffold_start", { compact: false, pageSize: 3 }, "kotikit_scaffold_start (full dsJson, pageSize 3)"));

  rows.push(await measure(registry, "kotikit_registry_search", { kind: "component" }));

  // Phase 5
  rows.push(await measure(registry, "kotikit_plan_design", { scope: "profile-page" }));
  rows.push(await measure(registry, "kotikit_design_get_screen", { scope: "profile-page" }));

  // Phase 6
  rows.push(await measure(registry, "kotikit_audit", {}));
  rows.push(await measure(registry, "kotikit_get_system_prompt", { kind: "react" }));
  rows.push(await measure(registry, "kotikit_get_system_prompt", { kind: "brainstorm" }));

  // Print table
  const labelWidth = Math.max(...rows.map(r => r.tool.length), 32);
  console.log("");
  console.log(`${"tool".padEnd(labelWidth)}  ${"bytes".padStart(8)}  ${"~tokens".padStart(8)}  notes`);
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
