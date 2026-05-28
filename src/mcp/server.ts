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

/** Start the MCP server connected to stdio. */
export async function startServer(): Promise<void> {
  const root = findProjectRoot();
  const { server } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[kotikit] MCP server started. Root: ${root}\n`);
}

if (import.meta.main) {
  await startServer();
}
