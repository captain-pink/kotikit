import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

import { registerImplementCodeTools } from "./implement-code";
import type { ToolRegistry } from "../server";
import type { ToolContext } from "../context";
import { writeScreenSpec } from "../../spec/engine";
import { newScreenSpec } from "../../spec/schema";
import { defaultConfig } from "../../config/schema";
import { existsSync } from "fs";
import type { GateRunReport } from "../../codegen/gate-output";
import type { RunGatesOpts } from "../../codegen/gate-runner";
import { registryDbPath, codeComponentFile } from "../../util/paths";
import { openDb } from "../../db/sqlite";
import { initRegistryDb, getRegistry } from "../../db/registry-db";
import { readScreenSpec } from "../../spec/engine";
import type { Config } from "../../config/schema";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmp: string;
let registry: ToolRegistry;
let ctx: ToolContext;

function makeRegistry(): ToolRegistry {
  return { tools: [], handlers: new Map() };
}

function makeCtx(root: string, configOverride?: Partial<Config>): ToolContext {
  return {
    root,
    loadConfig: async () => {
      const base = defaultConfig();
      if (configOverride) {
        return { ...base, ...configOverride, git: { ...base.git, ...(configOverride.git ?? {}) } };
      }
      return base;
    },
  };
}

async function call(
  name: string,
  args: unknown
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`No handler for tool: ${name}`);
  return handler(args);
}

