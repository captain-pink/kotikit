import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import type { GateRunReport } from "../../src/codegen/gate-output.js";
import type { runGates as defaultRunGates } from "../../src/codegen/gate-runner.js";
import { loadConfig, writeConfig } from "../../src/config/load.js";
import { defaultConfig } from "../../src/config/schema.js";
import { getRegistry } from "../../src/db/registry-db.js";
import type { ToolContext } from "../../src/mcp/context.js";
import type { ToolRegistry } from "../../src/mcp/server.js";
import { registerBrainstormTools } from "../../src/mcp/tools/brainstorm.js";
import { registerConfigTools } from "../../src/mcp/tools/config.js";
import { registerFlowTools } from "../../src/mcp/tools/flow.js";
import { registerImplementCodeTools } from "../../src/mcp/tools/implement-code.js";
import { registerPlanCodeTools } from "../../src/mcp/tools/plan-code.js";
import { registerRegistryTools } from "../../src/mcp/tools/registry.js";
import { registerScaffoldTools } from "../../src/mcp/tools/scaffold.js";
import { registerSpecTools } from "../../src/mcp/tools/spec.js";
import { registerSyncTools } from "../../src/mcp/tools/sync.js";
import { FigmaClient } from "../../src/sync/figma-client.js";
import { createLimiter } from "../../src/sync/rate-limit.js";
import { registryDbPath } from "../../src/util/paths.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-phase4-"));
  tmpDirs.push(d);
  return d;
}

afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[]; isError?: boolean };

function buildPhase4Registry(
  root: string,
  opts?: {
    gateRunner?: typeof defaultRunGates;
    figmaClientFactory?: (token: string) => FigmaClient;
  }
): ToolRegistry {
  const tools: Tool[] = [];
  const handlers = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const registry: ToolRegistry = { tools, handlers };
  const ctx: ToolContext = { root, loadConfig: () => loadConfig(root) };
  registerConfigTools(registry, ctx);
  registerSpecTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerPlanCodeTools(registry, ctx);
  registerImplementCodeTools(
    registry,
    ctx,
    opts?.gateRunner ? { gateRunner: opts.gateRunner } : {}
  );
  registerRegistryTools(registry, ctx);
  registerScaffoldTools(registry, ctx, opts?.gateRunner ? { gateRunner: opts.gateRunner } : {});
  registerSyncTools(
    registry,
    ctx,
    opts?.figmaClientFactory ? { figmaClientFactory: opts.figmaClientFactory } : {}
  );
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
  if (text === undefined) {
    throw new Error("Expected tool result text.");
  }
  return parseDetail(text);
}

function firstComponent<T>(components: T[]): T {
  const component = components[0];
  if (component === undefined) {
    throw new Error("Expected scaffold component.");
  }
  return component;
}

function seedBins(root: string): void {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  for (const t of ["tsc", "eslint", "prettier", "vitest"])
    writeFileSync(join(bin, t), "#!/bin/sh\n");
}

function seedStorybook(root: string): void {
  mkdirSync(join(root, ".storybook"), { recursive: true });
  writeFileSync(join(root, ".storybook", "main.ts"), "export default {};");
}

async function setupRepo(opts?: { storybook?: boolean }): Promise<string> {
  const tmp = mkTmp();
  const git = simpleGit(tmp);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test Runner");
  seedBins(tmp);
  if (opts?.storybook) seedStorybook(tmp);
  return tmp;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FAST = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 };

function makePassReport(): GateRunReport {
  return {
    ranAt: "x",
    totalDurationMs: 100,
    passed: true,
    results: (["tsc", "eslint", "prettier", "vitest"] as const).map((g) => ({
      gate: g,
      passed: true,
      exitCode: 0,
      durationMs: 25,
      failures: [],
      raw: "",
    })),
  };
}

function makeFailReport(
  failingGate: "tsc" | "eslint" | "prettier" | "vitest" = "eslint"
): GateRunReport {
  return {
    ranAt: "x",
    totalDurationMs: 100,
    passed: false,
    results: (["tsc", "eslint", "prettier", "vitest"] as const).map((g) => ({
      gate: g,
      passed: g !== failingGate,
      exitCode: g === failingGate ? 1 : 0,
      durationMs: 25,
      failures:
        g === failingGate ? [{ file: "x.tsx", line: 1, column: 1, message: "stub fail" }] : [],
      raw: "",
    })),
  };
}

