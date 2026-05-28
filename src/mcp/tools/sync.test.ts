import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerSyncTools } from "./sync.js";
import { FigmaClient } from "../../sync/figma-client.js";
import { createLimiter } from "../../sync/rate-limit.js";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { manifestPath } from "../../util/paths.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-syncds-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

const FAST = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 };

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(handlers: Record<string, () => unknown>): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    // Most-specific first
    for (const pattern of Object.keys(handlers)) {
      if (u.includes(pattern)) return jsonRes(handlers[pattern]!());
    }
    return jsonRes({ name: "x", document: { children: [] } });
  }) as unknown as typeof globalThis.fetch;
}

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}

async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error("missing handler " + name);
  return handler(args);
}

describe("kotikit_sync_ds", () => {
  it("happy path: two files, both with components, one conflict", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token-value";  // resolveSecret returns plain string as-is
    cfg.figma.designSystemFiles = [
      { key: "FA", name: "FileA" },
      { key: "FB", name: "FileB" },
    ];
    await writeConfig(root, cfg);

    const fetch = makeFetch({
      "/v1/files/FA/components": () => ({ meta: { components: [{ key: "ckA", node_id: "btnA", name: "Button" }] } }),
      "/v1/files/FA/component_sets": () => ({ meta: { component_sets: [] } }),
      "/v1/files/FA/styles": () => ({ meta: { styles: [] } }),
      "/v1/files/FA/variables/local": () => ({ meta: { variables: {}, variableCollections: {} } }),
      "/v1/files/FA/nodes": () => ({ nodes: {} }),
      "/v1/files/FA": () => ({ name: "FileA", document: { children: [{ id: "p1", name: "Components", children: [{ id: "btnA", name: "Button" }] }] } }),
      "/v1/files/FB/components": () => ({ meta: { components: [{ key: "ckB", node_id: "btnB", name: "Button" }] } }),
      "/v1/files/FB/component_sets": () => ({ meta: { component_sets: [] } }),
      "/v1/files/FB/styles": () => ({ meta: { styles: [] } }),
      "/v1/files/FB/variables/local": () => ({ meta: { variables: {}, variableCollections: {} } }),
      "/v1/files/FB/nodes": () => ({ nodes: {} }),
      "/v1/files/FB": () => ({ name: "FileB", document: { children: [{ id: "p1", name: "Components", children: [{ id: "btnB", name: "Button" }] }] } }),
    });

    const registry = makeRegistry();
    const ctx: ToolContext = {
      root,
      loadConfig: async () => cfg,
    };

    registerSyncTools(registry, ctx, {
      figmaClientFactory: (token: string) => new FigmaClient({
        token,
        fetch,
        limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
        backoffOpts: FAST,
      }),
    });

    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Synced 2");
    expect(existsSync(manifestPath(root))).toBe(true);
  });

  it("friendly error when no token resolved", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    // token is undefined / empty
    cfg.figma.designSystemFiles = [{ key: "FA", name: "FileA" }];
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    const ctx: ToolContext = {
      root,
      loadConfig: async () => cfg,
    };
    registerSyncTools(registry, ctx);
    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.toLowerCase()).toContain("token");
  });

  it("friendly error when no files configured", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    cfg.figma.designSystemFiles = [];
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    const ctx: ToolContext = {
      root,
      loadConfig: async () => cfg,
    };
    registerSyncTools(registry, ctx);
    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.toLowerCase()).toContain("file");
  });

  it("friendly error when config is missing", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    const ctx: ToolContext = {
      root,
      loadConfig: async () => null,
    };
    registerSyncTools(registry, ctx);
    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.toLowerCase()).toContain("set up");
  });
});
