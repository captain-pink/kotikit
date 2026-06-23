import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import { loadConfig, writeConfig } from "../../src/config/load.js";
import { defaultConfig } from "../../src/config/schema.js";
import { type BridgeServer, startBridgeServer } from "../../src/mcp/bridge/server.js";
import type { ToolContext } from "../../src/mcp/context.js";
import type { ToolRegistry } from "../../src/mcp/server.js";
import { registerBrainstormTools } from "../../src/mcp/tools/brainstorm.js";
import { registerConfigTools } from "../../src/mcp/tools/config.js";
import { registerDesignApplyTools } from "../../src/mcp/tools/design-apply.js";
import { registerDesignScreenTools } from "../../src/mcp/tools/design-screen.js";
import { registerFigmaTargetTools } from "../../src/mcp/tools/figma-target.js";
import { registerFlowTools } from "../../src/mcp/tools/flow.js";
import { registerPlanDesignTools } from "../../src/mcp/tools/plan-design.js";
import { registerSpecTools } from "../../src/mcp/tools/spec.js";
import { DesignPlanSchema } from "../../src/planning/design-plan-schema.js";
import { designApplyLogPath, designPlanPath } from "../../src/util/paths.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-phase5-"));
  tmpDirs.push(d);
  return d;
}

afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[]; isError?: boolean };

