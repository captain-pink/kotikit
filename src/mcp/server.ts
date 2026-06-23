#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../config/load.js";
import { loadDotEnv } from "../util/env.js";
import { findProjectRoot } from "../util/paths.js";
import { KotikitError, toolError } from "../util/result.js";
import { type BridgeManager, createBridgeManager } from "./bridge/manager.js";
import type { ToolContext } from "./context.js";
import { KOTIKIT_MCP_INSTRUCTIONS } from "./instructions.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerBrainstormTools } from "./tools/brainstorm.js";
import { registerBridgeTools } from "./tools/bridge.js";
import { registerComponentPlanTools } from "./tools/component-plan.js";
import { registerConfigTools } from "./tools/config.js";
import { registerDesignApplyTools } from "./tools/design-apply.js";
import { registerDesignCommentTools } from "./tools/design-comments.js";
import { registerDesignReviewTools } from "./tools/design-review.js";
import { registerDesignScreenTools } from "./tools/design-screen.js";
import { registerDoctorTools } from "./tools/doctor.js";
import { registerDsSearchTools } from "./tools/ds-search.js";
import { registerFigmaTargetTools } from "./tools/figma-target.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerIconsSearchTools } from "./tools/icons-search.js";
import { registerImplementCodeTools } from "./tools/implement-code.js";
import { registerPlanCodeTools } from "./tools/plan-code.js";
import { registerPlanDesignTools } from "./tools/plan-design.js";
import { registerPluginVariableTools } from "./tools/plugin-variables.js";
import { registerRegistryTools } from "./tools/registry.js";
import { registerScaffoldTools } from "./tools/scaffold.js";
import { registerSpecTools } from "./tools/spec.js";
import { registerSyncTools } from "./tools/sync.js";
import { registerSystemPromptTools } from "./tools/system-prompt.js";

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
export function buildServer(): { server: Server; registry: ToolRegistry; bridge: BridgeManager } {
  const server = new Server(
    { name: "kotikit", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: KOTIKIT_MCP_INSTRUCTIONS,
    }
  );

  const tools: Tool[] = [];
  const handlers = new Map<string, Handler>();
  const registry: ToolRegistry = { tools, handlers };

  const root = findProjectRoot();
  const bridge = createBridgeManager({ registry, root });
  const ctx: ToolContext = {
    root,
    loadConfig: () => loadConfig(root),
    bridge,
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
  registerComponentPlanTools(registry, ctx);
  registerFigmaTargetTools(registry, ctx);
  registerPlanDesignTools(registry, ctx);
  registerDesignScreenTools(registry, ctx);
  registerDesignApplyTools(registry, ctx);
  registerDesignCommentTools(registry, ctx);
  registerDesignReviewTools(registry, ctx);
  registerAuditTools(registry, ctx);
  registerSystemPromptTools(registry, ctx);
  registerDoctorTools(registry, ctx);
  registerPluginVariableTools(registry, ctx);
  registerBridgeTools(registry, ctx);

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

  return { server, registry, bridge };
}

/** Start the MCP server connected to stdio. Optionally also starts the bridge. */
export async function startServer(): Promise<void> {
  const root = findProjectRoot();
  const injected = await loadDotEnv(root);
  if (injected.length > 0) {
    process.stderr.write(`[kotikit] Loaded ${injected.length} env var(s) from ${root}/.env\n`);
  }
  const { server, bridge } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[kotikit] MCP server started. Root: ${root}\n`);

  // Opt-in bridge: KOTIKIT_BRIDGE=1 OR --bridge flag
  const bridgeEnabled = process.env.KOTIKIT_BRIDGE === "1" || process.argv.includes("--bridge");

  if (bridgeEnabled) {
    const preferredPort = Number(process.env.KOTIKIT_BRIDGE_PORT ?? "53124");
    const status = await bridge.start({ preferredPort });
    process.stderr.write(
      `[kotikit] Bridge running at ${status.url}\n` +
        `[kotikit] Copy that URL into the kotikit Figma plugin's Connect dialog.\n`
    );

    const cleanup = async (): Promise<void> => {
      await bridge.stop().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}

if (import.meta.main) {
  await startServer();
}
