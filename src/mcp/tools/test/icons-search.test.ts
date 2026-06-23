import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { initIconsDb, upsertIcon } from "../../../db/icons-db.js";
import { openDb } from "../../../db/sqlite.js";
import { iconsDbPath } from "../../../util/paths.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerIconsSearchTools } from "../icons-search.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-icons-tool-"));
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

function seedIcons(root: string, icons: { name: string; key: string; svg?: string }[]): void {
  const db = openDb(iconsDbPath(root));
  initIconsDb(db);
  for (const i of icons) {
    upsertIcon(db, { name: i.name, key: i.key, signal: "prefix", fileKey: "f", svg: i.svg });
  }
  db.close();
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

describe("kotikit_icons_search", () => {
  it("returns matching icons without svg by default", async () => {
    const root = mkTmp();
    seedIcons(root, [
      { name: "arrow-right", key: "k1", svg: "<svg>R</svg>" },
      { name: "arrow-left", key: "k2", svg: "<svg>L</svg>" },
      { name: "home", key: "k3", svg: "<svg>H</svg>" },
    ]);
    const registry = makeRegistry();
    registerIconsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_icons_search", { query: "arrow*" });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as {
      results: { name: string; svg?: string }[];
    };
    expect(detail.results.map((r) => r.name).sort()).toEqual(["arrow-left", "arrow-right"]);
    for (const r of detail.results) {
      expect(r.svg).toBeUndefined();
    }
  });

  it("includes svg when includeSvg: true", async () => {
    const root = mkTmp();
    seedIcons(root, [{ name: "arrow-right", key: "k1", svg: "<svg>R</svg>" }]);
    const registry = makeRegistry();
    registerIconsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_icons_search", {
      query: "arrow*",
      includeSvg: true,
    });
    expect(result.isError).toBeFalsy();
    const detail = parseToolDetail(result) as {
      results: { name: string; svg?: string }[];
    };
    expect(detail.results[0]?.svg).toBe("<svg>R</svg>");
  });

  it("respects the limit argument", async () => {
    const root = mkTmp();
    seedIcons(root, [
      { name: "arrow-1", key: "k1" },
      { name: "arrow-2", key: "k2" },
      { name: "arrow-3", key: "k3" },
    ]);
    const registry = makeRegistry();
    registerIconsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_icons_search", { query: "arrow*", limit: 2 });
    const detail = parseToolDetail(result) as { results: unknown[] };
    expect(detail.results).toHaveLength(2);
  });

  it("returns friendly error when design system is missing", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerIconsSearchTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_icons_search", { query: "arrow*" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("hasn't been synced");
  });
});
