import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ensureDraftTarget } from "../../core/adapters/figma/target.js";
import { loadBuiltInFlows } from "../../core/flows/catalog.js";
import { computeStableHash } from "../../core/graph/graph-hash.js";
import type {
  GraphRuntime,
  RuntimeRunResult,
  RuntimeStartInput,
} from "../../core/graph/runtime.js";
import type { Artifact } from "../../core/schemas/artifact.js";
import { type FlowDefinition, FlowDefinitionSchema } from "../../core/schemas/flow-definition.js";
import { openDesignReviewDb } from "../../db/design-review-db.js";
import { runKotikitDoctor } from "../../doctor/doctor.js";
import { DESIGN_PLAN_STEP_KINDS } from "../../planning/design-plan-schema.js";
import {
  collectDesignReviewEvidence,
  type DesignReviewEvidenceClient,
  parseFigmaReviewUrl,
} from "../../planning/design-review.js";
import { FigmaClient } from "../../sync/figma-client.js";
import { resolveFigmaToken } from "../../sync/figma-token.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { withKotikitToolSafety } from "../tool-safety.js";

export const FACADE_TOOL_NAMES = [
  "kotikit_flow_list",
  "kotikit_flow_validate",
  "kotikit_start",
  "kotikit_continue",
  "kotikit_answer",
  "kotikit_bind_figma_target",
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
  "startFlow" | "continueRun" | "answerRun" | "patchRunState" | "getRunState" | "getArtifact"
> & {
  listArtifacts?(runId?: string): Promise<Artifact[]>;
};

export type FacadeToolDependencies = {
  runtime?: FacadeRuntime;
  loadFlows?: () => Promise<FlowDefinition[]>;
  figmaReviewClientFactory?: (token: string) => DesignReviewEvidenceClient;
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
      figmaTarget: z.unknown().optional(),
      review: z.unknown().optional(),
      designSystem: z.unknown().optional(),
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

const BindFigmaTargetInputSchema = z.strictObject({
  runId: z.string().min(1),
  target: z.unknown(),
});

const ReviewFigmaTargetInputSchema = z
  .strictObject({
    figmaUrl: z.string().min(1).optional(),
    fileKey: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    screen: z.string().min(1).optional(),
    surfaceType: z.string().min(1).optional(),
    audience: z.string().min(1).optional(),
    primaryUserGoal: z.string().min(1).optional(),
    reviewGoal: z.string().min(1).optional(),
    strictness: z.enum(["quick", "standard", "deep"]).optional().default("standard"),
    notes: z.string().min(1).optional(),
    maxRegions: z.number().int().positive().max(30).optional().default(8),
  })
  .refine((input) => input.figmaUrl !== undefined || input.fileKey !== undefined, {
    message: "Pass figmaUrl, or pass fileKey with nodeId.",
  })
  .refine((input) => input.figmaUrl !== undefined || input.nodeId !== undefined, {
    message: "Pass figmaUrl, or pass fileKey with nodeId.",
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
            figmaTarget: {
              type: "object",
              description: "Safe Figma draft target object to seed into the graph run.",
            },
            review: {
              type: "object",
              description: "Optional pre-collected review target, evidence, or comment snapshot.",
            },
            designSystem: {
              type: "object",
              description: "Optional pre-seeded design-system search results.",
            },
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
        ...(input.input?.figmaTarget === undefined
          ? {}
          : { figmaTarget: ensureDraftTarget(input.input.figmaTarget) }),
        ...(input.input?.review === undefined ? {} : { review: input.input.review }),
        ...(input.input?.designSystem === undefined
          ? {}
          : { designSystem: input.input.designSystem }),
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
    name: "kotikit_bind_figma_target",
    description: "Bind a safe Figma draft target object into an active graph run.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Kotikit run id." },
        target: {
          type: "object",
          description: "Safe Figma draft target resolved from an exact draft page URL.",
        },
      },
      required: ["runId", "target"],
    },
  });
  registry.handlers.set("kotikit_bind_figma_target", async (args) => {
    try {
      const input = BindFigmaTargetInputSchema.parse(args);
      const runtime = requireRuntime(deps.runtime);
      const target = ensureDraftTarget(input.target);
      return toolText(
        `Bound Figma draft target for run ${input.runId}.`,
        compactRunResult(
          await runtime.patchRunState({
            runId: input.runId,
            statePatch: { figmaTarget: target },
          })
        )
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

  registerTool(registry, {
    name: "kotikit_record_figma_apply",
    description: "Record metadata after the official Figma MCP apply path updates a draft.",
    inputSchema: figmaApplyInputSchema(),
  });
  registry.handlers.set("kotikit_record_figma_apply", async (args) => {
    try {
      const candidate = recordFrom(args);
      const runId = stringField(candidate, "runId");
      if (runId === undefined) {
        return toolError(
          new KotikitError(
            "kotikit_record_figma_apply now records apply metadata on an active graph run.",
            "Pass the runId returned by kotikit_start, then continue the run after recording the Figma apply metadata."
          )
        );
      }
      const runtime = requireRuntime(deps.runtime);
      const result = await runtime.patchRunState({
        runId,
        statePatch: {
          applyMetadata: figmaApplyMetadataFrom(candidate),
        },
      });
      return toolText(`Recorded Figma apply metadata for run ${runId}.`, compactRunResult(result));
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_review_figma_target",
    description: "Start the built-in improve-existing-design flow for an exact Figma target.",
    inputSchema: reviewFigmaTargetInputSchema(),
  });
  registry.handlers.set("kotikit_review_figma_target", async (args) => {
    try {
      const runtime = requireRuntime(deps.runtime);
      const input = ReviewFigmaTargetInputSchema.parse(args);
      const token = await resolveFigmaToken(ctx.root, await ctx.loadConfig());
      if (token === undefined || token === "") {
        throw new KotikitError(
          "I couldn't find your Figma token.",
          "Set FIGMA_TOKEN or config.figma.token. Design review evidence needs Figma file read access."
        );
      }
      const client = deps.figmaReviewClientFactory?.(token) ?? new FigmaClient({ token });
      const parsedTarget = reviewTargetFromInput(input);
      const { target, evidence } = await collectDesignReviewEvidence({
        client,
        store: openDesignReviewDb(ctx.root),
        target: {
          ...parsedTarget,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.screen === undefined ? {} : { screen: input.screen }),
        },
        maxRegions: input.maxRegions,
      });
      const brief = reviewBriefFromInput(input);
      const result = await runtime.startFlow({
        flowId: "improve-existing-design",
        input: {
          project: { root: ctx.root },
          review: {
            target,
            evidence,
            ...(Object.keys(brief).length === 0 ? {} : { brief }),
          },
        },
      });
      return toolText(`Started review run ${result.runId}.`, compactRunResult(result));
    } catch (err) {
      return toolError(err);
    }
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
  registry.tools.push(withKotikitToolSafety(tool));
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
      runId: {
        type: "string",
        description: "Active kotikit graph run id to patch with apply metadata.",
      },
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
      transactionId: {
        type: "string",
        description: "Active incremental Figma transaction id this metadata records.",
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
      partId: {
        type: "string",
        description: "Apply-packet UI part id represented by this Figma node.",
      },
      draftComponentId: {
        type: "string",
        description: "Kotikit draft component id used to create this node, when applicable.",
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
      bounds: {
        type: "object",
        description: "Compact node bounds after apply.",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["x", "y", "width", "height"],
      },
      componentRefs: {
        type: "array",
        description: "Compact component keys or node refs used by this transaction.",
        items: { type: "string" },
      },
      variableRefs: {
        type: "array",
        description: "Compact variable/style refs used by this transaction.",
        items: { type: "string" },
      },
      representation: {
        type: "string",
        enum: ["screen-frame", "region-state", "component-state", "flow-step"],
        description: "Compact state representation for screen, region, component, or flow states.",
      },
      autoLayout: {
        type: "boolean",
        description: "Whether the applied top-level node uses Figma auto layout.",
      },
      nodes: {
        type: "array",
        description:
          "Compact child nodes created inside this transaction, such as draft component instances.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            kind: { type: "string" },
            semanticRole: { type: "string" },
            partId: { type: "string" },
            draftComponentId: { type: "string" },
            componentKey: { type: "string" },
            bounds: { type: "object" },
            componentRefs: { type: "array", items: { type: "string" } },
            variableRefs: { type: "array", items: { type: "string" } },
            autoLayout: { type: "boolean" },
          },
        },
      },
      variableBindings: {
        type: "array",
        description: "Variable/style bindings applied by official Figma MCP.",
        items: { type: "object" },
      },
      layoutFrames: {
        type: "array",
        description: "Auto-layout/grid frame metadata applied by official Figma MCP.",
        items: { type: "object" },
      },
      repeatedItems: {
        type: "array",
        description: "Repeated row/card/cell structure metadata.",
        items: { type: "object" },
      },
      textTransforms: {
        type: "array",
        description: "Text transform metadata for post-apply verification.",
        items: { type: "object" },
      },
    },
    required: ["runId", "scope", "stepIndex", "outcome"],
  };
}

function figmaApplyMetadataFrom(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(stringField(input, "transactionId") !== undefined
      ? { transactionId: stringField(input, "transactionId") }
      : {}),
    ...(stringField(input, "figmaFileKey") !== undefined
      ? { fileKey: stringField(input, "figmaFileKey") }
      : {}),
    ...(stringField(input, "figmaPageId") !== undefined
      ? { pageId: stringField(input, "figmaPageId") }
      : {}),
    ...(stringField(input, "figmaSectionName") !== undefined
      ? { sectionName: stringField(input, "figmaSectionName") }
      : {}),
    nodes: figmaApplyNodesFrom(input),
    ...(boundsFrom(input.bounds) !== undefined ? { bounds: boundsFrom(input.bounds) } : {}),
    ...(stringArray(input.componentRefs) !== undefined
      ? { componentRefs: stringArray(input.componentRefs) }
      : {}),
    ...(stringArray(input.variableRefs) !== undefined
      ? { variableRefs: stringArray(input.variableRefs) }
      : {}),
    ...(stateRepresentationField(input) !== undefined
      ? { representation: stateRepresentationField(input) }
      : {}),
    ...(booleanField(input, "autoLayout") !== undefined
      ? { autoLayout: booleanField(input, "autoLayout") }
      : {}),
    variableBindings: recordArray(input.variableBindings),
    layoutFrames: recordArray(input.layoutFrames),
    repeatedItems: recordArray(input.repeatedItems),
    textTransforms: recordArray(input.textTransforms),
  };
}

function figmaApplyNodesFrom(input: Record<string, unknown>): Record<string, unknown>[] {
  const primaryNode = {
    ...(stringField(input, "figmaNodeId") !== undefined
      ? { id: stringField(input, "figmaNodeId") }
      : {}),
    ...(stringField(input, "figmaNodeName") !== undefined
      ? { name: stringField(input, "figmaNodeName") }
      : {}),
    ...(stringField(input, "figmaNodeKind") !== undefined
      ? { kind: stringField(input, "figmaNodeKind") }
      : {}),
    ...(stringField(input, "componentName") !== undefined
      ? { componentName: stringField(input, "componentName") }
      : {}),
    ...(stringField(input, "partId") !== undefined ? { partId: stringField(input, "partId") } : {}),
    ...(stringField(input, "draftComponentId") !== undefined
      ? { draftComponentId: stringField(input, "draftComponentId") }
      : {}),
    ...(stringField(input, "dsKey") !== undefined
      ? { componentKey: stringField(input, "dsKey") }
      : {}),
  };
  const nodes = [
    primaryNode,
    ...recordArray(input.nodes).map((node) => compactApplyNodeFrom(node)),
  ].filter((node) => Object.keys(node).length > 0);
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const id = stringField(node, "id");
    if (id === undefined) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function compactApplyNodeFrom(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(stringField(input, "id") !== undefined ? { id: stringField(input, "id") } : {}),
    ...(stringField(input, "name") !== undefined ? { name: stringField(input, "name") } : {}),
    ...(stringField(input, "kind") !== undefined ? { kind: stringField(input, "kind") } : {}),
    ...(stringField(input, "semanticRole") !== undefined
      ? { semanticRole: stringField(input, "semanticRole") }
      : {}),
    ...(stringField(input, "componentName") !== undefined
      ? { componentName: stringField(input, "componentName") }
      : {}),
    ...(stringField(input, "partId") !== undefined ? { partId: stringField(input, "partId") } : {}),
    ...(stringField(input, "draftComponentId") !== undefined
      ? { draftComponentId: stringField(input, "draftComponentId") }
      : {}),
    ...(stringField(input, "componentKey") !== undefined
      ? { componentKey: stringField(input, "componentKey") }
      : {}),
    ...(boundsFrom(input.bounds) !== undefined ? { bounds: boundsFrom(input.bounds) } : {}),
    ...(stringArray(input.componentRefs) !== undefined
      ? { componentRefs: stringArray(input.componentRefs) }
      : {}),
    ...(stringArray(input.variableRefs) !== undefined
      ? { variableRefs: stringArray(input.variableRefs) }
      : {}),
    ...(booleanField(input, "autoLayout") !== undefined
      ? { autoLayout: booleanField(input, "autoLayout") }
      : {}),
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | undefined {
  const candidate = value[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

function boundsFrom(value: unknown):
  | {
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | undefined {
  const bounds = recordFrom(value);
  return typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? value
    : undefined;
}

function stateRepresentationField(input: Record<string, unknown>): string | undefined {
  const representation = stringField(input, "representation");
  return representation === "screen-frame" ||
    representation === "region-state" ||
    representation === "component-state" ||
    representation === "flow-step"
    ? representation
    : undefined;
}

function reviewTargetFromInput(input: z.infer<typeof ReviewFigmaTargetInputSchema>): {
  fileKey: string;
  nodeId: string;
  figmaUrl: string;
} {
  if (input.figmaUrl !== undefined) return parseFigmaReviewUrl(input.figmaUrl);
  if (input.fileKey !== undefined && input.nodeId !== undefined) {
    return {
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      figmaUrl: `https://www.figma.com/design/${input.fileKey}/review?node-id=${input.nodeId.replace(":", "-")}`,
    };
  }
  throw new KotikitError(
    "I need an exact Figma target to review.",
    "Pass figmaUrl with node-id, or pass both fileKey and nodeId."
  );
}

function reviewBriefFromInput(
  input: z.infer<typeof ReviewFigmaTargetInputSchema>
): Record<string, unknown> {
  return {
    strictness: input.strictness,
    ...(input.surfaceType === undefined ? {} : { surfaceType: input.surfaceType }),
    ...(input.audience === undefined ? {} : { audience: input.audience }),
    ...(input.primaryUserGoal === undefined ? {} : { primaryUserGoal: input.primaryUserGoal }),
    ...(input.reviewGoal === undefined ? {} : { reviewGoal: input.reviewGoal }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
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
