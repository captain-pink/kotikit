import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { registerSpecTools } from "../../src/mcp/tools/spec.js";
import { registerConfigTools } from "../../src/mcp/tools/config.js";
import { registerFlowTools } from "../../src/mcp/tools/flow.js";
import { registerBrainstormTools } from "../../src/mcp/tools/brainstorm.js";
import { registerDsSearchTools } from "../../src/mcp/tools/ds-search.js";
import { registerIconsSearchTools } from "../../src/mcp/tools/icons-search.js";
import { registerSyncTools } from "../../src/mcp/tools/sync.js";

import { loadConfig, writeConfig } from "../../src/config/load.js";
import type { ToolContext } from "../../src/mcp/context.js";
import type { ToolRegistry } from "../../src/mcp/server.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { SyncManifestSchema } from "../../src/sync/manifest.js";
import { FigmaClient } from "../../src/sync/figma-client.js";
import { createLimiter } from "../../src/sync/rate-limit.js";

import {
  manifestPath,
  componentJsonPath,
  variablesJsonPath,
  syncReportPath,
  componentsDbPath,
  iconsDbPath,
  checkpointPath,
} from "../../src/util/paths.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FAST = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[]; isError?: boolean };

function buildTestServer(
  root: string,
  figmaClientFactory: (token: string) => FigmaClient
): ToolRegistry {
  const tools: Tool[] = [];
  const handlers = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const registry: ToolRegistry = { tools, handlers };
  const ctx: ToolContext = {
    root,
    loadConfig: () => loadConfig(root),
  };
  registerConfigTools(registry, ctx);
  registerSpecTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerDsSearchTools(registry, ctx);
  registerIconsSearchTools(registry, ctx);
  registerSyncTools(registry, ctx, { figmaClientFactory });
  return registry;
}

async function callTool(
  registry: ToolRegistry,
  name: string,
  args: unknown
): Promise<ToolResult> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`Tool not found: ${name}`);
  return handler(args);
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Test 1: Happy path ───────────────────────────────────────────────────────

