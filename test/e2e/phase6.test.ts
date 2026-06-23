import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import { AuditReportSchema } from "../../src/audit/schema.js";
import type { runGates as defaultRunGates } from "../../src/codegen/gate-runner.js";
import { loadConfig, writeConfig } from "../../src/config/load.js";
import { defaultConfig } from "../../src/config/schema.js";
import { initRegistryDb, upsertRegistry } from "../../src/db/registry-db.js";
import { openDb } from "../../src/db/sqlite.js";
import type { ToolContext } from "../../src/mcp/context.js";
import type { ToolRegistry } from "../../src/mcp/server.js";
import { registerAuditTools } from "../../src/mcp/tools/audit.js";
import { registerBrainstormTools } from "../../src/mcp/tools/brainstorm.js";
import { registerConfigTools } from "../../src/mcp/tools/config.js";
import { registerFlowTools } from "../../src/mcp/tools/flow.js";
import { registerImplementCodeTools } from "../../src/mcp/tools/implement-code.js";
import { registerPlanCodeTools } from "../../src/mcp/tools/plan-code.js";
import { registerRegistryTools } from "../../src/mcp/tools/registry.js";
import { registerScaffoldTools } from "../../src/mcp/tools/scaffold.js";
import { registerSpecTools } from "../../src/mcp/tools/spec.js";
import { registerSystemPromptTools } from "../../src/mcp/tools/system-prompt.js";
import { registryDbPath } from "../../src/util/paths.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-phase6-"));
  tmpDirs.push(d);
  return d;
}

afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[]; isError?: boolean };

function buildRegistry(root: string, gateRunner?: typeof defaultRunGates): ToolRegistry {
  const tools: Tool[] = [];
  const handlers = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const registry: ToolRegistry = { tools, handlers };
  const ctx: ToolContext = { root, loadConfig: () => loadConfig(root) };
  registerConfigTools(registry, ctx);
  registerSpecTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerPlanCodeTools(registry, ctx);
  registerImplementCodeTools(registry, ctx, gateRunner ? { gateRunner } : {});
  registerRegistryTools(registry, ctx);
  registerScaffoldTools(registry, ctx, gateRunner ? { gateRunner } : {});
  registerAuditTools(registry, ctx);
  registerSystemPromptTools(registry, ctx);
  return registry;
}

async function callTool(registry: ToolRegistry, name: string, args: unknown): Promise<ToolResult> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`Tool not found: ${name}`);
  return handler(args);
}

function parseDetail(text: string): unknown {
  const i = text.indexOf("\n\n");
  if (i === -1) return {};
  return JSON.parse(text.slice(i + 2));
}

function parseToolDetail(result: ToolResult): unknown {
  const text = result.content[0]?.text;
  if (text === undefined) throw new Error("Expected tool result text.");
  return parseDetail(text);
}

function seedBins(root: string): void {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  for (const t of ["tsc", "eslint", "prettier", "vitest"])
    writeFileSync(join(bin, t), "#!/bin/sh\n");
}

async function setupRepo(): Promise<string> {
  const tmp = mkTmp();
  const git = simpleGit(tmp);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test Runner");
  seedBins(tmp);
  const cfg = defaultConfig();
  cfg.git.autoCommit = true;
  await writeConfig(tmp, cfg);
  return tmp;
}

function seedDsComponent(root: string, name: string, axes: string[]): void {
  const slug = name.toLowerCase();
  const dir = `${root}/design-system/components`;
  mkdirSync(dir, { recursive: true });
  const json = {
    name,
    key: `k-${slug}`,
    fileKey: "f",
    path: `components/${slug}.json`,
    variants: axes.map((a) => ({ propertyName: a, values: ["primary"] })),
    properties: {},
    updatedAt: "2026-05-29T00:00:00.000Z",
  };
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(json, null, 2));
}

function seedRegistry(
  root: string,
  rows: Array<{
    name: string;
    dsPath: string | null;
    codePath: string | null;
    status: "design-only" | "code-only" | "synced";
  }>
): void {
  const db = openDb(registryDbPath(root));
  initRegistryDb(db);
  for (const row of rows) upsertRegistry(db, { kind: "component", ...row });
  db.close();
}

function seedCodeFile(root: string, codePath: string, cvaAxes: string[]): void {
  const abs = join(root, codePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  const variantsObj = cvaAxes.map((a) => `${a}: { primary: "" }`).join(", ");
  const content = `import { cva } from "class-variance-authority";\n\nconst x = cva("", { variants: { ${variantsObj} }, defaultVariants: {} });\n`;
  writeFileSync(abs, content);
}

// ─── Test 1: Audit happy path ─────────────────────────────────────────────────

describe("Phase 6 E2E — audit", () => {
  it("audit walks registry and writes report", async () => {
    const root = await setupRepo();

    // Build a fixture registry with all 4 outcomes
    seedDsComponent(root, "Button", ["Variant"]);
    seedCodeFile(root, "src/components/ui/button.tsx", ["variant"]);
    seedDsComponent(root, "Card", ["Variant", "Size"]);
    seedCodeFile(root, "src/components/ui/card.tsx", ["variant"]);
    seedDsComponent(root, "Input", ["Variant"]);
    seedRegistry(root, [
      {
        name: "Button",
        dsPath: "components/button.json",
        codePath: "src/components/ui/button.tsx",
        status: "synced",
      },
      {
        name: "Card",
        dsPath: "components/card.json",
        codePath: "src/components/ui/card.tsx",
        status: "synced",
      },
      {
        name: "Input",
        dsPath: "components/input.json",
        codePath: null,
        status: "design-only",
      },
      {
        name: "Header",
        dsPath: null,
        codePath: "src/components/Header.tsx",
        status: "code-only",
      },
    ]);

    const registry = buildRegistry(root);
    const result = await callTool(registry, "kotikit_audit", {});
    expect(result.isError).toBeFalsy();

    const reportPath = join(root, ".kotikit/audit-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = AuditReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf-8")));
    expect(report.summary).toEqual({
      syncedOk: 1,
      syncedMismatched: 1,
      designOnly: 1,
      codeOnly: 1,
    });

    // Button is synced-ok
    expect(report.entries.find((e) => e.name === "Button")?.outcome).toBe("synced-ok");

    // Card is synced-mismatched (DS has [Variant, Size], code has [variant])
    const card = report.entries.find((e) => e.name === "Card");
    if (card === undefined) throw new Error("Expected Card audit entry to exist.");
    expect(card.outcome).toBe("synced-mismatched");
    expect(card.variantDelta?.dsOnly).toEqual(["size"]);
  });
});

