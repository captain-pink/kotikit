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
type VariableRoleRequirement = NonNullable<
  UICompositionContract["parts"][number]["variableRoles"]
>[number];

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
  const roleBindings = bindingsFromVariableRoles(
    input.uiComposition.parts,
    input.variables,
    input.literalFallbackApproved === true
  );
  if (roleBindings === "needs-literal-approval") return roleBindings;
  if (roleBindings !== undefined) {
    return {
      schemaVersion: "VariableBindingPlan/v1",
      bindings: roleBindings,
    };
  }

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
              approvalRef: "approve-literal-variable-fallback",
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

function bindingsFromVariableRoles(
  parts: UICompositionContract["parts"],
  variables: VariableRef[],
  literalFallbackApproved: boolean
): VariableBindingPlan["bindings"] | "needs-literal-approval" | undefined {
  const partsWithRoles = parts.filter((part) => (part.variableRoles ?? []).length > 0);
  if (partsWithRoles.length === 0) return undefined;

  const missingRequiredRole = partsWithRoles.some((part) =>
    (part.variableRoles ?? []).some(
      (role) => role.optional !== true && variableForRole(role, variables) === undefined
    )
  );
  if (missingRequiredRole && !literalFallbackApproved) return "needs-literal-approval";

  return partsWithRoles.flatMap((part) =>
    (part.variableRoles ?? []).flatMap((role) => {
      const variable = variableForRole(role, variables);
      if (variable === undefined && role.optional === true) return [];
      if (variable === undefined) {
        return [
          {
            targetId: part.id,
            property: role.property,
            source: "approved-literal" as const,
            literalValue: "draft-only",
            approvalRef: "approve-literal-variable-fallback",
          },
        ];
      }
      return [variableBinding(part.id, role.property, variable)];
    })
  );
}

function variableForRole(
  role: VariableRoleRequirement,
  variables: VariableRef[]
): VariableRef | undefined {
  const byProperty = variables.filter(
    (variable) => propertyForVariable(variable) === role.property
  );
  const semanticTokens = tokensFor(role.semanticRole).filter(
    (token) => !["color", "text", "fill", "background", "style", "variable"].includes(token)
  );
  const matches = byProperty.filter((variable) => {
    const nameTokens = tokensFor(variable.name ?? "");
    return semanticTokens.length > 0
      ? semanticTokens.every((token) => nameTokens.includes(token))
      : nameTokens.join(" ") === tokensFor(role.semanticRole).join(" ");
  });
  if (matches.length === 1) return matches[0];
  const exact = matches.filter(
    (variable) =>
      tokensFor(variable.name ?? "").join(" ") === tokensFor(role.semanticRole).join(" ")
  );
  return exact.length === 1 ? exact[0] : undefined;
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

function tokensFor(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