describe("Phase 2 E2E — sync + search", () => {
  const tmpDirs: string[] = [];
  afterAll(async () => {
    for (const d of tmpDirs)
      await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("config_init → sync_ds → ds_search → ds_get_component → icons_search", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "kotikit-phase2-"));
    tmpDirs.push(tmpDir);

    // Set an env-resolvable token
    process.env.FIGMA_TOKEN_E2E = "test-token-value";

    // Stub fetch returning fixture data for two Figma files, both publishing Button
    const fetchStub = (async (url: string | URL) => {
      const u = url.toString();
      // Most-specific first
      if (u.includes("/v1/files/FA/components"))
        return jsonRes({
          meta: {
            components: [
              {
                key: "ckA-btn",
                node_id: "btnA",
                name: "Button",
                containing_frame: { pageName: "Components" },
              },
              {
                key: "ckA-card",
                node_id: "cardA",
                name: "Card",
                containing_frame: { pageName: "Components" },
              },
              {
                key: "ckA-arr",
                node_id: "arrA",
                name: "arrow-right",
                containing_frame: { pageName: "Icons" },
              },
            ],
          },
        });
      if (u.includes("/v1/files/FA/component_sets"))
        return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/FA/styles"))
        return jsonRes({
          meta: {
            styles: [
              {
                key: "sA1",
                name: "Brand/Blue",
                style_type: "FILL",
                node_id: "styleA1",
              },
            ],
          },
        });
      if (u.includes("/v1/files/FA/variables/local")) return jsonRes({}, 403);
      if (u.includes("/v1/files/FA/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/FA") && !u.includes("/v1/files/FA/"))
        return jsonRes({
          name: "FileA",
          document: {
            children: [
              {
                id: "p1",
                name: "Components",
                children: [
                  { id: "btnA", name: "Button" },
                  { id: "cardA", name: "Card" },
                ],
              },
              {
                id: "p2",
                name: "Icons",
                children: [{ id: "arrA", name: "arrow-right" }],
              },
            ],
          },
        });
      if (u.includes("/v1/files/FB/components"))
        return jsonRes({
          meta: {
            components: [
              {
                key: "ckB-btn",
                node_id: "btnB",
                name: "Button",
                containing_frame: { pageName: "Components" },
              },
            ],
          },
        });
      if (u.includes("/v1/files/FB/component_sets"))
        return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/FB/styles"))
        return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/FB/variables/local")) return jsonRes({}, 403);
      if (u.includes("/v1/files/FB/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/FB") && !u.includes("/v1/files/FB/"))
        return jsonRes({
          name: "FileB",
          document: {
            children: [
              {
                id: "p1",
                name: "Components",
                children: [{ id: "btnB", name: "Button" }],
              },
            ],
          },
        });
      throw new Error("no fixture for " + u);
    }) as unknown as typeof globalThis.fetch;

    const figmaClientFactory = (token: string) =>
      new FigmaClient({
        token,
        fetch: fetchStub,
        limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
        backoffOpts: FAST,
      });

    const registry = buildTestServer(tmpDir, figmaClientFactory);

    // Step 1: init config with two Figma files
    await callTool(registry, "kotikit_config_init", {
      framework: "react",
      tests: true,
      autoCommit: false,
      figmaFiles: [
        { key: "FA", name: "FileA" },
        { key: "FB", name: "FileB" },
      ],
    });

    // Manually set the token to an env reference in the config
    const cfg = await loadConfig(tmpDir);
    if (!cfg) throw new Error("config missing");
    cfg.figma.token = "${FIGMA_TOKEN_E2E}";
    await writeConfig(tmpDir, cfg);

    // Step 2: sync
    const syncResult = await callTool(registry, "kotikit_sync_ds", {});
    expect(syncResult.isError).toBeFalsy();

    // Step 3: assert on-disk artifacts
    expect(existsSync(manifestPath(tmpDir))).toBe(true);
    expect(existsSync(componentsDbPath(tmpDir))).toBe(true);
    expect(existsSync(iconsDbPath(tmpDir))).toBe(true);
    expect(existsSync(variablesJsonPath(tmpDir))).toBe(true);
    expect(existsSync(syncReportPath(tmpDir))).toBe(true);
    expect(existsSync(checkpointPath(tmpDir))).toBe(false);

    const manifestRaw = JSON.parse(
      await readFile(manifestPath(tmpDir), "utf-8")
    );
    const manifest = SyncManifestSchema.parse(manifestRaw);
    expect(manifest.files).toHaveLength(2);
    // Conflict on Button (both files publish it)
    expect(
      manifest.conflicts.find((c) => c.name === "Button")?.winnerFileKey
    ).toBe("FB");

    // Step 4: ds_search finds Button (only one row)
    const searchResult = await callTool(registry, "kotikit_ds_search", {
      query: "but*",
    });
    expect(searchResult.isError).toBeFalsy();
    expect(searchResult.content[0]?.text).toContain("Button");

    // Parse the JSON detail from toolText for typed assertions
    const detail = JSON.parse(
      searchResult.content[0]!.text.split("\n\n")[1]!
    ) as {
      results: { name: string; path: string; key: string; fileKey: string }[];
    };
    const buttonRow = detail.results.find((r) => r.name === "Button");
    expect(buttonRow).toBeDefined();
    expect(buttonRow!.fileKey).toBe("FB"); // later file wins

    // Step 5: ds_get_component returns the JSON
    const getResult = await callTool(registry, "kotikit_ds_get_component", {
      path: buttonRow!.path,
    });
    expect(getResult.isError).toBeFalsy();
    expect(getResult.content[0]?.text).toContain("Button");

    // Verify on disk
    const buttonJson = JSON.parse(
      await readFile(componentJsonPath(tmpDir, "button"), "utf-8")
    );
    expect(buttonJson.fileKey).toBe("FB");

    // Step 6: icons_search returns the arrow-right icon, no svg by default
    const iconsResult = await callTool(registry, "kotikit_icons_search", {
      query: "arrow*",
    });
    expect(iconsResult.isError).toBeFalsy();
    const iconsDetail = JSON.parse(
      iconsResult.content[0]!.text.split("\n\n")[1]!
    ) as {
      results: { name: string; key: string; svg?: string }[];
    };
    expect(iconsDetail.results.some((r) => r.name === "arrow-right")).toBe(
      true
    );
    for (const r of iconsDetail.results) expect(r.svg).toBeUndefined();
  });
});