/** Build a fixture Figma fetch that responds with a tiny DS containing 3 components. */
function makeDsFetch(): typeof globalThis.fetch {
  const FA = {
    components: {
      meta: {
        components: [
          { key: "ckBtn", node_id: "nBtn", name: "Button" },
          { key: "ckCard", node_id: "nCard", name: "Card" },
          { key: "ckInput", node_id: "nInput", name: "Input" },
        ],
      },
    },
    component_sets: { meta: { component_sets: [] } },
    styles: { meta: { styles: [] } },
    variables: { meta: { variables: {}, variableCollections: {} } },
    nodes: { nodes: {} },
    file: {
      name: "DS",
      document: {
        children: [
          {
            id: "p1",
            name: "Components",
            children: [
              { id: "nBtn", name: "Button" },
              { id: "nCard", name: "Card" },
              { id: "nInput", name: "Input" },
            ],
          },
        ],
      },
    },
  };
  return (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes("/v1/files/FA/components")) return jsonRes(FA.components);
    if (u.includes("/v1/files/FA/component_sets")) return jsonRes(FA.component_sets);
    if (u.includes("/v1/files/FA/styles")) return jsonRes(FA.styles);
    if (u.includes("/v1/files/FA/variables/local")) return jsonRes(FA.variables);
    if (u.includes("/v1/files/FA/nodes")) return jsonRes(FA.nodes);
    if (u.endsWith("/v1/files/FA")) return jsonRes(FA.file);
    throw new Error(`no fixture for ${u}`);
  }) as unknown as typeof globalThis.fetch;
}

