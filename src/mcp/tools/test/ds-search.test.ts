import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { initComponentsDb, upsertComponent } from "../../../db/components-db.js";
import { openDb } from "../../../db/sqlite.js";
import { nowIso } from "../../../util/ids.js";
import { componentJsonPath, componentsDbPath, manifestPath } from "../../../util/paths.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerDsSearchTools } from "../ds-search.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-dssearch-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}
function makeCtx(root: string): ToolContext {
  return { root, loadConfig: async () => null };
}

function seedDesignSystem(
  root: string,
  components: { name: string; key: string; fileKey: string; path?: string; pageName?: string }[]
): void {
  const dbPath = componentsDbPath(root);
  const db = openDb(dbPath);
  initComponentsDb(db);
  for (const c of components) {
    upsertComponent(db, {
      name: c.name,
      path: c.path ?? `components/${c.name.toLowerCase()}.json`,
      key: c.key,
      fileKey: c.fileKey,
      props: "",
    });
    // Also write the per-component JSON file
    const filePath = c.path
      ? join(root, "design-system", c.path)
      : componentJsonPath(root, c.name.toLowerCase());
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          name: c.name,
          key: c.key,
          fileKey: c.fileKey,
          path: c.path ?? `components/${c.name.toLowerCase()}.json`,
          ...(c.pageName ? { pageName: c.pageName } : {}),
          variants: [],
          properties: {},
          updatedAt: nowIso(),
        },
        null,
        2
      )
    );
  }
  db.close();
}

async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return handler(args);
}

describe("kotikit_ds_search", () => {
  it("returns matching components", async () => {
    const root = mkTmp();
    seedDesignSystem(root, [
      { name: "Button", key: "k1", fileKey: "fA" },
      { name: "Card", key: "k2", fileKey: "fA" },
    ]);
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_ds_search", { query: "but*" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Button");
  });

  it("shows source pages and exact paths for same-named search results", async () => {
    const root = mkTmp();
    seedDesignSystem(root, [
      {
        name: "Card",
        key: "marketing-card",
        fileKey: "F1",
        path: "components/card--marketing.json",
        pageName: "Marketing",
      },
      {
        name: "Card",
        key: "product-card",
        fileKey: "F1",
        path: "components/card--product.json",
        pageName: "Product",
      },
    ]);
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));

    const result = await callTool(registry, "kotikit_ds_search", { query: "Card" });
    expect(result.content[0]?.text).toContain("Use the exact path");
    expect(result.content[0]?.text).toContain('"pageName": "Marketing"');
    expect(result.content[0]?.text).toContain('"pageName": "Product"');
    expect(result.content[0]?.text).toContain("components/card--marketing.json");
    expect(result.content[0]?.text).toContain("components/card--product.json");
  });

  it("shows source file names for same-named components from different files", async () => {
    const root = mkTmp();
    seedDesignSystem(root, [
      { name: "Button", key: "key-a", fileKey: "FA", path: "components/button--a.json" },
      { name: "Button", key: "key-b", fileKey: "FB", path: "components/button--b.json" },
    ]);
    writeFileSync(
      manifestPath(root),
      JSON.stringify({
        version: 1,
        lastSyncAt: nowIso(),
        files: [
          { key: "FA", name: "Core Library", componentCount: 1, iconCount: 0 },
          { key: "FB", name: "Product Library", componentCount: 1, iconCount: 0 },
        ],
        conflicts: [],
      })
    );
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));

    const result = await callTool(registry, "kotikit_ds_search", { query: "Button" });
    expect(result.content[0]?.text).toContain('"fileName": "Core Library"');
    expect(result.content[0]?.text).toContain('"fileName": "Product Library"');
  });

  it("returns friendly error when design system is missing", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_ds_search", { query: "Button" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("hasn't been synced");
  });
});

describe("kotikit_ds_get_component", () => {
  it("returns the component JSON", async () => {
    const root = mkTmp();
    seedDesignSystem(root, [{ name: "Button", key: "k1", fileKey: "fA" }]);
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_ds_get_component", {
      path: "components/button.json",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Button");
  });

  it("rejects path traversal", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_ds_get_component", { path: "../etc/passwd" });
    expect(result.isError).toBe(true);
  });

  it("friendly error when component file is missing", async () => {
    const root = mkTmp();
    seedDesignSystem(root, [{ name: "Button", key: "k", fileKey: "f" }]);
    const registry = makeRegistry();
    registerDsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_ds_get_component", {
      path: "components/does-not-exist.json",
    });
    expect(result.isError).toBe(true);
  });
});
