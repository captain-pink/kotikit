import { describe, it, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import simpleGit from "simple-git";

import { registerScaffoldTools } from "./scaffold";
import type { ToolRegistry } from "../server";
import type { ToolContext } from "../context";
import { defaultConfig } from "../../config/schema";
import type { GateRunReport } from "../../codegen/gate-output";
import type { RunGatesOpts } from "../../codegen/gate-runner";
import { openDb } from "../../db/sqlite";
import { initRegistryDb, upsertRegistry, getRegistry } from "../../db/registry-db";
import { registryDbPath, uiComponentFile, uiStoryFile } from "../../util/paths";
import type { ComponentJson } from "../../sync/component-shape";
import type { Config } from "../../config/schema";

// ─── Test-lifecycle dir cleanup ───────────────────────────────────────────────

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-scaffold-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  reg: ToolRegistry,
  name: string,
  args: unknown
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const handler = reg.handlers.get(name);
  if (!handler) throw new Error(`No handler for tool: ${name}`);
  return handler(args) as Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
}

function getText(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

function getDetail(result: { content: { type: string; text: string }[] }): unknown {
  const text = getText(result);
  const jsonStart = text.indexOf("\n\n{");
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(text.slice(jsonStart + 2));
  } catch {
    return null;
  }
}

function seedBins(root: string): void {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  for (const t of ["tsc", "eslint", "prettier", "vitest"]) {
    writeFileSync(join(bin, t), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
}

async function setupRepo(opts?: { storybook?: boolean }): Promise<string> {
  const tmp = mkTmp();
  const git = simpleGit(tmp);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  seedBins(tmp);
  if (opts?.storybook) {
    mkdirSync(join(tmp, ".storybook"), { recursive: true });
    writeFileSync(join(tmp, ".storybook", "main.ts"), "export default {};");
  }
  return tmp;
}

function seedComponent(root: string, name: string, dsPath: string): void {
  const json: ComponentJson = {
    name,
    key: `k-${name}`,
    fileKey: "f",
    path: dsPath,
    variants: [
      { propertyName: "Variant", values: ["Primary", "Secondary"] },
      { propertyName: "Size", values: ["sm", "md", "lg"] },
    ],
    properties: {
      Disabled: { type: "BOOLEAN", defaultValue: false },
    },
    updatedAt: "2026-05-29T00:00:00.000Z",
  };
  const full = join(root, "design-system", dsPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(json, null, 2));

  // Write registry row
  const db = openDb(registryDbPath(root));
  initRegistryDb(db);
  upsertRegistry(db, {
    kind: "component",
    name,
    dsPath,
    codePath: null,
    status: "design-only",
  });
  db.close();
}

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

function makeFailReport(): GateRunReport {
  return {
    ranAt: "x",
    totalDurationMs: 100,
    passed: false,
    results: [
      {
        gate: "eslint" as const,
        passed: false,
        exitCode: 1,
        durationMs: 25,
        failures: [{ file: "x.tsx", line: 1, column: 1, message: "stub error" }],
        raw: "",
      },
    ],
  };
}

function makeGateRunner(
  report: GateRunReport
): (_opts: RunGatesOpts) => Promise<GateRunReport> {
  return async (_opts: RunGatesOpts) => report;
}

// ─── _start tests ────────────────────────────────────────────────────────────

describe("kotikit_scaffold_start", () => {
  it("test 1: happy path — 2 components in registry + JSONs + storybook → returns 2-component bundle", async () => {
    const root = await setupRepo({ storybook: true });
    seedComponent(root, "Button", "components/button.json");
    seedComponent(root, "Card", "components/card.json");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_start", {});
    expect(result.isError).toBeUndefined();

    const text = getText(result);
    expect(text).toContain("Ready to scaffold 2 component");

    const detail = getDetail(result) as {
      components: { name: string; kebabName: string; targetPath: string; storyPath?: string; scaffoldShape: { tsx: string; stories?: string } }[];
      hasStorybook: boolean;
      skipped: { name: string; reason: string }[];
      systemPrompt: string;
      testFramework: string;
    };

    expect(detail).not.toBeNull();
    expect(detail.components).toHaveLength(2);
    expect(detail.hasStorybook).toBe(true);
    expect(detail.skipped).toHaveLength(0);

    // Both components should have targetPath and storyPath
    const names = detail.components.map((c) => c.name).sort();
    expect(names).toContain("Button");
    expect(names).toContain("Card");

    for (const comp of detail.components) {
      expect(comp.targetPath).toMatch(/\.tsx$/);
      expect(comp.targetPath).not.toMatch(/\.stories\.tsx$/);
      expect(comp.storyPath).toBeDefined();
      expect(comp.storyPath).toMatch(/\.stories\.tsx$/);
      expect(comp.scaffoldShape.tsx).toContain("cva(");
      expect(comp.scaffoldShape.stories).toBeDefined();
    }

    // systemPrompt should mention component names
    expect(detail.systemPrompt).toContain("Button");
    expect(detail.systemPrompt).toContain("Card");
  });

  it("test 2: no registry → friendly error", async () => {
    const root = await setupRepo();
    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_start", {});
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("No registry yet");
    expect(text).toContain("sync_ds");
  });

  it("test 3: no design-only rows → friendly error", async () => {
    const root = await setupRepo();
    // Create an empty registry (no rows)
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    db.close();

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_start", {});
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("design-only components to scaffold");
  });

  it("test 4: missing JSONs → skipped entry, no error", async () => {
    const root = await setupRepo({ storybook: false });

    // Seed registry row but don't write the JSON file
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Ghost",
      dsPath: "components/ghost.json",
      codePath: null,
      status: "design-only",
    });
    db.close();

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_start", {});
    // Even with all skipped, the tool should still succeed (just with empty components + skipped info)
    const detail = getDetail(result) as { skipped: { name: string; reason: string }[]; components: unknown[] };
    expect(detail).not.toBeNull();
    expect(detail.skipped).toHaveLength(1);
    expect(detail.skipped[0]!.name).toBe("Ghost");
    expect(detail.components).toHaveLength(0);
  });

  it("test 5: missing gates → friendly error mentioning install commands", async () => {
    const root = await setupRepo();
    seedComponent(root, "Button", "components/button.json");
    // Remove bin stubs
    rmSync(join(root, "node_modules"), { recursive: true, force: true });

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_start", {});
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("gate tools");
    expect(text).toContain("bun add");
  });

  it("test 6: storybook absent → hasStorybook: false, no storyPath in result entries", async () => {
    const root = await setupRepo({ storybook: false });
    seedComponent(root, "Button", "components/button.json");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_start", {});
    expect(result.isError).toBeUndefined();

    const detail = getDetail(result) as {
      hasStorybook: boolean;
      components: { storyPath?: string; scaffoldShape: { stories?: string } }[];
    };
    expect(detail.hasStorybook).toBe(false);
    expect(detail.components).toHaveLength(1);
    expect(detail.components[0]!.storyPath).toBeUndefined();
    expect(detail.components[0]!.scaffoldShape.stories).toBeUndefined();
  });
});