function buildPhase5Registry(root: string): ToolRegistry {
  const tools: Tool[] = [];
  const handlers = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const registry: ToolRegistry = { tools, handlers };
  const ctx: ToolContext = { root, loadConfig: () => loadConfig(root) };
  registerConfigTools(registry, ctx);
  registerSpecTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerFigmaTargetTools(registry, ctx, {
    figmaClientFactory: () => ({
      getNodes: async (_fileKey, ids) =>
        Object.fromEntries(
          ids.map((id) => [id, { document: { id, name: "Drafts", type: "CANVAS" } }])
        ),
    }),
    now: () => "2026-06-22T00:00:00.000Z",
  });
  registerPlanDesignTools(registry, ctx);
  registerDesignScreenTools(registry, ctx);
  registerDesignApplyTools(registry, ctx);
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

function seedDsComponentJson(root: string, name: string): void {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dir = `${root}/design-system/components`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/${slug}.json`,
    JSON.stringify(
      {
        name,
        key: `k-${slug}`,
        fileKey: "f",
        path: `components/${slug}.json`,
        variants: [],
        properties: {},
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
      null,
      2
    )
  );
}

async function setupRepoWithConfig(): Promise<string> {
  const tmp = mkTmp();
  const git = simpleGit(tmp);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test Runner");
  const cfg = defaultConfig();
  cfg.git.autoCommit = true;
  cfg.figma.token = "figd_test";
  await writeConfig(tmp, cfg);
  return tmp;
}

let nextBridgePort = 58000 + Math.floor(Math.random() * 4000);

const isPortInUse = (err: unknown): boolean => (err as { code?: string }).code === "EADDRINUSE";

type StartedBridge = {
  bridge: BridgeServer;
  cfg: {
    version: 1;
    port: number;
    token: string;
    projectRoot: string;
    projectName: string;
    startedAt: string;
  };
};

function startPhase5Bridge(input: {
  registry: ToolRegistry;
  root: string;
  token?: string;
}): StartedBridge {
  const token = input.token ?? "tok123456789xyz";
  const candidates = Array.from({ length: 50 }, (_, index) => nextBridgePort + index);
  nextBridgePort += candidates.length;

  for (const port of candidates) {
    const cfg = {
      version: 1 as const,
      port,
      token,
      projectRoot: input.root,
      projectName: "proj",
      startedAt: new Date().toISOString(),
    };
    try {
      return {
        bridge: startBridgeServer({ registry: input.registry, config: cfg }),
        cfg,
      };
    } catch (err) {
      if (!isPortInUse(err)) throw err;
    }
  }

  throw new Error("Could not allocate a bridge test port.");
}

async function bindDraftTarget(
  registry: ToolRegistry,
  scope: string,
  screen?: string
): Promise<void> {
  const result = await callTool(registry, "kotikit_figma_target_bind", {
    scope,
    ...(screen !== undefined ? { screen } : {}),
    pageUrl: "https://www.figma.com/design/FILE123/Kotikit?node-id=1-2",
  });
  expect(result.isError).toBeFalsy();
}

// ─── Test 1: happy path spec → plan → get → apply log ────────────────────────

describe("Phase 5 E2E — design plan happy path", () => {
  it("spec_create → plan_design → design_get_screen → design_apply_step", async () => {
    const root = await setupRepoWithConfig();
    const registry = buildPhase5Registry(root);

    // 1. Create a single-screen spec via spec_create
    const draft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "User profile screen.",
        functional: ["Show avatar"],
        states: { default: "x" },
        components: [{ name: "Button" }, { name: "Input" }],
        acceptanceCriteria: ["renders"],
      },
    };
    const createResult = await callTool(registry, "kotikit_spec_create", { draft });
    expect(createResult.isError).toBeFalsy();
    seedDsComponentJson(root, "Button");
    seedDsComponentJson(root, "Input");
    await bindDraftTarget(registry, "profile-page");

    // 2. plan_design
    const planResult = await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });
    expect(planResult.isError).toBeFalsy();
    expect(existsSync(designPlanPath(root, "profile-page", null))).toBe(true);
    const plan = DesignPlanSchema.parse(
      JSON.parse(readFileSync(designPlanPath(root, "profile-page", null), "utf-8"))
    );
    expect(plan.pageName).toBe("ProfilePage");
    expect(plan.steps.length).toBeGreaterThan(0);

    // 3. design_get_screen — returns plan + spec + synced DS components
    const getResult = await callTool(registry, "kotikit_design_get_screen", {
      scope: "profile-page",
    });
    expect(getResult.isError).toBeFalsy();
    const getDetail = parseToolDetail(getResult) as {
      plan: { pageName: string };
      spec: { title: string };
      dsComponents: Record<string, unknown>;
      skipped: { name: string }[];
    };
    expect(getDetail.plan.pageName).toBe("ProfilePage");
    expect(getDetail.spec.title).toBe("Profile Page");
    expect(Object.keys(getDetail.dsComponents).sort()).toEqual(["Button", "Input"]);
    expect(getDetail.skipped).toEqual([]);

    // 4. design_apply_step — record three applications
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "profile-page",
      stepIndex: 0,
      outcome: "ok",
    });
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "profile-page",
      stepIndex: 1,
      outcome: "ok",
    });
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "profile-page",
      stepIndex: 2,
      outcome: "warned",
      note: "dsKey missing",
    });

    expect(existsSync(designApplyLogPath(root, "profile-page", null))).toBe(true);
    const logText = readFileSync(designApplyLogPath(root, "profile-page", null), "utf-8");
    const lines = logText.trim().split("\n");
    expect(lines).toHaveLength(3);
    const lastLine = lines[2];
    if (lastLine === undefined) {
      throw new Error("Expected third design apply log line.");
    }
    const last = JSON.parse(lastLine);
    expect(last.outcome).toBe("warned");
    expect(last.note).toBe("dsKey missing");

    // 5. Commit history shows the design plan commit
    const git = simpleGit(root);
    const log = await git.log();
    const subjects = log.all.map((c) => c.message);
    expect(subjects.some((s) => s.includes("feat(spec): create design plan profile-page"))).toBe(
      true
    );
  });
});

// ─── Test 2: multi-screen flow ────────────────────────────────────────────────

describe("Phase 5 E2E — multi-screen flow", () => {
  it("plan_design for a flow screen writes <screen>.design.plan.json", async () => {
    const root = await setupRepoWithConfig();
    const registry = buildPhase5Registry(root);

    const draft = {
      scope: "checkout-flow",
      title: "Checkout Flow",
      description: "Purchase flow.",
      screens: [
        {
          slug: "cart",
          title: "Cart",
          description: "x",
          functional: ["x"],
          states: { loading: "x", filled: "y" },
          components: [{ name: "Header" }],
          acceptanceCriteria: [],
        },
      ],
      transitions: [],
      sharedState: [],
    };
    await callTool(registry, "kotikit_flow_create", { draft });
    await bindDraftTarget(registry, "checkout-flow", "cart");

    const planResult = await callTool(registry, "kotikit_plan_design", {
      scope: "checkout-flow",
      screen: "cart",
    });
    expect(planResult.isError).toBeFalsy();
    expect(existsSync(designPlanPath(root, "checkout-flow", "cart"))).toBe(true);

    const plan = DesignPlanSchema.parse(
      JSON.parse(readFileSync(designPlanPath(root, "checkout-flow", "cart"), "utf-8"))
    );
    expect(plan.pageName).toBe("Cart");
    expect(plan.states.sort()).toEqual(["filled", "loading"]);
    expect(plan.layout.placements).toEqual([
      { componentName: "Header", role: "content", zone: "content" },
    ]);
    expect(plan.steps.filter((step) => step.kind === "define-state-frame")).toHaveLength(2);
    expect(plan.steps.filter((step) => step.kind === "apply-auto-layout")).toHaveLength(2);
    expect(plan.steps.filter((step) => step.kind === "define-layout-zone")).toHaveLength(2);
    expect(plan.steps.filter((step) => step.kind === "place-component")).toHaveLength(2);
  });
});

// ─── Test 3: bridge — connect + tools/list over WebSocket ────────────────────

describe("Phase 5 E2E — bridge", () => {
  let bridge: BridgeServer | null = null;

  afterEach(async () => {
    if (bridge) {
      await bridge.close();
      bridge = null;
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it("starts a bridge, connects via WebSocket, lists tools including Phase 5 names", async () => {
    const root = await setupRepoWithConfig();
    const registry = buildPhase5Registry(root);

    const started = startPhase5Bridge({ registry, root });
    bridge = started.bridge;
    const { cfg } = started;

    const reply = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}?token=${cfg.token}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 3000);
      ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
      ws.onmessage = (evt) => {
        clearTimeout(timer);
        ws.close();
        resolve(JSON.parse(evt.data as string));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    });

    const result = (reply as { result: { tools: { name: string }[] } }).result;
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("kotikit_plan_design");
    expect(names).toContain("kotikit_design_get_screen");
    expect(names).toContain("kotikit_design_apply_step");
    // Also check Phase 1-3 tools are exposed via bridge
    expect(names).toContain("kotikit_spec_list");
    expect(names).toContain("kotikit_brainstorm_start");
  });

  it("plan_design tool can be called over the bridge", async () => {
    const root = await setupRepoWithConfig();
    const registry = buildPhase5Registry(root);

    // Create a spec
    const draft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "x",
        functional: ["x"],
        states: { default: "x" },
        components: [],
        acceptanceCriteria: [],
      },
    };
    await callTool(registry, "kotikit_spec_create", { draft });
    await bindDraftTarget(registry, "profile-page");

    const started = startPhase5Bridge({ registry, root });
    bridge = started.bridge;
    const { cfg } = started;

    const reply = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}?token=${cfg.token}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 3000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "kotikit_plan_design",
              arguments: { scope: "profile-page" },
            },
          })
        );
      ws.onmessage = (evt) => {
        clearTimeout(timer);
        ws.close();
        resolve(JSON.parse(evt.data as string));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    });

    const result = (reply as { result: { content: { text: string }[] } }).result;
    expect(result.content[0]?.text).toContain("Design plan written");
    expect(existsSync(designPlanPath(root, "profile-page", null))).toBe(true);
  });

  it("connect with invalid token over the bridge is rejected", async () => {
    const root = await setupRepoWithConfig();
    const registry = buildPhase5Registry(root);

    const started = startPhase5Bridge({ registry, root });
    bridge = started.bridge;
    const { cfg } = started;

    const res = await fetch(`http://127.0.0.1:${cfg.port}/?token=wrong`, {
      headers: { upgrade: "websocket" },
    });
    expect(res.status).toBe(403);
  });
});