function getText(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

function makePassReport(): GateRunReport {
  return {
    ranAt: new Date().toISOString(),
    totalDurationMs: 100,
    results: [
      { gate: "tsc", passed: true, exitCode: 0, durationMs: 30, failures: [], raw: "" },
      { gate: "eslint", passed: true, exitCode: 0, durationMs: 25, failures: [], raw: "" },
      { gate: "prettier", passed: true, exitCode: 0, durationMs: 20, failures: [], raw: "" },
      { gate: "vitest", passed: true, exitCode: 0, durationMs: 25, failures: [], raw: "" },
    ],
    passed: true,
  };
}

function makeFailReport(failGate: "tsc" | "eslint" | "prettier" | "vitest"): GateRunReport {
  const results = [
    { gate: "tsc" as const, passed: failGate !== "tsc", exitCode: failGate === "tsc" ? 1 : 0, durationMs: 30, failures: failGate === "tsc" ? [{ file: "src/Foo.tsx", line: 10, column: 5, message: "Cannot find name 'Foo'" }] : [], raw: "" },
    { gate: "eslint" as const, passed: failGate !== "eslint", exitCode: failGate === "eslint" ? 1 : 0, durationMs: 25, failures: failGate === "eslint" ? [{ file: "src/Foo.tsx", line: 14, column: 3, message: "Missing label", rule: "jsx-a11y/label-has-associated-control" }] : [], raw: "" },
    { gate: "prettier" as const, passed: failGate !== "prettier", exitCode: failGate === "prettier" ? 1 : 0, durationMs: 20, failures: failGate === "prettier" ? [{ file: "src/Foo.tsx", message: "Code style issues found by prettier" }] : [], raw: "" },
    { gate: "vitest" as const, passed: failGate !== "vitest", exitCode: failGate === "vitest" ? 1 : 0, durationMs: 25, failures: failGate === "vitest" ? [{ file: "src/Foo.test.tsx", message: "Test failed" }] : [], raw: "" },
  ];
  return {
    ranAt: new Date().toISOString(),
    totalDurationMs: 100,
    results,
    passed: false,
  };
}

function makeGateRunner(report: GateRunReport): typeof import("../../codegen/gate-runner").runGates {
  return async (_opts: RunGatesOpts) => report;
}

// Seed bin stubs so verifyEnvironment passes
function seedBinStubs(root: string): void {
  const binDir = join(root, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  for (const tool of ["tsc", "eslint", "prettier", "vitest"]) {
    writeFileSync(join(binDir, tool), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
}

// Write a sample screen spec to the tmp root
async function seedSpec(
  root: string,
  scope: string,
  screen: string | null,
  extra?: Partial<ReturnType<typeof newScreenSpec>>
): Promise<ReturnType<typeof newScreenSpec>> {
  const spec = newScreenSpec({
    title: screen ? screen.charAt(0).toUpperCase() + screen.slice(1) : "Profile Page",
    description: "A test screen",
  });
  const merged = { ...spec, ...extra };
  await writeScreenSpec(root, scope, screen, merged);
  return merged;
}

async function setupTestEnv(): Promise<{ root: string; cleanup: () => void }> {
  const root = join(tmpdir(), `kotikit-impl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });

  // git init
  try {
    execSync(
      "git init && git config user.email test@test.com && git config user.name Test",
      { cwd: root, stdio: "pipe" }
    );
  } catch {
    // If git fails, autoCommit will be skipped — tests still proceed
  }

  // Seed node_modules/.bin stubs
  seedBinStubs(root);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  tmp = join(tmpdir(), `kotikit-impl-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  try {
    execSync(
      "git init && git config user.email test@test.com && git config user.name Test",
      { cwd: tmp, stdio: "pipe" }
    );
  } catch {
    // ignore
  }

  seedBinStubs(tmp);

  registry = makeRegistry();
  ctx = makeCtx(tmp);
  registerImplementCodeTools(registry, ctx, {
    gateRunner: makeGateRunner(makePassReport()),
  });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─── Tool registration ─────────────────────────────────────────────────────────

describe("tool registration", () => {
  it("registers kotikit_implement_code_start", () => {
    expect(registry.tools.find((t) => t.name === "kotikit_implement_code_start")).toBeDefined();
  });

  it("registers kotikit_implement_code_save", () => {
    expect(registry.tools.find((t) => t.name === "kotikit_implement_code_save")).toBeDefined();
  });

  it("registers kotikit_implement_code_gate", () => {
    expect(registry.tools.find((t) => t.name === "kotikit_implement_code_gate")).toBeDefined();
  });
});

// ─── kotikit_implement_code_start ─────────────────────────────────────────────

describe("kotikit_implement_code_start", () => {
  it("test 1: happy path returns context bundle", async () => {
    await seedSpec(tmp, "profile-page", null, {
      requirements: {
        functional: ["Show user name"],
        states: { loading: "Spinner visible", loaded: "Profile data displayed" },
        responsive: "inherits",
        themes: "inherits",
      },
      acceptanceCriteria: ["Displays user name", "Shows avatar"],
      components: [{ name: "Avatar", dsKey: "avatar-key" }],
    });

    const result = await call("kotikit_implement_code_start", { scope: "profile-page" });
    expect(result.isError).toBeUndefined();

    const text = getText(result);
    expect(text).toContain("ProfilePage");
    expect(text).toContain("systemPrompt");
    expect(text).toContain("spec");
    expect(text).toContain("targetPath");
    expect(text).toContain("testScaffold");
    expect(text).toContain("plan");

    // system prompt should contain quality bar sentence (check case-insensitively by searching for key phrase)
    expect(text.toLowerCase()).toContain("any developer or designer could build this identically");
  });

  it("test 2: missing spec returns friendly error", async () => {
    const result = await call("kotikit_implement_code_start", { scope: "nonexistent-scope" });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text.length).toBeGreaterThan(0);
    // Should be a friendly message, not a stack trace
    expect(text).not.toContain("Error:");
  });

  it("test 3: missing gates returns friendly error mentioning install commands", async () => {
    await seedSpec(tmp, "profile-page", null);

    // Remove bin stubs so verifyEnvironment fails
    rmSync(join(tmp, "node_modules"), { recursive: true, force: true });

    // Re-register without bin stubs
    registry = makeRegistry();
    ctx = makeCtx(tmp);
    registerImplementCodeTools(registry, ctx, {
      gateRunner: makeGateRunner(makePassReport()),
    });

    const result = await call("kotikit_implement_code_start", { scope: "profile-page" });
    expect(result.isError).toBe(true);
    const text = getText(result);
    // Should mention missing tools
    expect(text).toContain("gate tools");
    // Should include install commands
    expect(text).toContain("bun add");
  });

  it("test 4: with DS design-system on disk, dsComponents is populated", async () => {
    const { ComponentJsonSchema } = await import("../../sync/component-shape");
    const { nowIso } = await import("../../util/ids");

    // Create the design-system directory structure
    const dsDir = join(tmp, "design-system", "components");
    mkdirSync(dsDir, { recursive: true });

    // Create a valid component JSON
    const componentJson = ComponentJsonSchema.parse({
      name: "Button",
      key: "btn-key",
      fileKey: "file-key",
      path: "components/button.json",
      variants: [{ propertyName: "size", values: ["sm", "md", "lg"] }],
      properties: {},
      updatedAt: nowIso(),
    });
    writeFileSync(join(dsDir, "button.json"), JSON.stringify(componentJson, null, 2));

    // Seed spec with Button component reference
    await seedSpec(tmp, "profile-page", null, {
      components: [{ name: "Button", dsKey: "btn-key" }],
    });

    const result = await call("kotikit_implement_code_start", { scope: "profile-page" });
    expect(result.isError).toBeUndefined();

    const text = getText(result);
    // dsComponents should be populated with Button
    expect(text).toContain("dsComponents");
    expect(text).toContain("Button");
  });

  it("test 5: without design-system, dsComponents is {} and tool does NOT error", async () => {
    await seedSpec(tmp, "profile-page", null, {
      components: [{ name: "Button" }],
    });

    const result = await call("kotikit_implement_code_start", { scope: "profile-page" });
    expect(result.isError).toBeUndefined();

    const text = getText(result);
    // dsComponents should be empty object
    expect(text).toContain('"dsComponents": {}');
  });
});

// ─── kotikit_implement_code_save ──────────────────────────────────────────────

describe("kotikit_implement_code_save", () => {
  it("test 6: all gates pass → files written, registry row exists, spec active, commit created", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      await seedSpec(root, "profile-page", null);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");
      const testPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.test.tsx");

      const reg = makeRegistry();
      const c = makeCtx(root);
      registerImplementCodeTools(reg, c, {
        gateRunner: makeGateRunner(makePassReport()),
      });

      const handler = reg.handlers.get("kotikit_implement_code_save");
      if (!handler) throw new Error("No handler");

      const result = await handler({
        scope: "profile-page",
        files: [
          { path: componentPath, content: "export function ProfilePage() { return <div />; }" },
          { path: testPath, content: "import { describe, it } from 'vitest'; describe('p', () => { it('works', () => {}); });" },
        ],
      });

      expect(result.isError).toBeUndefined();
      expect(existsSync(componentPath)).toBe(true);
      expect(existsSync(testPath)).toBe(true);

      // Check registry
      const regDbPath = registryDbPath(root);
      expect(existsSync(regDbPath)).toBe(true);
      const db = openDb(regDbPath);
      initRegistryDb(db);
      const row = getRegistry(db, "screen", "ProfilePage");
      db.close();
      expect(row).not.toBeNull();
      expect(row?.status).toBe("code-only");

      // Check spec status
      const updatedSpec = await readScreenSpec(root, "profile-page", null);
      expect(updatedSpec.status).toBe("active");

      // Check commit message
      const text = result.content.map((c: { text: string }) => c.text).join("\n");
      expect(text).toContain("ProfilePage");
      expect(text).toContain("gates passed");
    } finally {
      cleanup();
    }
  });

  it("test 7: one gate fails → files written but no commit, spec status unchanged", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      await seedSpec(root, "profile-page", null);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");

      const reg = makeRegistry();
      const c = makeCtx(root);
      registerImplementCodeTools(reg, c, {
        gateRunner: makeGateRunner(makeFailReport("eslint")),
      });

      const handler = reg.handlers.get("kotikit_implement_code_save")!;
      const result = await handler({
        scope: "profile-page",
        files: [
          { path: componentPath, content: "export function ProfilePage() { return <div />; }" },
        ],
      });

      // isError should be true
      expect(result.isError).toBe(true);

      // File IS written (for next iteration)
      expect(existsSync(componentPath)).toBe(true);

      // No registry row
      const regDbPath = registryDbPath(root);
      // registry might not exist yet, or if it does, no row
      if (existsSync(regDbPath)) {
        const db = openDb(regDbPath);
        initRegistryDb(db);
        const row = getRegistry(db, "screen", "ProfilePage");
        db.close();
        expect(row).toBeNull();
      }

      // Spec status unchanged (still draft)
      const spec = await readScreenSpec(root, "profile-page", null);
      expect(spec.status).toBe("draft");
    } finally {
      cleanup();
    }
  });

  it("test 8: path traversal attempt → friendly error, no files written", async () => {
    await seedSpec(tmp, "profile-page", null);

    const traversalPath = join(tmp, "src", "components", "profile-page", "..", "..", "evil.txt");

    const result = await call("kotikit_implement_code_save", {
      scope: "profile-page",
      files: [{ path: traversalPath, content: "evil" }],
    });

    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("outside your code components directory");

    // Evil file should not be written
    expect(existsSync(join(tmp, "evil.txt"))).toBe(false);
  });

  it("test 9: update on already-existing target → commit 'update', spec stays active", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      // Seed spec as already active
      const spec = newScreenSpec({ title: "Profile Page", description: "test" });
      const activeSpec = { ...spec, status: "active" as const };
      await writeScreenSpec(root, "profile-page", null, activeSpec);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");

      // Pre-create the file so it "exists" before save
      mkdirSync(join(root, config.project.codeComponentsDir, "profile-page"), { recursive: true });
      writeFileSync(componentPath, "// original");

      const reg = makeRegistry();
      const c = makeCtx(root);
      registerImplementCodeTools(reg, c, {
        gateRunner: makeGateRunner(makePassReport()),
      });

      const handler = reg.handlers.get("kotikit_implement_code_save")!;
      const result = await handler({
        scope: "profile-page",
        files: [
          { path: componentPath, content: "export function ProfilePage() { return <div />; }" },
        ],
      });

      expect(result.isError).toBeUndefined();

      const text = result.content.map((c: { text: string }) => c.text).join("\n");
      // Should say "update" not "create"
      expect(text.toLowerCase()).toContain("update");

      // Spec stays active
      const updatedSpec = await readScreenSpec(root, "profile-page", null);
      expect(updatedSpec.status).toBe("active");
    } finally {
      cleanup();
    }
  });

  it("test 10: autoCommit: false → no commit, but gates run, files written, registry updated", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      await seedSpec(root, "profile-page", null);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");

      const reg = makeRegistry();
      const c: ToolContext = {
        root,
        loadConfig: async () => ({ ...defaultConfig(), git: { autoCommit: false } }),
      };
      registerImplementCodeTools(reg, c, {
        gateRunner: makeGateRunner(makePassReport()),
      });

      const handler = reg.handlers.get("kotikit_implement_code_save")!;
      const result = await handler({
        scope: "profile-page",
        files: [
          { path: componentPath, content: "export function ProfilePage() { return <div />; }" },
        ],
      });

      // Gates still run, files written, registry updated
      expect(result.isError).toBeUndefined();
      expect(existsSync(componentPath)).toBe(true);

      const regDbPath = registryDbPath(root);
      expect(existsSync(regDbPath)).toBe(true);

      const db = openDb(regDbPath);
      initRegistryDb(db);
      const row = getRegistry(db, "screen", "ProfilePage");
      db.close();
      expect(row).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ─── kotikit_implement_code_gate ──────────────────────────────────────────────

describe("kotikit_implement_code_gate", () => {
  it("test 11: files exist + all gates pass → isError: false, formatted summary", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      await seedSpec(root, "profile-page", null);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");

      // Write the file to disk
      mkdirSync(join(root, config.project.codeComponentsDir, "profile-page"), { recursive: true });
      writeFileSync(componentPath, "export function ProfilePage() { return <div />; }");

      const reg = makeRegistry();
      const c = makeCtx(root);
      registerImplementCodeTools(reg, c, {
        gateRunner: makeGateRunner(makePassReport()),
      });

      const handler = reg.handlers.get("kotikit_implement_code_gate")!;
      const result = await handler({ scope: "profile-page" });

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c: { text: string }) => c.text).join("\n");
      expect(text).toContain("Gates:");
      expect(text).toContain("passed");
    } finally {
      cleanup();
    }
  });

  it("test 12: files exist + gate fails → isError: true with failure block", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      await seedSpec(root, "profile-page", null);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");

      mkdirSync(join(root, config.project.codeComponentsDir, "profile-page"), { recursive: true });
      writeFileSync(componentPath, "export function ProfilePage() { return <div />; }");

      const reg = makeRegistry();
      const c = makeCtx(root);
      registerImplementCodeTools(reg, c, {
        gateRunner: makeGateRunner(makeFailReport("eslint")),
      });

      const handler = reg.handlers.get("kotikit_implement_code_gate")!;
      const result = await handler({ scope: "profile-page" });

      expect(result.isError).toBe(true);
      const text = result.content.map((c: { text: string }) => c.text).join("\n");
      expect(text).toContain("eslint");
      expect(text).toContain("failed");
    } finally {
      cleanup();
    }
  });

  it("test 13: files don't exist → friendly error, gates not run", async () => {
    await seedSpec(tmp, "profile-page", null);

    let gateRunnerCalled = false;
    registry = makeRegistry();
    ctx = makeCtx(tmp);
    registerImplementCodeTools(registry, ctx, {
      gateRunner: async (_opts) => {
        gateRunnerCalled = true;
        return makePassReport();
      },
    });

    const result = await call("kotikit_implement_code_gate", { scope: "profile-page" });

    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("no generated code");
    expect(gateRunnerCalled).toBe(false);
  });

  it("test 14: only: ['eslint'] runs only eslint", async () => {
    const { root, cleanup } = await setupTestEnv();

    try {
      await seedSpec(root, "profile-page", null);

      const config = defaultConfig();
      const componentPath = codeComponentFile(root, config.project.codeComponentsDir, "profile-page", "ProfilePage.tsx");

      mkdirSync(join(root, config.project.codeComponentsDir, "profile-page"), { recursive: true });
      writeFileSync(componentPath, "export function ProfilePage() { return <div />; }");

      let capturedOpts: RunGatesOpts | undefined;
      const reg = makeRegistry();
      const c = makeCtx(root);

      // eslint-only pass report
      const eslintOnlyReport: GateRunReport = {
        ranAt: new Date().toISOString(),
        totalDurationMs: 25,
        results: [
          { gate: "eslint", passed: true, exitCode: 0, durationMs: 25, failures: [], raw: "" },
        ],
        passed: true,
      };

      registerImplementCodeTools(reg, c, {
        gateRunner: async (opts: RunGatesOpts) => {
          capturedOpts = opts;
          return eslintOnlyReport;
        },
      });

      const handler = reg.handlers.get("kotikit_implement_code_gate")!;
      await handler({ scope: "profile-page", only: ["eslint"] });

      expect(capturedOpts).toBeDefined();
      expect(capturedOpts!.only).toEqual(["eslint"]);
    } finally {
      cleanup();
    }
  });
});
