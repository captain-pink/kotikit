import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import type { GateRunReport } from "../../codegen/gate-output";
import type { RunGatesOpts } from "../../codegen/gate-runner";
import { writeConfig } from "../../config/load";
import type { Config } from "../../config/schema";
import { defaultConfig } from "../../config/schema";
import { getRegistry, initRegistryDb, upsertRegistry } from "../../db/registry-db";
import { openDb } from "../../db/sqlite";
import type { ComponentJson } from "../../sync/component-shape";
import { registryDbPath, uiComponentFile, uiStoryFile } from "../../util/paths";
import type { ToolContext } from "../context";
import type { ToolRegistry } from "../server";
import { registerScaffoldTools } from "./scaffold";

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

function parseToolDetail(result: { content: { type: string; text: string }[] }): unknown {
  const text = result.content[0]?.text;
  if (text === undefined) {
    throw new Error("Expected tool result text.");
  }
  return parseDetail(text);
}

function firstItem<T>(items: T[], label: string): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error(`Expected ${label}.`);
  }
  return item;
}

function itemAt<T>(items: T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected ${label} at index ${index}.`);
  }
  return item;
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

function makeGateRunner(report: GateRunReport): (_opts: RunGatesOpts) => Promise<GateRunReport> {
  return async (_opts: RunGatesOpts) => report;
}

// ─── Phase 6 helper aliases ───────────────────────────────────────────────────

/** Alias for call() — used by Phase 6 tests. */
async function callTool(
  reg: ToolRegistry,
  name: string,
  args: unknown
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  return call(reg, name, args);
}

/** Parse the JSON detail block from a tool response text. */
function parseDetail(text: string): unknown {
  const jsonStart = text.indexOf("\n\n{");
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(text.slice(jsonStart + 2));
  } catch {
    return null;
  }
}

/** Write the default config to the repo's .kotikit/config.json. */
async function initConfigInRepo(root: string): Promise<void> {
  const { defaultConfig } = await import("../../config/schema");
  await writeConfig(root, defaultConfig());
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
      components: {
        name: string;
        kebabName: string;
        targetPath: string;
        storyPath?: string;
        scaffoldShape: { tsx: string; stories?: string };
      }[];
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

    // systemPromptRef identifies the adapter; systemPrompt is now a stub
    expect((detail as { systemPromptRef?: string }).systemPromptRef).toBe("react");
    expect(detail.systemPrompt).toContain("kotikit_get_system_prompt");
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
    const detail = getDetail(result) as {
      skipped: { name: string; reason: string }[];
      components: unknown[];
    };
    expect(detail).not.toBeNull();
    expect(detail.skipped).toHaveLength(1);
    expect(firstItem(detail.skipped, "skipped component").name).toBe("Ghost");
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
    const component = firstItem(detail.components, "scaffold component");
    expect(component.storyPath).toBeUndefined();
    expect(component.scaffoldShape.stories).toBeUndefined();
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
    const traversalPath = join(
      root,
      config.project.codeComponentsDir,
      "ui",
      "..",
      "..",
      "evil.txt"
    );

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
      loadConfig: async () => {
        const config = defaultConfig();
        return { ...config, git: { ...config.git, autoCommit: false } };
      },
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

    if (row === null) {
      throw new Error("Expected Button registry row.");
    }
    expect(row.status).toBe("synced");
    expect(row.dsPath).toBe("components/button.json");
    expect(row.codePath).toContain("button.tsx");
  });
});

// ─── Phase 6 pagination + compact tests ──────────────────────────────────────

describe("scaffold_start pagination (Phase 6)", () => {
  it("default pageSize=3: 10 design-only components return 3 + nextCursor + hasMore", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigInRepo(root);

    // Seed 10 DS components (Component00..Component09)
    for (let i = 0; i < 10; i++) {
      const name = `Component${String(i).padStart(2, "0")}`;
      seedComponent(root, name, `components/${name.toLowerCase()}.json`);
    }

    const registry = makeRegistry();
    registerScaffoldTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_scaffold_start", {});
    const detail = parseToolDetail(result) as {
      components: { name: string }[];
      nextCursor?: string;
      hasMore: boolean;
      totalRemaining: number;
    };
    expect(detail.components).toHaveLength(3);
    expect(detail.hasMore).toBe(true);
    expect(detail.nextCursor).toBe(itemAt(detail.components, 2, "scaffold component").name);
    expect(detail.totalRemaining).toBeGreaterThan(0);
  });

  it("cursor advances to the next page", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigInRepo(root);
    for (let i = 0; i < 6; i++) {
      const name = `Component${i}`;
      seedComponent(root, name, `components/${name.toLowerCase()}.json`);
    }
    const registry = makeRegistry();
    registerScaffoldTools(registry, makeCtx(root));
    const page1 = await callTool(registry, "kotikit_scaffold_start", {});
    const d1 = parseToolDetail(page1) as {
      components: { name: string }[];
      nextCursor?: string;
    };
    const page2 = await callTool(registry, "kotikit_scaffold_start", { cursor: d1.nextCursor });
    const d2 = parseToolDetail(page2) as {
      components: { name: string }[];
      hasMore: boolean;
    };
    // Page2 should start AFTER cursor
    if (d1.nextCursor === undefined) {
      throw new Error("Expected next cursor.");
    }
    expect(
      firstItem(d2.components, "second page component").name.localeCompare(d1.nextCursor)
    ).toBeGreaterThan(0);
  });

  it("2 components: pageSize default fits all → hasMore=false, no nextCursor", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigInRepo(root);
    seedComponent(root, "A", "components/a.json");
    seedComponent(root, "B", "components/b.json");
    const registry = makeRegistry();
    registerScaffoldTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_scaffold_start", {});
    const detail = parseToolDetail(result) as {
      components: unknown[];
      nextCursor?: string;
      hasMore: boolean;
    };
    expect(detail.components).toHaveLength(2);
    expect(detail.hasMore).toBe(false);
    expect(detail.nextCursor).toBeUndefined();
  });

  it("compact=true (default): dsJson is the stripped shape", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigInRepo(root);
    seedComponent(root, "Button", "components/button.json");
    const registry = makeRegistry();
    registerScaffoldTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_scaffold_start", {});
    const detail = parseToolDetail(result) as {
      components: { dsJson: Record<string, unknown> }[];
    };
    const dsJson = firstItem(detail.components, "scaffold component").dsJson;
    expect(dsJson.name).toBeDefined();
    expect(dsJson.key).toBeDefined();
    expect(dsJson.variants).toBeDefined();
    expect(dsJson.propertyNames).toBeDefined();
    // Stripped — these should NOT be present
    expect(dsJson.path).toBeUndefined();
    expect(dsJson.updatedAt).toBeUndefined();
  });

  it("compact=false returns full ComponentJson", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigInRepo(root);
    seedComponent(root, "Button", "components/button.json");
    const registry = makeRegistry();
    registerScaffoldTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_scaffold_start", { compact: false });
    const detail = parseToolDetail(result) as {
      components: { dsJson: Record<string, unknown> }[];
    };
    const dsJson = firstItem(detail.components, "scaffold component").dsJson;
    // Full shape — path and updatedAt present
    expect(dsJson.path).toBeDefined();
    expect(dsJson.updatedAt).toBeDefined();
  });

  it("systemPromptRef is present and systemPrompt is a stub", async () => {
    const root = await setupRepo({ storybook: false });
    await initConfigInRepo(root);
    seedComponent(root, "Button", "components/button.json");
    const registry = makeRegistry();
    registerScaffoldTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_scaffold_start", {});
    const detail = parseToolDetail(result) as {
      systemPromptRef: string;
      systemPrompt: string;
    };
    expect(detail.systemPromptRef).toBe("react");
    expect(detail.systemPrompt).toContain("kotikit_get_system_prompt");
    expect(detail.systemPrompt.length).toBeLessThan(300); // STUB, not the 1.5KB doctrine
  });
});
