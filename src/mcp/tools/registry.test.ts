import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerRegistryTools } from "./registry.js";
import { openDb } from "../../db/sqlite.js";
import { initRegistryDb, upsertRegistry } from "../../db/registry-db.js";
import { registryDbPath } from "../../util/paths.js";

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
  if (!handler) throw new Error("missing handler " + name);
  return handler(args);
}

function parseDetail(text: string): unknown {
  const i = text.indexOf("\n\n");
  if (i === -1) return {};
  return JSON.parse(text.slice(i + 2));
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
    const detail = parseDetail(result.content[0]!.text) as {
      results: unknown[];
    };
    expect(detail.results).toEqual([]);
  });

  it("seeded registry → search returns matching rows", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      name: "Button",
      codePath: "src/components/ui/button.tsx",
      status: "code-only",
    });
    upsertRegistry(db, {
      name: "Card",
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
    const detail = parseDetail(result.content[0]!.text) as {
      results: { name: string }[];
    };
    expect(detail.results.map((r) => r.name)).toEqual(["Button"]);
  });

  it("respects the limit argument", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    for (let i = 0; i < 10; i++)
      upsertRegistry(db, { name: `Comp${i}`, codePath: "p", status: "code-only" });
    db.close();

    const registry = makeRegistry();
    registerRegistryTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_registry_search", {
      query: "Comp",
      limit: 3,
    });
    const detail = parseDetail(result.content[0]!.text) as {
      results: unknown[];
    };
    expect(detail.results).toHaveLength(3);
  });
});