function makeFigmaClientFactory(fetchFn: typeof globalThis.fetch) {
  return (token: string) =>
    new FigmaClient({
      token,
      fetch: fetchFn,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
}

async function initConfigForSync(root: string, opts?: { autoCommit?: boolean }): Promise<void> {
  const cfg = defaultConfig();
  cfg.figma.token = "test-token";
  cfg.figma.designSystemFiles = [{ key: "FA", name: "DS" }];
  cfg.git.autoCommit = opts?.autoCommit ?? true;
  await writeConfig(root, cfg);
}

// ─── Test 1: happy path ───────────────────────────────────────────────────────

describe("Phase 4 E2E — sync + scaffold happy path", () => {
  it("sync populates registry, scaffold turns 2 components into code with one commit", async () => {
    const root = await setupRepo({ storybook: true });
    await initConfigForSync(root);

    const pass = makePassReport();
    const registry = buildPhase4Registry(root, {
      gateRunner: async () => pass,
      figmaClientFactory: makeFigmaClientFactory(makeDsFetch()),
    });

    // Sync — populates design-system/ and registry
    const syncResult = await callTool(registry, "kotikit_sync_ds", {});
    expect(syncResult.isError).toBeFalsy();

    // 3 design-only rows in registry
    const listResult = await callTool(registry, "kotikit_registry_search", {
      status: "design-only",
      kind: "component",
    });
    const listDetail = parseToolDetail(listResult) as {
      results: { name: string }[];
    };
    expect(listDetail.results.map((r) => r.name).sort()).toEqual(["Button", "Card", "Input"]);

    // scaffold_start for two specific names
    const startResult = await callTool(registry, "kotikit_scaffold_start", {
      names: ["Button", "Card"],
    });
    expect(startResult.isError).toBeFalsy();
    const startDetail = parseToolDetail(startResult) as {
      components: {
        name: string;
        targetPath: string;
        storyPath?: string;
        scaffoldShape: { tsx: string; stories?: string };
      }[];
      hasStorybook: boolean;
    };
    expect(startDetail.components).toHaveLength(2);
    expect(startDetail.hasStorybook).toBe(true);

    // Build the save payload from the scaffold shapes.
    const files = startDetail.components.flatMap((c) => {
      const out: { path: string; content: string }[] = [
        { path: join(root, c.targetPath), content: c.scaffoldShape.tsx },
      ];
      if (c.storyPath && c.scaffoldShape.stories) {
        out.push({
          path: join(root, c.storyPath),
          content: c.scaffoldShape.stories,
        });
      }
      return out;
    });

    const saveResult = await callTool(registry, "kotikit_scaffold_save", {
      files,
    });
    expect(saveResult.isError).toBeFalsy();

    // 4 files on disk
    expect(existsSync(join(root, "src/components/ui/button.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/components/ui/button.stories.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/components/ui/card.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/components/ui/card.stories.tsx"))).toBe(true);

    // Registry: Button and Card synced; Input stays design-only
    const regDb = new Database(registryDbPath(root), { readonly: true });
    const button = getRegistry(regDb, "component", "Button");
    const card = getRegistry(regDb, "component", "Card");
    const input = getRegistry(regDb, "component", "Input");
    expect(button?.status).toBe("synced");
    expect(button?.codePath).toBe("src/components/ui/button.tsx");
    expect(button?.dsPath).toBe("components/button.json"); // preserved from sync
    expect(card?.status).toBe("synced");
    expect(input?.status).toBe("design-only");
    regDb.close();

    // One commit with both component names in the subject
    const git = simpleGit(root);
    const log = await git.log();
    const commit = log.all.find((c) => c.message.includes("feat(code): create scaffold"));
    expect(commit).toBeDefined();
    expect(commit?.message).toContain("Button");
    expect(commit?.message).toContain("Card");
  });
});

// ─── Test 2: no Storybook ────────────────────────────────────────────────────

describe("Phase 4 E2E — no Storybook", () => {
  it("scaffold without Storybook emits only .tsx files; component still becomes synced", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigForSync(root);

    const registry = buildPhase4Registry(root, {
      gateRunner: async () => makePassReport(),
      figmaClientFactory: makeFigmaClientFactory(makeDsFetch()),
    });

    await callTool(registry, "kotikit_sync_ds", {});

    const startResult = await callTool(registry, "kotikit_scaffold_start", {
      names: ["Button"],
    });
    const startDetail = parseToolDetail(startResult) as {
      components: {
        name: string;
        targetPath: string;
        storyPath?: string;
        scaffoldShape: { tsx: string; stories?: string };
      }[];
      hasStorybook: boolean;
    };
    expect(startDetail.hasStorybook).toBe(false);
    expect(startDetail.components[0]?.storyPath).toBeUndefined();
    expect(startDetail.components[0]?.scaffoldShape.stories).toBeUndefined();

    const c = firstComponent(startDetail.components);
    const saveResult = await callTool(registry, "kotikit_scaffold_save", {
      files: [{ path: join(root, c.targetPath), content: c.scaffoldShape.tsx }],
    });
    expect(saveResult.isError).toBeFalsy();

    expect(existsSync(join(root, "src/components/ui/button.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/components/ui/button.stories.tsx"))).toBe(false);

    const regDb = new Database(registryDbPath(root), { readonly: true });
    expect(getRegistry(regDb, "component", "Button")?.status).toBe("synced");
    regDb.close();
  });
});

// ─── Test 3: gate failure ─────────────────────────────────────────────────────

describe("Phase 4 E2E — gate failure", () => {
  it("scaffold_save with failing gate writes files but does NOT commit or upsert", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigForSync(root);

    const registry = buildPhase4Registry(root, {
      gateRunner: async () => makeFailReport("eslint"),
      figmaClientFactory: makeFigmaClientFactory(makeDsFetch()),
    });

    await callTool(registry, "kotikit_sync_ds", {});
    const startResult = await callTool(registry, "kotikit_scaffold_start", {
      names: ["Button"],
    });
    const startDetail = parseToolDetail(startResult) as {
      components: { targetPath: string; scaffoldShape: { tsx: string } }[];
    };
    const c = firstComponent(startDetail.components);

    const saveResult = await callTool(registry, "kotikit_scaffold_save", {
      files: [{ path: join(root, c.targetPath), content: c.scaffoldShape.tsx }],
    });
    expect(saveResult.isError).toBe(true);

    // File still on disk for the agent to fix
    expect(existsSync(join(root, c.targetPath))).toBe(true);

    // Registry row still design-only
    const regDb = new Database(registryDbPath(root), { readonly: true });
    expect(getRegistry(regDb, "component", "Button")?.status).toBe("design-only");
    regDb.close();

    // No scaffold commit
    const git = simpleGit(root);
    const log = await git.log().catch(() => null);
    expect((log?.all ?? []).find((c) => c.message.includes("scaffold"))).toBeUndefined();
  });
});

