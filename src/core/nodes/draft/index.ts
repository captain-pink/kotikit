import { type JSONType, z } from "zod";
import { nowIso, slugify } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildFigmaApplyPacket, type FigmaApplyPacket } from "../../adapters/figma/apply-packet.js";
import { ensureDraftTarget } from "../../adapters/figma/target.js";
import { buildCanvasPlan } from "../../domain/canvas-plan.js";
import { buildFigmaTransactionPlan } from "../../domain/figma-transaction-plan.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import {
  type Artifact,
  ArtifactSchemaVersionByType,
  type CanvasPlan,
  CanvasPlanSchema,
  type FigmaTransactionPlan,
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
    key: "draft.buildCanvasPlan",
    stateReads: ["figmaTarget", "screen", "stateMatrix", "draftComponentPlan", "canvasIntent"],
    stateWrites: ["canvasPlan"],
    run: async (input) => {
      const state = graphState(input.state);
      const section = canvasSectionFrom(state);
      const replacementTarget = replacementTargetFrom(state);
      const screenSize =
        replacementTarget === undefined
          ? { width: 1440, height: 900 }
          : {
              width: replacementTarget.bounds.width,
              height: replacementTarget.bounds.height,
            };
      const canvasPlan = buildCanvasPlan({
        sectionName: section.name,
        ...(section.id === undefined ? {} : { sectionId: section.id }),
        screenTitle: screenTitle(state),
        screenSize,
        states: canvasStatesFrom(state),
        draftComponents: state.draftComponentPlan?.components ?? [],
        sectionStyle: state.figmaDefaults?.section,
        ...(replacementTarget === undefined ? {} : { replacementTarget }),
      });
      return {
        statePatch: { canvasPlan },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "draft.buildFigmaTransactionPlan",
    stateReads: ["canvasPlan", "draftPlan", "applyReport"],
    stateWrites: ["figmaTransactionPlan"],
    run: async (input) => {
      const state = graphState(input.state);
      const canvasPlan = CanvasPlanSchema.parse(state.canvasPlan);
      const pendingPlacements = transactionPlacementsForState(state, canvasPlan);
      const pendingPlacementIds = new Set(pendingPlacements.map((placement) => placement.id));
      const figmaTransactionPlan = buildFigmaTransactionPlan({
        placements: pendingPlacements,
        creationOrder: canvasPlan.strategy.creationOrder.filter((placementId) =>
          pendingPlacementIds.has(placementId)
        ),
      });
      return {
        statePatch: { figmaTransactionPlan },
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
      "canvasPlan",
      "figmaTransactionPlan",
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
        canvasPlan: state.canvasPlan as CanvasPlan | undefined,
        transactionPlan: state.figmaTransactionPlan as FigmaTransactionPlan | undefined,
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
  const createdDraftComponents = recordArray(recordFrom(state.draftPlan).createdDraftComponents);
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
        ...(createdDraftComponents.length === 0 ? {} : { createdDraftComponents }),
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

function transactionPlacementsForState(
  state: KotikitGraphState,
  canvasPlan: CanvasPlan
): CanvasPlan["placements"] {
  const recordedPlacementIds = new Set(
    recordArray(recordFrom(state.applyReport).nodes)
      .map((node) => stringField(node, "placementId"))
      .filter((placementId): placementId is string => placementId !== undefined)
  );
  const createdDraftComponentIds = new Set(
    recordArray(recordFrom(state.draftPlan).createdDraftComponents)
      .filter((component) => hasRealComponentKey(component))
      .map((component) => stringField(component, "id"))
      .filter((id): id is string => id !== undefined)
  );
  return canvasPlan.placements.filter(
    (placement) =>
      !recordedPlacementIds.has(placement.id) &&
      (placement.kind !== "draft-component" ||
        placement.draftComponentId === undefined ||
        !createdDraftComponentIds.has(placement.draftComponentId))
  );
}

function hasRealComponentKey(component: Record<string, unknown>): boolean {
  const componentKey = stringField(component, "componentKey");
  return componentKey !== undefined && !componentKey.startsWith("draft:");
}

function canvasSectionFrom(state: KotikitGraphState): { name: string; id?: string } {
  const section = recordFrom(recordFrom(state.figmaTarget).section);
  const name = stringField(section, "name") ?? `kotikit / ${screenTitle(state)}`;
  const id = stringField(section, "id");
  return {
    name,
    ...(id === undefined ? {} : { id }),
  };
}

function replacementTargetFrom(state: KotikitGraphState):
  | {
      nodeId: string;
      name?: string;
      bounds: { x: number; y: number; width: number; height: number };
    }
  | undefined {
  const canvasIntent = recordFrom(state.canvasIntent);
  if (canvasIntent.mode !== "replace-existing-frame") return undefined;
  const target = recordFrom(canvasIntent.targetFrame);
  const bounds = recordFrom(target.bounds);
  if (
    typeof target.nodeId !== "string" ||
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    return undefined;
  }
  return {
    nodeId: target.nodeId,
    ...(typeof target.name === "string" ? { name: target.name } : {}),
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

function canvasStatesFrom(state: KotikitGraphState): { id: string; label: string; kind: string }[] {
  if (state.stateMatrix !== undefined && state.stateMatrix.states.length > 0) {
    return state.stateMatrix.states.map((matrixState) => ({
      id: matrixState.id,
      label: matrixState.label,
      kind: matrixState.kind,
    }));
  }

  return statesFrom(state).map((label) => ({
    id: slugify(label),
    label,
    kind: slugify(label),
  }));
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
        canvasPlanSummary: toJson(packet.canvasPlanSummary),
        canvasPlan: toJson(packet.canvasPlan),
        transactionPlanSummary: toJson(packet.transactionPlanSummary),
        iconRequirements: toJson(packet.iconRequirements),
        evidenceChecklist: toJson(packet.evidenceChecklist),
        visualReview: toJson(packet.visualReview),
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