// ─── Test 2: get_system_prompt ────────────────────────────────────────────────

describe("Phase 6 E2E — get_system_prompt", () => {
  it("returns the React doctrine with the quality bar sentence", async () => {
    const root = await setupRepo();
    const registry = buildRegistry(root);
    const result = await callTool(registry, "kotikit_get_system_prompt", {
      kind: "react",
    });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as {
      prompt: string;
      kind: string;
    };
    expect(detail.kind).toBe("react");
    expect(detail.prompt.toLowerCase()).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
    expect(detail.prompt).toContain("TypeScript strict");
  });
});

// ─── Test 3: implement_code_start lazy by default ─────────────────────────────

describe("Phase 6 E2E — token-shape changes", () => {
  it("implement_code_start returns componentRefs not dsComponents by default", async () => {
    const root = await setupRepo();
    seedDsComponent(root, "Button", ["Variant"]);
    seedDsComponent(root, "Card", ["Variant"]);

    const registry = buildRegistry(root);
    await callTool(registry, "kotikit_spec_create", {
      allowUnguided: true,
      draft: {
        scope: "profile-page",
        screen: {
          slug: "profile",
          title: "Profile Page",
          description: "x",
          functional: ["x"],
          states: { default: "x" },
          components: [{ name: "Button" }, { name: "Card" }],
          acceptanceCriteria: ["renders"],
        },
      },
    });

    const result = await callTool(registry, "kotikit_implement_code_start", {
      scope: "profile-page",
    });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as {
      componentRefs?: unknown[];
      dsComponents?: Record<string, unknown>;
      systemPromptRef?: string;
      systemPrompt?: string;
    };
    expect(detail.componentRefs).toBeDefined();
    expect(detail.dsComponents).toBeUndefined();
    expect(detail.systemPromptRef).toBe("react");
    expect(detail.systemPrompt?.length).toBeLessThan(300);
  });

  it("implement_code_start expand=true restores dsComponents", async () => {
    const root = await setupRepo();
    seedDsComponent(root, "Button", ["Variant"]);
    const registry = buildRegistry(root);
    await callTool(registry, "kotikit_spec_create", {
      allowUnguided: true,
      draft: {
        scope: "profile-page",
        screen: {
          slug: "profile",
          title: "P",
          description: "x",
          functional: ["x"],
          states: { default: "x" },
          components: [{ name: "Button" }],
          acceptanceCriteria: ["renders"],
        },
      },
    });
    const result = await callTool(registry, "kotikit_implement_code_start", {
      scope: "profile-page",
      expand: true,
    });
    const detail = parseToolDetail(result) as {
      dsComponents?: Record<string, unknown>;
      componentRefs?: unknown;
    };
    expect(detail.dsComponents).toBeDefined();
    expect(detail.componentRefs).toBeUndefined();
  });
});

// ─── Test 4: scaffold pagination ──────────────────────────────────────────────

describe("Phase 6 E2E — scaffold pagination", () => {
  it("scaffold_start with 5 design-only components paginates at 3 per call", async () => {
    const root = await setupRepo();

    // Seed 5 design-only components (3 + 2 → two pages)
    for (let i = 0; i < 5; i++) {
      const name = `Comp${String(i).padStart(2, "0")}`;
      seedDsComponent(root, name, ["Variant"]);
      const db = openDb(registryDbPath(root));
      initRegistryDb(db);
      upsertRegistry(db, {
        kind: "component",
        name,
        dsPath: `components/${name.toLowerCase()}.json`,
        codePath: null,
        status: "design-only",
      });
      db.close();
    }

    const registry = buildRegistry(root);

    const page1 = await callTool(registry, "kotikit_scaffold_start", {});
    const d1 = parseToolDetail(page1) as {
      components: { name: string }[];
      nextCursor?: string;
      hasMore: boolean;
    };
    expect(d1.components).toHaveLength(3);
    expect(d1.hasMore).toBe(true);

    const page2 = await callTool(registry, "kotikit_scaffold_start", {
      cursor: d1.nextCursor,
    });
    const d2 = parseToolDetail(page2) as {
      components: { name: string }[];
      hasMore: boolean;
    };
    expect(d2.components).toHaveLength(2);
    expect(d2.hasMore).toBe(false);
  });
});
