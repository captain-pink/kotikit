import { KotikitError } from "../../util/result.js";
import type { UICompositionContract, VariableBindingPlan } from "../schemas/artifact.js";

type VariableRef = {
  id?: string;
  key?: string;
  name?: string;
  kind?: string;
  source?: string;
};

type BindingProperty = VariableBindingPlan["bindings"][number]["property"];

const REQUIRED_PROPERTIES: BindingProperty[] = [
  "fill",
  "text",
  "radius",
  "spacing",
  "stroke",
  "shadow",
  "effect",
];

export function buildVariableBindingPlan(input: {
  uiComposition: UICompositionContract;
  variables: VariableRef[];
  literalFallbackApproved?: boolean;
  requiredProperties?: BindingProperty[];
}): VariableBindingPlan | "needs-literal-approval" {
  const requiredProperties = input.requiredProperties ?? REQUIRED_PROPERTIES;
  const variableByProperty = new Map(
    requiredProperties.flatMap((property) => {
      const variable = input.variables.find(
        (candidate) => propertyForVariable(candidate) === property
      );
      return variable === undefined ? [] : ([[property, variable]] as const);
    })
  );
  const missingProperties = requiredProperties.filter(
    (property) => !variableByProperty.has(property)
  );
  const hasUsableVariables = variableByProperty.size > 0;

  if (!hasUsableVariables && input.literalFallbackApproved !== true) {
    return "needs-literal-approval";
  }

  if (missingProperties.length > 0 && input.literalFallbackApproved === true) {
    return {
      schemaVersion: "VariableBindingPlan/v1",
      bindings: input.uiComposition.parts.flatMap((part) =>
        requiredProperties.map((property) => {
          const variable = variableByProperty.get(property);
          if (variable === undefined) {
            return {
              targetId: part.id,
              property,
              source: "approved-literal" as const,
              literalValue: "draft-only",
              approvalRef: "approved-literal-variable-fallback",
            };
          }
          return variableBinding(part.id, property, variable);
        })
      ),
    };
  }

  const unusableVariable = Array.from(variableByProperty.values()).find(
    (variable) =>
      variable.name === undefined && variable.id === undefined && variable.key === undefined
  );
  if (unusableVariable !== undefined) {
    throw new KotikitError(
      "The variable binding plan could not find a usable variable reference.",
      "Sync design-system variables or approve a literal fallback for this draft only."
    );
  }

  return {
    schemaVersion: "VariableBindingPlan/v1",
    bindings: input.uiComposition.parts.flatMap((part) =>
      Array.from(variableByProperty.entries()).map(([property, variable]) =>
        variableBinding(part.id, property, variable)
      )
    ),
  };
}

function variableBinding(
  targetId: string,
  property: BindingProperty,
  variable: VariableRef
): VariableBindingPlan["bindings"][number] {
  return {
    targetId,
    property,
    source: variable.source === "style" ? "style" : "variable",
    ...(variable.name !== undefined ? { name: variable.name } : {}),
    ...(variable.id !== undefined ? { id: variable.id } : {}),
    ...(variable.key !== undefined ? { key: variable.key } : {}),
  };
}

function propertyForVariable(variable: VariableRef): BindingProperty | undefined {
  switch (variable.kind) {
    case "color":
    case "fill":
      return "fill";
    case "typography":
    case "text":
      return "text";
    case "radius":
      return "radius";
    case "spacing":
      return "spacing";
    case "stroke":
      return "stroke";
    case "shadow":
      return "shadow";
    case "effect":
      return "effect";
    default:
      return undefined;
  }
}
