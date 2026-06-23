import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { initRegistryDb, upsertRegistry } from "../../../db/registry-db.js";
import { openDb } from "../../../db/sqlite.js";
import { registryDbPath } from "../../../util/paths.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerRegistryTools } from "../registry.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-registry-tool-"));
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
async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return handler(args);
}

function parseDetail(text: string): unknown {
  const i = text.indexOf("\n\n");
  if (i === -1) return {};
  return JSON.parse(text.slice(i + 2));
}

function parseToolDetail(result: { content: { text?: string }[] }): unknown {
  const text = result.content[0]?.text;
  if (text === undefined) {
    throw new Error("Expected tool result text.");
  }
  return parseDetail(text);
}

describe("kotikit_registry_search", () => {
  it("empty registry → empty results, not an error", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", {
      query: "Button",
    });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as {
      results: unknown[];
    };
    expect(detail.results).toEqual([]);
  });

  it("seeded registry → search returns matching rows", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "screen",
      name: "Button",
      dsPath: null,
      codePath: "src/components/ui/button.tsx",
      status: "code-only",
    });
    upsertRegistry(db, {
      kind: "screen",
      name: "Card",
      dsPath: null,
      codePath: "src/components/ui/card.tsx",
      status: "code-only",
    });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", {
      query: "Button",
    });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as {
      results: { name: string }[];
    };
    expect(detail.results.map((r) => r.name)).toEqual(["Button"]);
  });

  it("respects the limit argument", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    for (let i = 0; i < 10; i++)
      upsertRegistry(db, {
        kind: "screen",
        name: `Comp${i}`,
        dsPath: null,
        codePath: "p",
        status: "code-only",
      });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", {
      query: "Comp",
      limit: 3,
    });
    const detail = parseToolDetail(result) as {
      results: unknown[];
    };
    expect(detail.results).toHaveLength(3);
  });

  it("status filter: only design-only rows", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: null,
      status: "design-only",
    });
    upsertRegistry(db, {
      kind: "screen",
      name: "Cart",
      dsPath: null,
      codePath: "src/x/Cart.tsx",
      status: "code-only",
    });
    upsertRegistry(db, {
      kind: "component",
      name: "Card",
      dsPath: "components/card.json",
      codePath: "src/components/ui/card.tsx",
      status: "synced",
    });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", { status: "design-only" });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as { results: { name: string }[] };
    expect(detail.results.map((r) => r.name)).toEqual(["Button"]);
  });

  it("kind filter: only components", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "p",
      codePath: null,
      status: "design-only",
    });
    upsertRegistry(db, {
      kind: "screen",
      name: "Cart",
      dsPath: null,
      codePath: "p",
      status: "code-only",
    });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", { kind: "component" });
    const detail = parseToolDetail(result) as {
      results: { name: string; kind: string }[];
    };
    expect(detail.results.every((r) => r.kind === "component")).toBe(true);
  });

  it("query is no longer required: {} returns all rows", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "p",
      codePath: null,
      status: "design-only",
    });
    upsertRegistry(db, {
      kind: "screen",
      name: "Cart",
      dsPath: null,
      codePath: "p",
      status: "code-only",
    });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", {});
    const detail = parseToolDetail(result) as { results: { name: string }[] };
    expect(detail.results.map((r) => r.name).sort()).toEqual(["Button", "Cart"]);
  });

  it("query prefix match still works alongside other filters", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "p",
      codePath: null,
      status: "design-only",
    });
    upsertRegistry(db, {
      kind: "component",
      name: "ButtonGroup",
      dsPath: "p",
      codePath: null,
      status: "synced",
    });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", {
      query: "Button",
      status: "synced",
    });
    const detail = parseToolDetail(result) as { results: { name: string }[] };
    expect(detail.results.map((r) => r.name)).toEqual(["ButtonGroup"]);
  });

  it("summary mentions the filters", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "p",
      codePath: null,
      status: "design-only",
    });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", { status: "design-only" });
    expect(result.content[0]?.text).toContain("design-only");
  });
});
