import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import type { GateRunReport } from "../../src/codegen/gate-output.js";
import type { runGates as defaultRunGates } from "../../src/codegen/gate-runner.js";
import { loadConfig } from "../../src/config/load.js";
import type { ToolContext } from "../../src/mcp/context.js";
import type { ToolRegistry } from "../../src/mcp/server.js";
import { registerBrainstormTools } from "../../src/mcp/tools/brainstorm.js";
import { registerConfigTools } from "../../src/mcp/tools/config.js";
import { registerFlowTools } from "../../src/mcp/tools/flow.js";
import { registerImplementCodeTools } from "../../src/mcp/tools/implement-code.js";
import { registerPlanCodeTools } from "../../src/mcp/tools/plan-code.js";
import { registerRegistryTools } from "../../src/mcp/tools/registry.js";
import { registerSpecTools } from "../../src/mcp/tools/spec.js";
import { CodePlanSchema } from "../../src/planning/code-plan-schema.js";
import { ScreenSpecSchema } from "../../src/spec/schema.js";
import { codePlanPath, registryDbPath } from "../../src/util/paths.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-phase3-"));
  tmpDirs.push(d);
  return d;
}

afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[]; isError?: boolean };

function buildPhase3Registry(root: string, gateRunner?: typeof defaultRunGates): ToolRegistry {
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

function seedBins(root: string, tools: string[]): void {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  for (const t of tools) writeFileSync(join(bin, t), "#!/bin/sh\n");
}

async function setupRepoWithGates(): Promise<string> {
  const tmp = mkTmp();
  const git = simpleGit(tmp);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test Runner");
  seedBins(tmp, ["tsc", "eslint", "prettier", "vitest"]);
  return tmp;
}

function makePassReport(gates: ("tsc" | "eslint" | "prettier" | "vitest")[]): GateRunReport {
  return {
    ranAt: new Date().toISOString(),
    totalDurationMs: 100,
    passed: true,
    results: gates.map((g) => ({
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
  gates: ("tsc" | "eslint" | "prettier" | "vitest")[],
  failingGate: "tsc" | "eslint" | "prettier" | "vitest"
): GateRunReport {
  return {
    ranAt: new Date().toISOString(),
    totalDurationMs: 100,
    passed: false,
    results: gates.map((g) => ({
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

// ─── Test 1: Happy path single screen ─────────────────────────────────────────

describe("Phase 3 E2E — happy path", () => {
  it("plan_code → implement_code_start → implement_code_save → spec active + commit", async () => {
    const root = await setupRepoWithGates();

    // 1) init config with autoCommit and vitest
    let registry = buildPhase3Registry(root);
    await callTool(registry, "kotikit_config_init", { tests: true, autoCommit: true });

    // 2) write a screen spec directly via spec_create (deterministic instead of brainstorm)
    const draft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "User profile information.",
        functional: ["Display name and avatar"],
        states: { loading: "Spinner", empty: "X", error: "X", filled: "Full profile" },
        components: [],
        acceptanceCriteria: ["Avatar renders", "Name renders"],
      },
    };
    const createResult = await callTool(registry, "kotikit_spec_create", { draft });
    expect(createResult.isError).toBeFalsy();

    // 3) plan_code
    const planResult = await callTool(registry, "kotikit_plan_code", { scope: "profile-page" });
    expect(planResult.isError).toBeFalsy();
    expect(existsSync(codePlanPath(root, "profile-page", null))).toBe(true);
    const planJson = JSON.parse(await readFile(codePlanPath(root, "profile-page", null), "utf-8"));
    const plan = CodePlanSchema.parse(planJson);
    expect(plan.componentName).toBe("ProfilePage");
    expect(plan.targetPath).toBe("src/components/profile-page/ProfilePage.tsx");

    // 4) implement_code_start
    const passReport = makePassReport(["tsc", "eslint", "prettier", "vitest"]);
    registry = buildPhase3Registry(root, async () => passReport);
    const startResult = await callTool(registry, "kotikit_implement_code_start", {
      scope: "profile-page",
    });
    expect(startResult.isError).toBeFalsy();
    const startDetail = parseToolDetail(startResult) as {
      componentName: string;
      targetPath: string;
      testPath?: string;
      systemPrompt: string;
      systemPromptRef: string;
      testScaffold: string;
    };
    expect(startDetail.componentName).toBe("ProfilePage");
    // Phase 6: full prompt is fetched via kotikit_get_system_prompt; systemPromptRef indicates which
    expect(startDetail.systemPromptRef).toBe("react");
    // systemPrompt is now a stub mentioning the new tool
    expect(startDetail.systemPrompt).toContain("kotikit_get_system_prompt");
    expect(startDetail.testScaffold).toContain("describe");

    // The targetPath returned by start is an absolute path
    const componentAbsPath = startDetail.targetPath;
    const testAbsPath = startDetail.testPath;

    // 5) implement_code_save with fake but valid-looking files
    const componentContent = `import React from "react";\nexport default function ProfilePage() { return <main />; }\n`;
    const testContent = startDetail.testScaffold;
    const saveFiles: { path: string; content: string }[] = [
      { path: componentAbsPath, content: componentContent },
    ];
    if (testAbsPath) {
      saveFiles.push({ path: testAbsPath, content: testContent });
    }
    const saveResult = await callTool(registry, "kotikit_implement_code_save", {
      scope: "profile-page",
      files: saveFiles,
    });
    expect(saveResult.isError).toBeFalsy();

    // 6) Assertions on disk
    expect(existsSync(join(root, "src/components/profile-page/ProfilePage.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/components/profile-page/ProfilePage.test.tsx"))).toBe(true);
    expect(existsSync(registryDbPath(root))).toBe(true);

    // 7) Spec status flipped to "active"
    const specPath = join(root, ".kotikit/specs/profile-page/spec.json");
    const spec = ScreenSpecSchema.parse(JSON.parse(await readFile(specPath, "utf-8")));
    expect(spec.status).toBe("active");

    // 8) Git: a feat(code): create profile-page commit exists
    const git = simpleGit(root);
    const log = await git.log();
    const commitMessages = log.all.map((c) => `${c.message} ${c.body ?? ""}`).join("\n");
    expect(commitMessages).toContain("feat(code): create profile-page");
    expect(commitMessages).toContain("Co-authored-by: Claude Code");

    // 9) Registry has a ProfilePage row
    const reg = await callTool(registry, "kotikit_registry_search", { query: "Profile" });
    const regDetail = parseToolDetail(reg) as {
      results: { name: string }[];
    };
    expect(regDetail.results.some((r) => r.name === "ProfilePage")).toBe(true);
  });
});

// ─── Test 2: gate failure path ─────────────────────────────────────────────────

describe("Phase 3 E2E — gate failure", () => {
  it("save with failing gate does NOT commit; subsequent _gate with pass returns ok", async () => {
    const root = await setupRepoWithGates();

    let registry = buildPhase3Registry(root);
    await callTool(registry, "kotikit_config_init", { tests: true, autoCommit: true });
    const draft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "x",
        functional: ["x"],
        states: { loading: "x" },
        components: [],
        acceptanceCriteria: [],
      },
    };
    await callTool(registry, "kotikit_spec_create", { draft });

    // First _save with FAILING gate
    const failReport = makeFailReport(["tsc", "eslint", "prettier", "vitest"], "eslint");
    registry = buildPhase3Registry(root, async () => failReport);
    const startResult = await callTool(registry, "kotikit_implement_code_start", {
      scope: "profile-page",
    });
    expect(startResult.isError).toBeFalsy();
    const startDetail = parseToolDetail(startResult) as {
      targetPath: string;
      testPath?: string;
      testScaffold: string;
    };

    // The targetPath is absolute
    const targetAbsPath = startDetail.targetPath;
    const saveResult = await callTool(registry, "kotikit_implement_code_save", {
      scope: "profile-page",
      files: [{ path: targetAbsPath, content: "x" }],
    });
    expect(saveResult.isError).toBe(true);

    // Files exist on disk (so the agent can edit)
    expect(existsSync(targetAbsPath)).toBe(true);

    // No commit yet (no commits at all since only spec commit would have been made)
    const git = simpleGit(root);
    const log = await git.log().catch(() => null);
    const allMessages = (log?.all ?? []).map((c) => c.message).join("\n");
    expect(allMessages).not.toContain("feat(code):");

    // Spec status still draft
    const specPath = join(root, ".kotikit/specs/profile-page/spec.json");
    const spec1 = ScreenSpecSchema.parse(JSON.parse(await readFile(specPath, "utf-8")));
    expect(spec1.status).toBe("draft");

    // Now call _gate with a passing runner
    const passReport = makePassReport(["tsc", "eslint", "prettier", "vitest"]);
    registry = buildPhase3Registry(root, async () => passReport);
    const gateResult = await callTool(registry, "kotikit_implement_code_gate", {
      scope: "profile-page",
    });
    expect(gateResult.isError).toBeFalsy();
    expect(gateResult.content[0]?.text).toContain("4 of 4 passed");
  });
});

// ─── Test 3: missing gates fails preflight ─────────────────────────────────────

describe("Phase 3 E2E — missing gates", () => {
  it("implement_code_start refuses to begin when gates are missing", async () => {
    const tmp = mkTmp();
    const git = simpleGit(tmp);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test Runner");
    // INTENTIONALLY do not seed binaries.

    const registry = buildPhase3Registry(tmp);
    await callTool(registry, "kotikit_config_init", { tests: true, autoCommit: true });
    const draft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "x",
        functional: [],
        states: {},
        components: [],
        acceptanceCriteria: [],
      },
    };
    await callTool(registry, "kotikit_spec_create", { draft });

    const result = await callTool(registry, "kotikit_implement_code_start", {
      scope: "profile-page",
    });
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text.toLowerCase() ?? "";
    expect(text).toContain("bun add -d");
  });
});

// ─── Test 4: multi-screen variant ─────────────────────────────────────────────

describe("Phase 3 E2E — multi-screen", () => {
  it("flow screen lands at <scope>/<Cart>.tsx with commit subject containing <scope>/cart", async () => {
    const root = await setupRepoWithGates();

    let registry = buildPhase3Registry(root);
    await callTool(registry, "kotikit_config_init", { tests: true, autoCommit: true });
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
          states: { loading: "x" },
          components: [],
          acceptanceCriteria: ["renders"],
        },
      ],
      transitions: [],
      sharedState: [],
    };
    await callTool(registry, "kotikit_flow_create", { draft });

    const passReport = makePassReport(["tsc", "eslint", "prettier", "vitest"]);
    registry = buildPhase3Registry(root, async () => passReport);

    const startResult = await callTool(registry, "kotikit_implement_code_start", {
      scope: "checkout-flow",
      screen: "cart",
    });
    expect(startResult.isError).toBeFalsy();
    const startDetail = parseToolDetail(startResult) as {
      targetPath: string;
      testPath?: string;
      testScaffold: string;
    };
    // targetPath is absolute — verify it ends with the expected relative segment
    expect(startDetail.targetPath).toContain("src/components/checkout-flow/Cart.tsx");

    const componentAbsPath = startDetail.targetPath;
    const testAbsPath = startDetail.testPath;

    const saveFiles: { path: string; content: string }[] = [
      {
        path: componentAbsPath,
        content: "export default function Cart() { return null; }\n",
      },
    ];
    if (testAbsPath) {
      saveFiles.push({ path: testAbsPath, content: startDetail.testScaffold });
    }

    const saveResult = await callTool(registry, "kotikit_implement_code_save", {
      scope: "checkout-flow",
      screen: "cart",
      files: saveFiles,
    });
    expect(saveResult.isError).toBeFalsy();

    const git = simpleGit(root);
    const log = await git.log();
    const commitMsg = log.all.map((c) => c.message).join("\n");
    expect(commitMsg).toContain("feat(code): create checkout-flow/cart");
  });
});

// ─── Test 5: path traversal rejected ──────────────────────────────────────────

describe("Phase 3 E2E — path traversal", () => {
  it("save rejects paths outside <codeComponentsDir>/<scope>/", async () => {
    const root = await setupRepoWithGates();
    let registry = buildPhase3Registry(root);
    await callTool(registry, "kotikit_config_init", { tests: true, autoCommit: true });
    await callTool(registry, "kotikit_spec_create", {
      draft: {
        scope: "profile-page",
        screen: {
          slug: "x",
          title: "Profile Page",
          description: "x",
          functional: [],
          states: {},
          components: [],
          acceptanceCriteria: [],
        },
      },
    });
    const passReport = makePassReport(["tsc", "eslint", "prettier", "vitest"]);
    registry = buildPhase3Registry(root, async () => passReport);

    const result = await callTool(registry, "kotikit_implement_code_save", {
      scope: "profile-page",
      files: [{ path: join(root, "../etc/passwd"), content: "haha" }],
    });
    expect(result.isError).toBe(true);
    // Confirm nothing escaped
    expect(existsSync(join(root, "../etc/passwd"))).toBe(false);
  });
});
