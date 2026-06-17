import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
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
import { nullProgressEmitter } from "../../sync/progress.js";

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

function makeSingleFileFetch(fileKey: string): typeof globalThis.fetch {
  return makeFetch({
    [`/v1/files/${fileKey}/components`]: () => ({
      meta: { components: [{ key: "component-key", node_id: "button-node", name: "Button" }] },
    }),
    [`/v1/files/${fileKey}/component_sets`]: () => ({ meta: { component_sets: [] } }),
    [`/v1/files/${fileKey}/styles`]: () => ({ meta: { styles: [] } }),
    [`/v1/files/${fileKey}/variables/local`]: () => ({ meta: { variables: {}, variableCollections: {} } }),
    [`/v1/files/${fileKey}/nodes`]: () => ({ nodes: {} }),
    [`/v1/files/${fileKey}`]: () => ({
      name: "FileA",
      document: {
        children: [
          {
            id: "page-1",
            name: "Components",
            children: [{ id: "button-node", name: "Button" }],
          },
        ],
      },
    }),
  });
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
      progress: nullProgressEmitter(),
    });

    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Synced 2");
    expect(existsSync(manifestPath(root))).toBe(true);
  });

  it("uses FIGMA_TOKEN from project .env when config token is omitted", async () => {
    const previousToken = process.env.FIGMA_TOKEN;
    delete process.env.FIGMA_TOKEN;

    try {
      const root = mkTmp();
      const cfg = defaultConfig();
      cfg.figma.designSystemFiles = [{ key: "FA", name: "FileA" }];
      await writeConfig(root, cfg);
      writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_from_project_env\n");

      let capturedToken: string | undefined;
      const registry = makeRegistry();
      const ctx: ToolContext = {
        root,
        loadConfig: async () => cfg,
      };

      registerSyncTools(registry, ctx, {
        figmaClientFactory: (token: string) => {
          capturedToken = token;
          return new FigmaClient({
            token,
            fetch: makeSingleFileFetch("FA"),
            limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
            backoffOpts: FAST,
          });
        },
        progress: nullProgressEmitter(),
      });

      const result = await callTool(registry, "kotikit_sync_ds", {});

      expect(result.isError).toBeFalsy();
      expect(capturedToken).toBe("figd_from_project_env");
    } finally {
      if (previousToken === undefined) {
        delete process.env.FIGMA_TOKEN;
      } else {
        process.env.FIGMA_TOKEN = previousToken;
      }
    }
  });

  it("reloads FIGMA_TOKEN from project .env when the existing value is an empty placeholder", async () => {
    const previousToken = process.env.FIGMA_TOKEN;
    process.env.FIGMA_TOKEN = "";

    try {
      const root = mkTmp();
      const cfg = defaultConfig();
      cfg.figma.designSystemFiles = [{ key: "FA", name: "FileA" }];
      await writeConfig(root, cfg);
      writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_updated_after_start\n");

      let capturedToken: string | undefined;
      const registry = makeRegistry();
      const ctx: ToolContext = {
        root,
        loadConfig: async () => cfg,
      };

      registerSyncTools(registry, ctx, {
        figmaClientFactory: (token: string) => {
          capturedToken = token;
          return new FigmaClient({
            token,
            fetch: makeSingleFileFetch("FA"),
            limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
            backoffOpts: FAST,
          });
        },
        progress: nullProgressEmitter(),
      });

      const result = await callTool(registry, "kotikit_sync_ds", {});

      expect(result.isError).toBeFalsy();
      expect(capturedToken).toBe("figd_updated_after_start");
    } finally {
      if (previousToken === undefined) {
        delete process.env.FIGMA_TOKEN;
      } else {
        process.env.FIGMA_TOKEN = previousToken;
      }
    }
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
    registerSyncTools(registry, ctx, { progress: nullProgressEmitter() });
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
    registerSyncTools(registry, ctx, { progress: nullProgressEmitter() });
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
    registerSyncTools(registry, ctx, { progress: nullProgressEmitter() });
    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.toLowerCase()).toContain("set up");
  });

  it("happy path: notes that variables were skipped (Enterprise)", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token-value";
    cfg.figma.designSystemFiles = [{ key: "FX", name: "FileX" }];
    await writeConfig(root, cfg);

    // fetch403 returns a proper 403 response for variables/local (simulates free-plan / non-Enterprise)
    const fetch403 = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/variables/local")) {
        return new Response(JSON.stringify({}), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/v1/files/FX/components")) return jsonRes({ meta: { components: [{ key: "ckX", node_id: "btnX", name: "Button" }] } });
      if (u.includes("/v1/files/FX/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/FX/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/FX/nodes")) return jsonRes({ nodes: {} });
      return jsonRes({ name: "FileX", document: { children: [{ id: "p1", name: "Components", children: [{ id: "btnX", name: "Button" }] }] } });
    }) as unknown as typeof globalThis.fetch;

    const registry = makeRegistry();
    const ctx: ToolContext = {
      root,
      loadConfig: async () => cfg,
    };

    registerSyncTools(registry, ctx, {
      figmaClientFactory: (token: string) => new FigmaClient({
        token,
        fetch: fetch403,
        limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
        backoffOpts: FAST,
      }),
      progress: nullProgressEmitter(),
    });

    const result = await callTool(registry, "kotikit_sync_ds", {});
    expect(result.isError).toBeFalsy();
    // The summary should mention Enterprise so free-plan users understand the skip
    expect(result.content[0]?.text).toContain("Enterprise");
  });
});
