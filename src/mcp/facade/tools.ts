import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadBuiltInFlows } from "../../core/flows/catalog.js";
import { computeStableHash } from "../../core/graph/graph-hash.js";
import type {
  GraphRuntime,
  RuntimeRunResult,
  RuntimeStartInput,
} from "../../core/graph/runtime.js";
import type { Artifact } from "../../core/schemas/artifact.js";
import { type FlowDefinition, FlowDefinitionSchema } from "../../core/schemas/flow-definition.js";
import { runKotikitDoctor } from "../../doctor/doctor.js";
import { DESIGN_PLAN_STEP_KINDS } from "../../planning/design-plan-schema.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

export const FACADE_TOOL_NAMES = [
  "kotikit_flow_list",
  "kotikit_flow_validate",
  "kotikit_start",
  "kotikit_continue",
  "kotikit_answer",
  "kotikit_get_artifact",
  "kotikit_list_artifacts",
  "kotikit_search_design_system",
  "kotikit_record_figma_apply",
  "kotikit_review_figma_target",
  "kotikit_doctor",
] as const;

export type FacadeToolName = (typeof FACADE_TOOL_NAMES)[number];

export type FacadeRuntime = Pick<
  GraphRuntime,
  "startFlow" | "continueRun" | "answerRun" | "getRunState" | "getArtifact"
> & {
  listArtifacts?(runId?: string): Promise<Artifact[]>;
};

export type FacadeToolDependencies = {
  runtime?: FacadeRuntime;
  loadFlows?: () => Promise<FlowDefinition[]>;
};

const FlowValidateInputSchema = z
  .strictObject({
    flowId: z.string().min(1).optional(),
    flow: z.unknown().optional(),
  })
  .refine((input) => input.flowId !== undefined || input.flow !== undefined, {
    message: "Pass either flowId or flow.",
  });

const RuntimeProjectInputSchema = z.strictObject({
  root: z.string().min(1),
  name: z.string().min(1).optional(),
});

const StartInputSchema = z.strictObject({
  flowId: z.string().min(1),
  input: z
    .strictObject({
      project: RuntimeProjectInputSchema.optional(),
      userIntent: z.string().min(1).optional(),
    })
    .optional(),
});

const RunIdInputSchema = z.strictObject({
  runId: z.string().min(1),
});

const AnswerInputSchema = z.strictObject({
  runId: z.string().min(1),
  answer: z.string().min(1),
});

const GetArtifactInputSchema = z.strictObject({
  artifactId: z.string().min(1),
});

const ListArtifactsInputSchema = z.strictObject({
  runId: z.string().min(1).optional(),
});

type ToolHandler = ToolRegistry["handlers"] extends Map<string, infer Handler> ? Handler : never;

