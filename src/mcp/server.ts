#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../config/load.js";
import { defaultConfig } from "../config/schema.js";
import { loadFlowCatalog } from "../core/flows/catalog.js";
import { createGraphRuntime, type GraphRuntime } from "../core/graph/runtime.js";
import { createBuiltInNodeRegistry } from "../core/nodes/built-in-registry.js";
import { createArtifactStore } from "../core/runs/artifact-store.js";
import { createCheckpointStore } from "../core/runs/checkpoint-store.js";
import { createRunStore } from "../core/runs/run-store.js";
import type { FlowDefinition } from "../core/schemas/flow-definition.js";
import { loadDotEnv } from "../util/env.js";
import { findProjectRoot } from "../util/paths.js";
import { KotikitError, toolError } from "../util/result.js";
import { type BridgeManager, createBridgeManager } from "./bridge/manager.js";
import type { ToolContext } from "./context.js";
import { completeFacadeArgument } from "./facade/completions.js";
import { getFacadePrompt, listFacadePrompts } from "./facade/prompts.js";
import { listFacadeResourceTemplates, readFacadeResource } from "./facade/resources.js";
import { type FacadeRuntime, registerFacadeTools } from "./facade/tools.js";
import { KOTIKIT_MCP_INSTRUCTIONS } from "./instructions.js";
import { registerBrainstormTools } from "./tools/brainstorm.js";
import { registerBridgeTools } from "./tools/bridge.js";
import { registerComponentPlanTools } from "./tools/component-plan.js";
import { registerConfigTools } from "./tools/config.js";
import { registerDesignApplyTools } from "./tools/design-apply.js";
import { registerDesignCommentTools } from "./tools/design-comments.js";
import { registerDesignReviewTools } from "./tools/design-review.js";
import { registerDesignScreenTools } from "./tools/design-screen.js";
import { registerDsSearchTools } from "./tools/ds-search.js";
import { registerFigmaTargetTools } from "./tools/figma-target.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerIconsSearchTools } from "./tools/icons-search.js";
import { registerPlanDesignTools } from "./tools/plan-design.js";
import { registerPluginVariableTools } from "./tools/plugin-variables.js";
import { registerSpecTools } from "./tools/spec.js";
import { registerSyncTools } from "./tools/sync.js";
import { registerSystemPromptTools } from "./tools/system-prompt.js";
import { registerWorkflowTools } from "./tools/workflow.js";

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

export function toMcpRequestError(err: unknown): McpError {
  if (err instanceof McpError) return err;
  if (err instanceof KotikitError) {
    return new McpError(
      ErrorCode.InvalidParams,
      err.userMessage,
      err.hint === undefined ? undefined : { hint: err.hint }
    );
  }
  return new McpError(
    ErrorCode.InternalError,
    "Something went wrong. The operation did not complete. Please try again, or check that the project is set up correctly."
  );
}

/**
 * Build the server and return it along with the registry.
 * Exported so tests can inspect the registry without spawning a process.
 */
export function buildServer(options: { root?: string } = {}): {
  server: Server;
  registry: ToolRegistry;
  bridge: BridgeManager;
  runtime: FacadeRuntime;
} {
  const server = new Server(
    { name: "kotikit", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
      instructions: KOTIKIT_MCP_INSTRUCTIONS,
    }
  );

  const tools: Tool[] = [];
  const handlers = new Map<string, Handler>();
  const registry: ToolRegistry = { tools, handlers };

  const root = options.root ?? findProjectRoot();
  const bridge = createBridgeManager({ registry, root });
  const ctx: ToolContext = {
    root,
    loadConfig: () => loadConfig(root),
    bridge,
  };
  const loadFlows = createServerFlowLoader(root);
  const runtime = createServerGraphRuntime(root, loadFlows);

  registerFacadeTools(registry, ctx, { runtime, loadFlows });
  registerSpecTools(registry, ctx);
  registerConfigTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  registerDsSearchTools(registry, ctx);
  registerIconsSearchTools(registry, ctx);
  registerSyncTools(registry, ctx);
  registerComponentPlanTools(registry, ctx);
  registerFigmaTargetTools(registry, ctx);
  registerPlanDesignTools(registry, ctx);
  registerDesignScreenTools(registry, ctx);
  registerDesignApplyTools(registry, ctx);
  registerDesignCommentTools(registry, ctx);
  registerDesignReviewTools(registry, ctx);
  registerSystemPromptTools(registry, ctx);
  registerPluginVariableTools(registry, ctx);
  registerBridgeTools(registry, ctx);
  registerWorkflowTools(registry, ctx);

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

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: listFacadeResourceTemplates(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      return await readFacadeResource(request.params.uri, { runtime, loadFlows });
    } catch (err) {
      throw toMcpRequestError(err);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listFacadePrompts(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      return getFacadePrompt(request.params.name, request.params.arguments ?? {});
    } catch (err) {
      throw toMcpRequestError(err);
    }
  });

  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    try {
      return await completeFacadeArgument(request.params, { loadFlows });
    } catch (err) {
      throw toMcpRequestError(err);
    }
  });

  return { server, registry, bridge, runtime };
}

function createServerFlowLoader(root: string): () => Promise<FlowDefinition[]> {
  return async () => {
    const config = await loadConfig(root);
    return loadFlowCatalog(root, {
      flowPacks: config?.flowPacks ?? defaultConfig().flowPacks,
    });
  };
}

function createServerGraphRuntime(
  root: string,
  loadFlows: () => Promise<FlowDefinition[]>
): FacadeRuntime {
  const artifactStore = createArtifactStore(root);
  let runtimePromise: Promise<GraphRuntime> | undefined;
  const runtime = async (): Promise<GraphRuntime> => {
    runtimePromise ??= loadFlows().then((flows) =>
      createGraphRuntime({
        registry: createBuiltInNodeRegistry(),
        flowCatalog: flows,
        runStore: createRunStore(root),
        artifactStore,
        checkpointStore: createCheckpointStore(root),
      })
    );
    return runtimePromise;
  };
  return {
    startFlow: async (input) => (await runtime()).startFlow(input),
    continueRun: async (input) => (await runtime()).continueRun(input),
    answerRun: async (input) => (await runtime()).answerRun(input),
    patchRunState: async (input) => (await runtime()).patchRunState(input),
    getRunState: async (runId) => (await runtime()).getRunState(runId),
    getArtifact: async (artifactId) => (await runtime()).getArtifact(artifactId),
    listArtifacts: async (runId) => artifactStore.listArtifacts(runId),
  };
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
