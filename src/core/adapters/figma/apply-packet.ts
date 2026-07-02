import type { FigmaDraftTarget } from "../../../figma/draft-target.js";
import { KotikitError } from "../../../util/result.js";
import type {
  CanvasPlan,
  FigmaTransactionPlan,
  LayoutContract,
  UICompositionContract,
  VariableBindingPlan,
} from "../../schemas/artifact.js";

type CanvasPlanSummary = {
  sectionName: string;
  placementCount: number;
  zoneCount: number;
};

type FigmaTransactionSummary = {
  id: string;
  order: number;
  kind: FigmaTransactionPlan["transactions"][number]["kind"];
  label: string;
  placementId: string;
  stateId?: string;
  draftComponentId?: string;
  expectedNodeKind: "COMPONENT" | "FRAME";
  placement: CanvasPlan["placements"][number];
  parentZone: CanvasPlan["zones"][number];
};

type FigmaTransactionPlanSummary = {
  transactionCount: number;
  transactions: FigmaTransactionSummary[];
};

export type FigmaApplyPacket = {
  schemaVersion: "FigmaApplyPacket/v1";
  mode: "official-figma-mcp";
  target: FigmaDraftTarget;
  screenTitle: string;
  uiComposition: UICompositionContract;
  layoutContract: LayoutContract;
  variableBindingPlan: VariableBindingPlan;
  canvasPlanSummary: CanvasPlanSummary;
  canvasPlan: CanvasPlan;
  transactionPlanSummary: FigmaTransactionPlanSummary;
  iconRequirements: IconRequirement[];
  evidenceChecklist: EvidenceChecklist;
  steps: unknown[];
  repeatedItems: unknown[];
  textTransforms: unknown[];
  visualReview: {
    required: true;
    method: "screenshot";
    instructions: string;
  };
  metadata: {
    requiresApplyMetadata: true;
    requiresScreenshotReview: true;
    verifyComponentRefs: true;
    verifyActualComponentInstances: true;
    verifyIcons: true;
    verifyVariables: true;
    verifyAutoLayout: true;
    incrementalTransactions: true;
  };
};

type IconRequirement = {
  id: string;
  semantic: string;
  source: "local-design-system" | "approved-external";
  reason: string;
  partId?: string;
  iconKey?: string;
  iconName?: string;
  required?: boolean;
};

type EvidenceChecklist = {
  existingComponents: ExistingComponentEvidenceRequirement[];
  scannerOutput: {
    schemaVersion: "FigmaEvidenceSnapshot/v1";
    arrays: ["parts", "componentInstances", "layoutFrames", "icons"];
    summaryFields: ["directVisibleChildCount", "autoLayoutContainerCount"];
  };
};

type ExistingComponentEvidenceRequirement = {
  partId: string;
  partName: string;
  componentKey: string;
  expectedNodeKind: "INSTANCE";
  mustBeVisible: true;
  evidenceOnlyAllowed: false;
};

export function buildFigmaApplyPacket(input: {
  target: FigmaDraftTarget;
  screenTitle: string;
  uiComposition?: UICompositionContract;
  layoutContract?: LayoutContract;
  variableBindingPlan?: VariableBindingPlan;
  canvasPlan?: CanvasPlan;
  transactionPlan?: FigmaTransactionPlan;
  steps?: unknown[];
  repeatedItems?: unknown[];
  textTransforms?: unknown[];
}): FigmaApplyPacket {
  if (
    input.uiComposition === undefined ||
    input.layoutContract === undefined ||
    input.variableBindingPlan === undefined ||
    input.canvasPlan === undefined ||
    input.transactionPlan === undefined
  ) {
    throw new KotikitError(
      "The Figma apply packet is missing required UI contracts.",
      "Build composition, layout, variable-binding, canvas, and transaction plans before applying the draft."
    );
  }

  return {
    schemaVersion: "FigmaApplyPacket/v1",
    mode: "official-figma-mcp",
    target: input.target,
    screenTitle: input.screenTitle,
    uiComposition: input.uiComposition,
    layoutContract: input.layoutContract,
    variableBindingPlan: input.variableBindingPlan,
    canvasPlanSummary: summarizeCanvasPlan(input.canvasPlan),
    canvasPlan: input.canvasPlan,
    transactionPlanSummary: summarizeTransactionPlan(input.transactionPlan, input.canvasPlan),
    iconRequirements: iconRequirementsFrom(input.uiComposition),
    evidenceChecklist: evidenceChecklistFrom(input.uiComposition),
    steps: input.steps ?? [],
    repeatedItems: input.repeatedItems ?? [],
    textTransforms: input.textTransforms ?? [],
    visualReview: {
      required: true,
      method: "screenshot",
      instructions:
        "After each visible Figma transaction, take a screenshot of the applied root frame and inspect it for overlap, clipped or mirrored text, broken component instances, and layout drift before recording metadata.",
    },
    metadata: {
      requiresApplyMetadata: true,
      requiresScreenshotReview: true,
      verifyComponentRefs: true,
      verifyActualComponentInstances: true,
      verifyIcons: true,
      verifyVariables: true,
      verifyAutoLayout: true,
      incrementalTransactions: true,
    },
  };
}

