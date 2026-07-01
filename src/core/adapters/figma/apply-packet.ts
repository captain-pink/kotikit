import type { FigmaDraftTarget } from "../../../figma/draft-target.js";
import { KotikitError } from "../../../util/result.js";
import type {
  CanvasPlan,
  FigmaTransactionPlan,
  LayoutContract,
  UICompositionContract,
  VariableBindingPlan,
} from "../../schemas/artifact.js";

export type FigmaApplyPacket = {
  schemaVersion: "FigmaApplyPacket/v1";
  mode: "official-figma-mcp";
  target: FigmaDraftTarget;
  screenTitle: string;
  uiComposition: UICompositionContract;
  layoutContract: LayoutContract;
  variableBindingPlan: VariableBindingPlan;
  canvasPlan: CanvasPlan;
  transactionPlan: FigmaTransactionPlan;
  steps: unknown[];
  repeatedItems: unknown[];
  textTransforms: unknown[];
  metadata: {
    requiresApplyMetadata: true;
    verifyComponentRefs: true;
    verifyVariables: true;
    verifyAutoLayout: true;
    incrementalTransactions: true;
  };
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
    canvasPlan: input.canvasPlan,
    transactionPlan: input.transactionPlan,
    steps: input.steps ?? [],
    repeatedItems: input.repeatedItems ?? [],
    textTransforms: input.textTransforms ?? [],
    metadata: {
      requiresApplyMetadata: true,
      verifyComponentRefs: true,
      verifyVariables: true,
      verifyAutoLayout: true,
      incrementalTransactions: true,
    },
  };
}