export function registerFacadeTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  deps: FacadeToolDependencies = {}
): void {
  const loadFlows = deps.loadFlows ?? loadBuiltInFlows;

  registerTool(registry, {
    name: "kotikit_flow_list",
    description:
      "List available kotikit designer flows as compact summaries without full graph manifests.",
    inputSchema: emptyInputSchema(),
  });
  registry.handlers.set("kotikit_flow_list", async () => {
    try {
      const flows = await loadFlows();
      return toolText(`Found ${flows.length} kotikit flows.`, {
        flows: flows.map(compactFlow),
      });
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_flow_validate",
    description: "Validate a kotikit flow manifest or built-in flow id before execution.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "Built-in or loaded flow id to validate." },
        flow: { type: "object", description: "Flow manifest JSON to validate." },
      },
    },
  });
  registry.handlers.set("kotikit_flow_validate", async (args) => {
    try {
      const input = FlowValidateInputSchema.parse(args);
      const flow =
        input.flow === undefined
          ? findFlow(await loadFlows(), input.flowId ?? "")
          : FlowDefinitionSchema.parse(input.flow);
      return toolText(`Flow ${flow.id} is valid.`, {
        valid: true,
        flow: compactFlow(flow),
        manifestHash: computeStableHash(flow),
      });
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_start",
    description: "Start a built-in, project, or allowlisted extension designer flow.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "Flow id from kotikit_flow_list." },
        input: {
          type: "object",
          properties: {
            userIntent: { type: "string", description: "Designer request in plain language." },
            project: {
              type: "object",
              properties: {
                root: {
                  type: "string",
                  description: "Project root to use when overriding the MCP root.",
                },
                name: { type: "string", description: "Optional project name." },
              },
              required: ["root"],
            },
          },
        },
      },
      required: ["flowId"],
    },
  });
  registry.handlers.set("kotikit_start", async (args) => {
    try {
      const input = StartInputSchema.parse(args);
      const runtime = requireRuntime(deps.runtime);
      const startInput: RuntimeStartInput = {
        project: input.input?.project ?? { root: ctx.root },
        ...(input.input?.userIntent === undefined ? {} : { userIntent: input.input.userIntent }),
      };
      return toolText(
        `Started ${input.flowId}.`,
        compactRunResult(await runtime.startFlow({ flowId: input.flowId, input: startInput }))
      );
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_continue",
    description: "Continue a running kotikit flow that is not waiting for designer input.",
    inputSchema: runIdInputSchema(),
  });
  registry.handlers.set("kotikit_continue", async (args) => {
    try {
      const input = RunIdInputSchema.parse(args);
      const runtime = requireRuntime(deps.runtime);
      return toolText(
        `Continued run ${input.runId}.`,
        compactRunResult(await runtime.continueRun({ runId: input.runId }))
      );
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_answer",
    description: "Answer a human-in-the-loop question and resume the paused kotikit flow.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Paused run id." },
        answer: { type: "string", description: "Designer answer." },
      },
      required: ["runId", "answer"],
    },
  });
  registry.handlers.set("kotikit_answer", async (args) => {
    try {
      const input = AnswerInputSchema.parse(args);
      const runtime = requireRuntime(deps.runtime);
      return toolText(
        `Answered run ${input.runId}.`,
        compactRunResult(await runtime.answerRun({ runId: input.runId, answer: input.answer }))
      );
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_get_artifact",
    description: "Read one compact kotikit flow artifact by id.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact id returned by a flow run." },
      },
      required: ["artifactId"],
    },
  });
  registry.handlers.set("kotikit_get_artifact", async (args) => {
    try {
      const input = GetArtifactInputSchema.parse(args);
      const runtime = requireRuntime(deps.runtime);
      const artifact = await runtime.getArtifact(input.artifactId);
      return toolText(`Read artifact ${artifact.id}.`, { artifact });
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_list_artifacts",
    description: "List artifacts for a kotikit run, or all available artifacts when supported.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Optional run id filter." },
      },
    },
  });
  registry.handlers.set("kotikit_list_artifacts", async (args) => {
    try {
      const input = ListArtifactsInputSchema.parse(args);
      const runtime = requireRuntime(deps.runtime);
      if (runtime.listArtifacts === undefined) {
        throw runtimeNotConfiguredError();
      }
      const artifacts = await runtime.listArtifacts(input.runId);
      return toolText(`Found ${artifacts.length} artifacts.`, {
        artifacts: artifacts.map((item) => ({
          id: item.id,
          runId: item.runId,
          type: item.type,
          schemaVersion: item.schemaVersion,
          updatedAt: item.updatedAt,
        })),
      });
    } catch (err) {
      return toolError(err);
    }
  });

  registerDelegateTool(registry, {
    name: "kotikit_search_design_system",
    description: "Search the local design-system mirror using kotikit's token-efficient index.",
    delegateName: "kotikit_ds_search",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Design-system component search query." },
        limit: { type: "number", description: "Maximum results to return." },
      },
      required: ["query"],
    },
  });

  registerDelegateTool(registry, {
    name: "kotikit_record_figma_apply",
    description: "Record metadata after the official Figma MCP apply path updates a draft.",
    delegateName: "kotikit_design_apply_step",
    inputSchema: figmaApplyInputSchema(),
  });

  registerDelegateTool(registry, {
    name: "kotikit_review_figma_target",
    description: "Start a review for an existing Figma target through the compatibility reviewer.",
    delegateName: "kotikit_design_review_start",
    inputSchema: reviewFigmaTargetInputSchema(),
  });

  registerTool(registry, {
    name: "kotikit_doctor",
    description:
      "Check kotikit setup, local design-system state, Figma access, bridge status, and gates.",
    inputSchema: emptyInputSchema(),
  });
  registry.handlers.set("kotikit_doctor", async () => {
    try {
      const report = await runKotikitDoctor(ctx.root);
      return toolText(
        report.ok ? "Kotikit doctor passed." : "Kotikit doctor found setup issues.",
        report
      );
    } catch (err) {
      return toolError(err);
    }
  });
}

function registerTool(registry: ToolRegistry, tool: Tool): void {
  registry.tools.push(tool);
}

function registerDelegateTool(
  registry: ToolRegistry,
  input: Tool & { delegateName: string }
): void {
  const { delegateName, ...tool } = input;
  registerTool(registry, tool);
  registry.handlers.set(tool.name, async (args) =>
    delegateToCompatibilityTool(registry, delegateName, args)
  );
}

async function delegateToCompatibilityTool(
  registry: ToolRegistry,
  delegateName: string,
  args: unknown
): Promise<Awaited<ReturnType<ToolHandler>>> {
  const handler = registry.handlers.get(delegateName);
  if (handler === undefined) {
    return toolError(
      new KotikitError(
        `The compatibility handler ${delegateName} is not registered yet.`,
        "Use the full kotikit MCP server, or complete the graph runtime migration for this facade tool."
      )
    );
  }
  return handler(args);
}

function emptyInputSchema(): Tool["inputSchema"] {
  return {
    type: "object",
    properties: {},
  };
}