// ─── _save tests ─────────────────────────────────────────────────────────────

describe("kotikit_scaffold_save", () => {
  it("test 7: all gates pass, 2 components, Storybook present → 4 files + 2 synced rows + one commit", async () => {
    const root = await setupRepo({ storybook: true });
    seedComponent(root, "Button", "components/button.json");
    seedComponent(root, "Card", "components/card.json");

    const config = defaultConfig();
    const buttonTsx = uiComponentFile(root, config.project.codeComponentsDir, "button");
    const buttonStories = uiStoryFile(root, config.project.codeComponentsDir, "button");
    const cardTsx = uiComponentFile(root, config.project.codeComponentsDir, "card");
    const cardStories = uiStoryFile(root, config.project.codeComponentsDir, "card");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_save", {
      files: [
        { path: buttonTsx, content: "export function Button() { return <button />; }" },
        { path: buttonStories, content: "export default {};" },
        { path: cardTsx, content: "export function Card() { return <div />; }" },
        { path: cardStories, content: "export default {};" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(buttonTsx)).toBe(true);
    expect(existsSync(buttonStories)).toBe(true);
    expect(existsSync(cardTsx)).toBe(true);
    expect(existsSync(cardStories)).toBe(true);

    // Check registry
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    const buttonRow = getRegistry(db, "component", "Button");
    const cardRow = getRegistry(db, "component", "Card");
    db.close();

    expect(buttonRow?.status).toBe("synced");
    expect(cardRow?.status).toBe("synced");

    // Commit message in output
    const text = getText(result);
    expect(text).toContain("Button");
    expect(text).toContain("Card");
    expect(text).toContain("gates passed");
  });

  it("test 8: single component → subject contains just component name", async () => {
    const root = await setupRepo();
    seedComponent(root, "Button", "components/button.json");

    const config = defaultConfig();
    const buttonTsx = uiComponentFile(root, config.project.codeComponentsDir, "button");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_save", {
      files: [{ path: buttonTsx, content: "export function Button() { return <button />; }" }],
    });

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    // Subject should be "feat(code): create scaffold (Button)"
    expect(text).toContain("(Button)");
    expect(text).not.toContain("components)");
  });

  it("test 9: 6+ components → subject uses count", async () => {
    const root = await setupRepo();
    const config = defaultConfig();

    // Seed 6 components
    const componentNames = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
    for (const name of componentNames) {
      seedComponent(root, name, `components/${name.toLowerCase()}.json`);
    }

    const files = componentNames.map((name) => {
      const kebab = name.toLowerCase();
      return {
        path: uiComponentFile(root, config.project.codeComponentsDir, kebab),
        content: `export function ${name}() { return <div />; }`,
      };
    });

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_save", { files });

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    // Should say "(6 components)", not list individual names
    expect(text).toContain("(6 components)");
  });

  it("test 10: gates fail → files written, no commit, registry unchanged", async () => {
    const root = await setupRepo();
    seedComponent(root, "Button", "components/button.json");

    const config = defaultConfig();
    const buttonTsx = uiComponentFile(root, config.project.codeComponentsDir, "button");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makeFailReport()) });

    const result = await call(reg, "kotikit_scaffold_save", {
      files: [{ path: buttonTsx, content: "export function Button() { return <button />; }" }],
    });

    expect(result.isError).toBe(true);
    // File IS written (stays on disk for fixing)
    expect(existsSync(buttonTsx)).toBe(true);

    // Registry row should still be design-only (not updated to synced)
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    const row = getRegistry(db, "component", "Button");
    db.close();
    // The pre-seeded row is design-only; save failed so it should remain design-only
    expect(row?.status).toBe("design-only");
  });

  it("test 11: path traversal → rejected, no writes", async () => {
    const root = await setupRepo();

    const config = defaultConfig();
    // Attempt path outside ui dir
    const traversalPath = join(root, config.project.codeComponentsDir, "ui", "..", "..", "evil.txt");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_save", {
      files: [{ path: traversalPath, content: "evil" }],
    });

    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("outside your scaffold directory");
    expect(existsSync(join(root, "evil.txt"))).toBe(false);
  });

  it("test 12: autoCommit off → no commit, registry still synced", async () => {
    const root = await setupRepo();
    seedComponent(root, "Button", "components/button.json");

    const config = defaultConfig();
    const buttonTsx = uiComponentFile(root, config.project.codeComponentsDir, "button");

    const reg = makeRegistry();
    const ctx: ToolContext = {
      root,
      loadConfig: async () => ({ ...defaultConfig(), git: { autoCommit: false } }),
    };
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_save", {
      files: [{ path: buttonTsx, content: "export function Button() { return <button />; }" }],
    });

    expect(result.isError).toBeUndefined();

    // Registry should still be synced
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    const row = getRegistry(db, "component", "Button");
    db.close();
    expect(row?.status).toBe("synced");

    // Text should not contain a commit sha (the commit was skipped)
    const detail = getDetail(result) as { commit: { committed: boolean } };
    expect(detail?.commit?.committed).toBe(false);
  });

  it("test 13: synced row preserves dsPath from sync", async () => {
    const root = await setupRepo();

    // Pre-seed registry with dsPath set (as if sync ran)
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: null,
      status: "design-only",
    });
    db.close();

    const config = defaultConfig();
    const buttonTsx = uiComponentFile(root, config.project.codeComponentsDir, "button");

    const reg = makeRegistry();
    const ctx = makeCtx(root);
    registerScaffoldTools(reg, ctx, { gateRunner: makeGateRunner(makePassReport()) });

    const result = await call(reg, "kotikit_scaffold_save", {
      files: [{ path: buttonTsx, content: "export function Button() { return <button />; }" }],
    });

    expect(result.isError).toBeUndefined();

    const db2 = openDb(registryDbPath(root));
    initRegistryDb(db2);
    const row = getRegistry(db2, "component", "Button");
    db2.close();

    expect(row).not.toBeNull();
    expect(row!.status).toBe("synced");
    expect(row!.dsPath).toBe("components/button.json");
    expect(row!.codePath).toContain("button.tsx");
  });
});