function summarizeCanvasPlan(canvasPlan: CanvasPlan): CanvasPlanSummary {
  return {
    sectionName: canvasPlan.section.name,
    placementCount: canvasPlan.placements.length,
    zoneCount: canvasPlan.zones.length,
  };
}

function summarizeTransactionPlan(
  transactionPlan: FigmaTransactionPlan,
  canvasPlan: CanvasPlan
): FigmaTransactionPlanSummary {
  const placementsById = new Map(
    canvasPlan.placements.map((placement) => [placement.id, placement])
  );
  const zonesById = new Map(canvasPlan.zones.map((zone) => [zone.id, zone]));
  return {
    transactionCount: transactionPlan.transactions.length,
    transactions: transactionPlan.transactions.map((transaction) => {
      const placement = placementsById.get(transaction.placementId);
      if (placement === undefined) {
        throw new KotikitError(
          `Figma transaction ${transaction.id} references missing canvas placement ${transaction.placementId}.`,
          "Regenerate the canvas plan before building the apply packet."
        );
      }
      const parentZone = zonesById.get(placement.parentZoneId);
      if (parentZone === undefined) {
        throw new KotikitError(
          `Canvas placement ${placement.id} references missing parent zone ${placement.parentZoneId}.`,
          "Regenerate the canvas plan before building the apply packet."
        );
      }
      return {
        id: transaction.id,
        order: transaction.order,
        kind: transaction.kind,
        label: transaction.label,
        placementId: transaction.placementId,
        ...(transaction.stateId === undefined ? {} : { stateId: transaction.stateId }),
        ...(transaction.draftComponentId === undefined
          ? {}
          : { draftComponentId: transaction.draftComponentId }),
        expectedNodeKind: transaction.kind === "create-draft-component" ? "COMPONENT" : "FRAME",
        placement,
        parentZone,
      };
    }),
  };
}

function evidenceChecklistFrom(uiComposition: UICompositionContract): EvidenceChecklist {
  return {
    existingComponents: uiComposition.parts.flatMap((part) => {
      if (part.source !== "existing-component" || part.componentKey === undefined) return [];
      return [
        {
          partId: part.id,
          partName: part.name,
          componentKey: part.componentKey,
          expectedNodeKind: "INSTANCE" as const,
          mustBeVisible: true as const,
          evidenceOnlyAllowed: false as const,
        },
      ];
    }),
    scannerOutput: {
      schemaVersion: "FigmaEvidenceSnapshot/v1",
      arrays: ["parts", "componentInstances", "layoutFrames", "icons"],
      summaryFields: ["directVisibleChildCount", "autoLayoutContainerCount"],
    },
  };
}

function iconRequirementsFrom(uiComposition: UICompositionContract): IconRequirement[] {
  return uiComposition.parts.flatMap((part) =>
    (part.iconAffordances ?? [])
      .filter((affordance) => affordance.required !== false)
      .map((affordance) => ({
        ...affordance,
        partId: part.id,
        required: affordance.required ?? true,
        reason:
          affordance.reason ?? "Use the icon affordance planned in the UI composition contract.",
      }))
  );
}
