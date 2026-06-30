import { type JSONType, z } from "zod";
import { nowIso, slugify } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildFigmaApplyPacket, type FigmaApplyPacket } from "../../adapters/figma/apply-packet.js";
import { ensureDraftTarget } from "../../adapters/figma/target.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import {
  type Artifact,
  ArtifactSchemaVersionByType,
  type LayoutContract,
  type UICompositionContract,
  type VariableBindingPlan,
} from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});
const STANDARD_STATES = ["loading", "empty", "error", "filled"];

export const draftNodeDefinitions: NodeDefinition[] = [
  node({
    key: "draft.compilePlan",
    stateReads: ["screen", "uiComposition", "layoutContract", "variableBindingPlan"],
    stateWrites: ["draftPlan"],
    run: async (input) => compileDraft(graphState(input.state), "standard"),
  }),
  node({
    key: "draft.compileHighFidelityDraft",
    stateReads: ["screen", "uiComposition", "layoutContract", "variableBindingPlan"],
    stateWrites: ["draftPlan"],
    run: async (input) => compileDraft(graphState(input.state), "high"),
  }),
  node({
    key: "draft.draftScreensIncrementally",
    stateReads: ["draftPlan"],
    stateWrites: ["draftPlan"],
    run: async (input) => {
      const state = graphState(input.state);
      return {
        statePatch: {
          draftPlan: {
            ...recordFrom(state.draftPlan),
            incremental: true,
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "draft.buildFigmaApplyPacket",
    stateReads: [
      "brief",
      "screen",
      "figmaTarget",
      "uiComposition",
      "layoutContract",
      "variableBindingPlan",
      "draftPlan",
    ],
    stateWrites: ["draftPlan"],
    sideEffects: "figma-write",
    requiredCapabilities: ["figma.write.remote"],
    run: async (input) => {
      const state = graphState(input.state);
      assertBriefAllowsApply(state);
      const target = ensureDraftTarget(state.figmaTarget);
      const draftPlan = recordFrom(state.draftPlan);
      const packet = buildFigmaApplyPacket({
        target,
        screenTitle: screenTitle(state),
        uiComposition: state.uiComposition as UICompositionContract | undefined,
        layoutContract: state.layoutContract as LayoutContract | undefined,
        variableBindingPlan: state.variableBindingPlan as VariableBindingPlan | undefined,
        steps: unknownArray(draftPlan.steps),
        repeatedItems: recordArray(draftPlan.repeatedItems),
        textTransforms: recordArray(draftPlan.textTransforms),
      });
      return {
        statePatch: {
          draftPlan: {
            ...recordFrom(state.draftPlan),
            applyPacket: packet,
          },
        },
        artifacts: [buildApplyPacketArtifact(state, packet)],
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function compileDraft(state: KotikitGraphState, fidelity: "standard" | "high"): RuntimeNodeOutput {
  return {
    statePatch: {
      draftPlan: {
        schemaVersion: "DraftPlan/v1",
        fidelity,
        title: screenTitle(state),
        states: statesFrom(state),
        compositionPartIds: state.uiComposition?.parts.map((part) => part.id) ?? [],
        layoutFrameIds: state.layoutContract?.frames.map((frame) => frame.id) ?? [],
        variableBindingCount: state.variableBindingPlan?.bindings.length ?? 0,
        steps:
          state.uiComposition?.parts.map((part) => ({
            kind: "place-component",
            componentName: part.name,
            source: part.source,
            componentKey: part.componentKey,
            draftComponentId: part.draftComponentId,
          })) ?? [],
      },
    },
  };
}

function assertBriefAllowsApply(state: KotikitGraphState): void {
  const brief = recordFrom(state.brief);
  const lane = brief.lane;
  if ((lane === "guided" || lane === "deep") && brief.approved !== true) {
    throw new KotikitError(
      "This guided/deep draft path needs an approved brief before building a Figma apply packet.",
      "Ask the designer to approve the brief summary, or use the quick high-fidelity lane with recorded assumptions."
    );
  }
  if (state.figmaTarget === undefined) {
    throw new KotikitError(
      "This draft needs a Figma draft page target before building an apply packet.",
      "Bind an exact Figma draft page URL before writing through official Figma MCP."
    );
  }
}

function screenTitle(state: KotikitGraphState): string {
  const screen = recordFrom(state.screen);
  return typeof screen.title === "string" ? screen.title : "Untitled Screen";
}

function statesFrom(state: KotikitGraphState): string[] {
  const screen = recordFrom(state.screen);
  const states = unknownArray(screen.states).filter(
    (item): item is string => typeof item === "string"
  );
  return states.length > 0 ? states : STANDARD_STATES;
}

function buildApplyPacketArtifact(state: KotikitGraphState, packet: FigmaApplyPacket): Artifact {
  const now = nowIso();
  const legacyScope = legacyScopeFrom(state);
  return {
    id: `${state.runId}-figma-apply-packet`,
    runId: state.runId,
    type: "figma-apply-packet",
    schemaVersion: ArtifactSchemaVersionByType["figma-apply-packet"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "draft.buildFigmaApplyPacket", version: "1.0.0" },
    payload: {
      schemaVersion: ArtifactSchemaVersionByType["figma-apply-packet"],
      summary: `Apply ${packet.screenTitle} through official Figma MCP.`,
      data: {
        scope: legacyScope.scope,
        screen: legacyScope.screen,
        mode: packet.mode,
        screenTitle: packet.screenTitle,
        targetFileKey: packet.target.fileKey,
        targetPageId: packet.target.pageId,
        targetSectionName: packet.target.section?.name ?? null,
        components: packet.uiComposition.parts.map((part) => ({
          partId: part.id,
          name: part.name,
          source: part.source,
          ...(part.componentKey !== undefined ? { componentKey: part.componentKey } : {}),
          ...(part.draftComponentId !== undefined
            ? { draftComponentId: part.draftComponentId }
            : {}),
          ...(part.primitiveReason !== undefined ? { primitiveReason: part.primitiveReason } : {}),
        })),
        variableBindings: toJson(packet.variableBindingPlan.bindings),
        layoutFrames: toJson(packet.layoutContract.frames),
        repeatedItems: toJson(packet.repeatedItems),
        textTransforms: toJson(packet.textTransforms),
      },
    },
  };
}

function legacyScopeFrom(state: KotikitGraphState): { scope: string; screen: string | null } {
  const screen = recordFrom(state.screen);
  const explicitScope = stringField(screen, "scope") ?? stringField(screen, "parentScope");
  if (explicitScope !== undefined) {
    return {
      scope: explicitScope,
      screen:
        stringField(screen, "screen") ??
        stringField(screen, "slug") ??
        stringField(screen, "id") ??
        null,
    };
  }
  return {
    scope: stringField(screen, "slug") ?? stringField(screen, "id") ?? slugify(screenTitle(state)),
    screen: null,
  };
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

function node(
  input: Partial<NodeDefinition> & Pick<NodeDefinition, "key" | "run">
): NodeDefinition {
  return {
    key: input.key,
    version: "1.0.0",
    kind: input.kind ?? "deterministic",
    paramsSchema: input.paramsSchema ?? EmptyParamsSchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: input.stateReads ?? [],
    stateWrites: input.stateWrites ?? [],
    sideEffects: input.sideEffects ?? "none",
    requiredCapabilities: input.requiredCapabilities ?? [],
    run: input.run,
  };
}

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
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

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toJson(value: unknown): JSONType {
  return JSON.parse(JSON.stringify(value));
}