// ─── Test 4: re-sync preserves synced ─────────────────────────────────────────

describe("Phase 4 E2E — sync preserves synced rows", () => {
  it("re-syncing after scaffold does not downgrade or clobber synced rows", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigForSync(root);

    const registry = buildPhase4Registry(root, {
      gateRunner: async () => makePassReport(),
      figmaClientFactory: makeFigmaClientFactory(makeDsFetch()),
    });

    // Sync + scaffold Button
    await callTool(registry, "kotikit_sync_ds", {});
    const startResult = await callTool(registry, "kotikit_scaffold_start", {
      names: ["Button"],
    });
    const startDetail = parseToolDetail(startResult) as {
      components: { targetPath: string; scaffoldShape: { tsx: string } }[];
    };
    const c = firstComponent(startDetail.components);
    await callTool(registry, "kotikit_scaffold_save", {
      files: [{ path: join(root, c.targetPath), content: c.scaffoldShape.tsx }],
    });

    // Re-sync
    await callTool(registry, "kotikit_sync_ds", {});

    // Button row should still be synced with codePath intact
    const regDb = new Database(registryDbPath(root), { readonly: true });
    const button = getRegistry(regDb, "component", "Button");
    expect(button?.status).toBe("synced");
    expect(button?.codePath).toBe("src/components/ui/button.tsx");
    regDb.close();
  });
});

// ─── Test 5: Phase 3 + Phase 4 coexistence ────────────────────────────────────

describe("Phase 4 E2E — Phase 3 + Phase 4 coexistence", () => {
  it("screen rows and component rows live side-by-side in registry", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigForSync(root);

    const registry = buildPhase4Registry(root, {
      gateRunner: async () => makePassReport(),
      figmaClientFactory: makeFigmaClientFactory(makeDsFetch()),
    });

    // Sync → creates 3 design-only component rows
    await callTool(registry, "kotikit_sync_ds", {});

    // Phase 3 — write a screen spec and implement_code_save it
    const draft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "x",
        functional: ["x"],
        states: { loading: "x" },
        components: [],
        acceptanceCriteria: ["renders"],
      },
    };
    await callTool(registry, "kotikit_spec_create", { draft });

    const sr = await callTool(registry, "kotikit_implement_code_start", {
      scope: "profile-page",
    });
    const sd = parseToolDetail(sr) as {
      targetPath: string;
      testPath?: string;
      testScaffold: string;
    };
    const files: { path: string; content: string }[] = [
      {
        path: sd.targetPath,
        content: "export default function ProfilePage() { return null; }\n",
      },
    ];
    if (sd.testPath) {
      files.push({ path: sd.testPath, content: sd.testScaffold });
    }

    await callTool(registry, "kotikit_implement_code_save", {
      scope: "profile-page",
      files,
    });

    // Registry has both kinds
    const regDb = new Database(registryDbPath(root), { readonly: true });
    const screenRow = getRegistry(regDb, "screen", "ProfilePage");
    const compButton = getRegistry(regDb, "component", "Button");
    expect(screenRow?.status).toBe("code-only");
    expect(compButton?.status).toBe("design-only");
    regDb.close();

    // registry_search with no filters returns both
    const search = await callTool(registry, "kotikit_registry_search", {});
    const detail = parseToolDetail(search) as {
      results: { kind: string }[];
    };
    const kinds = new Set(detail.results.map((r) => r.kind));
    expect(kinds.has("screen")).toBe(true);
    expect(kinds.has("component")).toBe(true);
  });
});
