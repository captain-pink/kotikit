import type { FigmaDraftTarget } from "../../../figma/draft-target.js";
import { KotikitError } from "../../../util/result.js";
import type {
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
  steps: unknown[];
  repeatedItems: unknown[];
  textTransforms: unknown[];
  metadata: {
    requiresApplyMetadata: true;
    verifyComponentRefs: true;
    verifyVariables: true;
    verifyAutoLayout: true;
  };
};

export function buildFigmaApplyPacket(input: {
  target: FigmaDraftTarget;
  screenTitle: string;
  uiComposition?: UICompositionContract;
  layoutContract?: LayoutContract;
  variableBindingPlan?: VariableBindingPlan;
  steps?: unknown[];
  repeatedItems?: unknown[];
  textTransforms?: unknown[];
}): FigmaApplyPacket {
  if (
    input.uiComposition === undefined ||
    input.layoutContract === undefined ||
    input.variableBindingPlan === undefined
  ) {
    throw new KotikitError(
      "The Figma apply packet is missing required UI contracts.",
      "Build composition, layout, and variable-binding contracts before applying the draft."
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
    steps: input.steps ?? [],
    repeatedItems: input.repeatedItems ?? [],
    textTransforms: input.textTransforms ?? [],
    metadata: {
      requiresApplyMetadata: true,
      verifyComponentRefs: true,
      verifyVariables: true,
      verifyAutoLayout: true,
    },
  };
}