function runIdInputSchema(): Tool["inputSchema"] {
  return {
    type: "object",
    properties: {
      runId: { type: "string", description: "Kotikit run id." },
    },
    required: ["runId"],
  };
}

function figmaApplyInputSchema(): Tool["inputSchema"] {
  return {
    type: "object",
    properties: {
      scope: { type: "string", description: "Scope (flow or single-screen) slug." },
      screen: { type: "string", description: "Screen slug; omit for single-screen specs." },
      stepIndex: {
        type: "number",
        description: "Zero-based index of the design plan step that was applied.",
      },
      outcome: {
        type: "string",
        enum: ["ok", "warned", "failed"],
        description: "Result of the official Figma MCP apply.",
      },
      note: { type: "string", description: "Optional human-readable note." },
      stepKind: {
        type: "string",
        enum: [...DESIGN_PLAN_STEP_KINDS],
        description: "Design plan step kind applied in Figma.",
      },
      state: { type: "string", description: "Design state affected by the step." },
      componentName: {
        type: "string",
        description: "Component name when the step placed a component.",
      },
      dsKey: {
        type: "string",
        description: "Design-system component key when available.",
      },
      figmaFileKey: {
        type: "string",
        description: "Figma file key containing the applied node.",
      },
      figmaPageId: { type: "string", description: "Figma page ID containing the applied node." },
      figmaPageName: {
        type: "string",
        description: "Figma page name containing the applied node.",
      },
      figmaPageUrl: { type: "string", description: "Figma page URL bound for this design." },
      figmaSectionId: {
        type: "string",
        description: "Kotikit-owned Figma section ID containing the applied node.",
      },
      figmaSectionName: {
        type: "string",
        description: "Kotikit-owned Figma section name containing the applied node.",
      },
      figmaNodeId: {
        type: "string",
        description: "Figma node ID created or updated by this step.",
      },
      figmaNodeKind: {
        type: "string",
        enum: ["page", "frame", "instance", "node"],
        description: "Kind of Figma node created or updated by this step.",
      },
      figmaNodeName: {
        type: "string",
        description: "Figma node name created or updated by this step.",
      },
    },
    required: ["scope", "stepIndex", "outcome"],
  };
}

function reviewFigmaTargetInputSchema(): Tool["inputSchema"] {
  return {
    type: "object",
    properties: {
      figmaUrl: { type: "string", description: "Exact Figma URL with node-id." },
      fileKey: {
        type: "string",
        description: "Figma file key, used with nodeId when figmaUrl is omitted.",
      },
      nodeId: {
        type: "string",
        description: "Figma node id, used with fileKey when figmaUrl is omitted.",
      },
      scope: { type: "string", description: "Optional kotikit scope to link the review to." },
      screen: { type: "string", description: "Optional kotikit screen to link the review to." },
      surfaceType: {
        type: "string",
        description: "App screen, dashboard, landing page, component, mobile flow, etc.",
      },
      audience: { type: "string" },
      primaryUserGoal: { type: "string" },
      reviewGoal: { type: "string" },
      strictness: { type: "string", enum: ["quick", "standard", "deep"] },
      notes: { type: "string" },
      maxRegions: {
        type: "number",
        description: "Maximum shallow child regions returned. Defaults to 8, max 30.",
      },
    },
  };
}

function compactFlow(flow: FlowDefinition): Record<string, unknown> {
  return {
    id: flow.id,
    version: flow.version,
    title: flow.title,
    description: flow.description,
    stateSchema: flow.stateSchema,
    requiredCapabilities: flow.requiredCapabilities,
    safetyProfile: flow.safetyProfile,
  };
}

function compactRunResult(result: RuntimeRunResult): Record<string, unknown> {
  return {
    runId: result.runId,
    status: result.status,
    flowId: result.state.flowId,
    flowVersion: result.state.flowVersion,
    graphHash: result.state.graphHash,
    pendingQuestion: result.state.pendingQuestion,
    pendingApproval: result.state.pendingApproval,
    artifacts: result.state.artifacts,
    errors: result.state.errors,
  };
}

function findFlow(flows: FlowDefinition[], flowId: string): FlowDefinition {
  const flow = flows.find((candidate) => candidate.id === flowId);
  if (flow === undefined) {
    throw new KotikitError(
      `Unknown kotikit flow: ${flowId}.`,
      "Use kotikit_flow_list to see the available built-in and project flows."
    );
  }
  return flow;
}

function requireRuntime(runtime: FacadeRuntime | undefined): FacadeRuntime {
  if (runtime === undefined) throw runtimeNotConfiguredError();
  return runtime;
}

function runtimeNotConfiguredError(): KotikitError {
  return new KotikitError(
    "The kotikit graph runtime is not wired for this MCP session yet.",
    "Use kotikit_flow_list and kotikit_flow_validate now; runtime execution is enabled in the graph node migration step."
  );
}
