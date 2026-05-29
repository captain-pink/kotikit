#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { findProjectRoot } from "../util/paths.js";
import { loadConfig } from "../config/load.js";
import { KotikitError, toolError } from "../util/result.js";
import type { ToolContext } from "./context.js";
import { registerSpecTools } from "./tools/spec.js";
import { registerConfigTools } from "./tools/config.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerBrainstormTools } from "./tools/brainstorm.js";
import { registerDsSearchTools } from "./tools/ds-search.js";
import { registerIconsSearchTools } from "./tools/icons-search.js";
import { registerSyncTools } from "./tools/sync.js";
import { registerPlanCodeTools } from "./tools/plan-code.js";
import { registerImplementCodeTools } from "./tools/implement-code.js";
import { registerRegistryTools } from "./tools/registry.js";
import { registerScaffoldTools } from "./tools/scaffold.js";
import { registerPlanDesignTools } from "./tools/plan-design.js";
import { registerDesignScreenTools } from "./tools/design-screen.js";
import { registerDesignApplyTools } from "./tools/design-apply.js";
import { startBridgeServer, type BridgeServer } from "./bridge/server.js";
import {
  generateBridgeToken,
  writeBridgeConfig,
  clearBridgeConfig,
} from "./bridge/token.js";
import { nowIso } from "../util/ids.js";
import { basename } from "path";

/** The return type every tool handler must produce. */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

type Handler = (args: unknown) => Promise<ToolResult>;

/** Shared registry passed to each tool registrar. */
export interface ToolRegistry {
  tools: Tool[];
  handlers: Map<string, Handler>;
}

/**
 * Build the server and return it along with the registry.
 * Exported so tests can inspect the registry without spawning a process.
 */
export function buildServer(): { server: Server; registry: ToolRegistry } {
  const server = new Server(
    { name: "kotikit", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const tools: Tool[] = [];
  const handlers = new Map<string, Handler>();
  const registry: ToolRegistry = { tools, handlers };

  const root = findProjectRoot();
  const ctx: ToolContext = {
    root,
    loadConfig: () => loadConfig(root),
  };

  registerSpecTools(registry, ctx);
  registerConfigTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerDsSearchTools(registry, ctx);
  registerIconsSearchTools(registry, ctx);
  registerSyncTools(registry, ctx);
  registerPlanCodeTools(registry, ctx);
  registerImplementCodeTools(registry, ctx);
  registerRegistryTools(registry, ctx);
  registerScaffoldTools(registry, ctx);
  registerPlanDesignTools(registry, ctx);
  registerDesignScreenTools(registry, ctx);
  registerDesignApplyTools(registry, ctx);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const handler = handlers.get(name);
    if (!handler) {
      return toolError(new KotikitError(`Unknown tool: ${name}`));
    }
    try {
      return await handler(request.params.arguments ?? {});
    } catch (err) {
      return toolError(err);
    }
  });

  return { server, registry };
}

/**
 * Try to bind a WebSocket bridge to a port, starting from `preferredPort` and
 * incrementing if the port is in use. Returns the bound BridgeServer + port.
 */
async function tryStartBridge(
  registry: ToolRegistry,
  root: string,
  preferredPort: number
): Promise<{ bridge: BridgeServer; port: number; token: string }> {
  for (let port = preferredPort; port < preferredPort + 50; port++) {
    try {
      const token = generateBridgeToken();
      const cfg = {
        version: 1 as const,
        port,
        token,
        projectRoot: root,
        projectName: basename(root),
        startedAt: nowIso(),
      };
      // Pre-write the config so it's available even before onReady fires
      await writeBridgeConfig(root, cfg);
      const bridge = startBridgeServer({ registry, config: cfg });
      return { bridge, port, token };
    } catch {
      // Port likely in use — try the next one
      continue;
    }
  }
  throw new Error(`[kotikit] Could not bind bridge: ports ${preferredPort}-${preferredPort + 49} all in use.`);
}

/** Start the MCP server connected to stdio. Optionally also starts the bridge. */
export async function startServer(): Promise<void> {
  const root = findProjectRoot();
  const { server, registry } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[kotikit] MCP server started. Root: ${root}\n`);

  // Opt-in bridge: KOTIKIT_BRIDGE=1 OR --bridge flag
  const bridgeEnabled =
    process.env.KOTIKIT_BRIDGE === "1" || process.argv.includes("--bridge");

  if (bridgeEnabled) {
    const preferredPort = Number(process.env.KOTIKIT_BRIDGE_PORT ?? "53124");
    const { port, token } = await tryStartBridge(registry, root, preferredPort);
    process.stderr.write(
      `[kotikit] Bridge running at ws://localhost:${port}?token=${token}\n` +
      `[kotikit] Copy that URL into the kotikit Figma plugin's Connect dialog.\n`
    );

    const cleanup = async (): Promise<void> => {
      await clearBridgeConfig(root).catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}

if (import.meta.main) {
  await startServer();
}