// ─── Test 2: Failure-then-resume ─────────────────────────────────────────────

describe("Phase 2 E2E — checkpoint resume", () => {
  const tmpDirs: string[] = [];
  afterAll(async () => {
    for (const d of tmpDirs)
      await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("a mid-sync failure persists the checkpoint; a retry completes", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "kotikit-phase2-resume-"));
    tmpDirs.push(tmpDir);

    let mode: "fail" | "ok" = "fail";

    const fetchStub = (async (url: string | URL) => {
      const u = url.toString();
      if (mode === "fail" && u.includes("/v1/files/FB/styles")) {
        return jsonRes({}, 500); // hard 5xx — backoff with maxAttempts:3 will exhaust
      }
      if (u.includes("/v1/files/FA/components"))
        return jsonRes({
          meta: {
            components: [{ key: "ckA-btn", node_id: "btnA", name: "Button" }],
          },
        });
      if (u.includes("/v1/files/FA/component_sets"))
        return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/FA/styles"))
        return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/FA/variables/local")) return jsonRes({}, 403);
      if (u.includes("/v1/files/FA/nodes")) return jsonRes({ nodes: {} });
      if (u.endsWith("/v1/files/FA"))
        return jsonRes({
          name: "FA",
          document: {
            children: [
              {
                id: "p1",
                name: "Components",
                children: [{ id: "btnA", name: "Button" }],
              },
            ],
          },
        });

      if (u.includes("/v1/files/FB/components"))
        return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/FB/component_sets"))
        return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/FB/styles"))
        return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/FB/variables/local")) return jsonRes({}, 403);
      if (u.includes("/v1/files/FB/nodes")) return jsonRes({ nodes: {} });
      if (u.endsWith("/v1/files/FB"))
        return jsonRes({ name: "FB", document: { children: [] } });
      throw new Error("no fixture for " + u);
    }) as unknown as typeof globalThis.fetch;

    const figmaClientFactory = (token: string) =>
      new FigmaClient({
        token,
        fetch: fetchStub,
        limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
        backoffOpts: FAST,
      });

    const registry = buildTestServer(tmpDir, figmaClientFactory);

    await callTool(registry, "kotikit_config_init", {
      framework: "react",
      tests: true,
      autoCommit: false,
      figmaFiles: [
        { key: "FA", name: "FA" },
        { key: "FB", name: "FB" },
      ],
    });
    const cfg = await loadConfig(tmpDir);
    if (!cfg) throw new Error("config missing");
    cfg.figma.token = "plain-test-token";
    await writeConfig(tmpDir, cfg);

    // First attempt — expected to fail on FB/styles
    const first = await callTool(registry, "kotikit_sync_ds", {});
    expect(first.isError).toBe(true);
    expect(existsSync(checkpointPath(tmpDir))).toBe(true);

    // Flip the fixture to success and retry
    mode = "ok";
    const second = await callTool(registry, "kotikit_sync_ds", {});
    expect(second.isError).toBeFalsy();
    expect(existsSync(checkpointPath(tmpDir))).toBe(false);
    expect(existsSync(manifestPath(tmpDir))).toBe(true);
  });
});
