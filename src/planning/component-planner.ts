import { slugifyComponentName, nowIso } from "../util/ids.js";
import type {
  ComponentResolution,
  ComponentVariablePolicy,
  ScreenComponent,
  ScreenSpec,
} from "../spec/schema.js";
import type { VariablesJson, VariableEntry } from "../sync/variables.js";
import {
  hasUsableVariables,
  resolveVariable,
} from "../sync/variable-resolver.js";
import { KotikitError } from "../util/result.js";
import type {
  ComponentPlan,
  ComponentPlanMode,
  ComponentPlanStep,
  ComponentTokenRef,
} from "./component-plan-schema.js";
import { ComponentPlanSchema } from "./component-plan-schema.js";

export interface GenerateComponentPlanInput {
  scope: string;
  screen: string | null;
  spec: ScreenSpec;
  mode: ComponentPlanMode;
  variables: VariablesJson | null;
  componentNames?: string[];
  allowLiteralFallback?: boolean;
}

export interface GenerateComponentPlanOutput {
  plan: ComponentPlan;
  updatedSpec: ScreenSpec;
}

const componentSpecRefFor = (name: string): string =>
  `components/${slugifyComponentName(name)}.component.json`;

const isExistingComponent = (component: ScreenComponent): boolean =>
  component.dsKey !== undefined || component.resolution?.kind === "existing-ds";

const isResolvedCustomComponent = (component: ScreenComponent): boolean =>
  component.resolution?.kind === "create-draft-component" ||
  component.resolution?.kind === "inline-draft";

const componentNeedsDecision = (component: ScreenComponent): boolean =>
  !isExistingComponent(component) && !isResolvedCustomComponent(component);

const selectedComponentNames = (names?: string[]): Set<string> | null =>
  names !== undefined && names.length > 0 ? new Set(names) : null;

const componentsToPlan = (
  components: ScreenComponent[],
  names?: string[]
): ScreenComponent[] => {
  const selected = selectedComponentNames(names);
  return components.filter((component) => {
    if (!componentNeedsDecision(component)) return false;
    return selected === null || selected.has(component.name);
  });
};

const tokenRefFrom = (
  intent: ComponentTokenRef["intent"],
  entry: VariableEntry | null
): ComponentTokenRef | null =>
  entry === null
    ? null
    : {
        intent,
        kind: entry.kind,
        name: entry.name,
        source: entry.source,
        ...(entry.id !== undefined ? { id: entry.id } : {}),
        ...(entry.key !== undefined ? { key: entry.key } : {}),
      };

const plannedTokenRefs = (variables: VariablesJson | null): ComponentTokenRef[] => {
  if (variables === null) return [];

  return [
    tokenRefFrom("surface", resolveVariable(variables, { kind: "color", nameHints: ["primary", "surface"] })),
    tokenRefFrom("text", resolveVariable(variables, { kind: "color", nameHints: ["text", "on surface"] })),
    tokenRefFrom("spacing", resolveVariable(variables, { kind: "spacing", nameHints: ["space", "spacing", "4"] })),
    tokenRefFrom("radius", resolveVariable(variables, { kind: "spacing", nameHints: ["radius"] })),
  ].filter((entry): entry is ComponentTokenRef => entry !== null);
};

const resolutionFor = (
  mode: ComponentPlanMode,
  componentName: string,
  variablePolicy: ComponentVariablePolicy
): ComponentResolution =>
  mode === "create-draft-components"
    ? {
        kind: "create-draft-component",
        status: "planned",
        componentSpecRef: componentSpecRefFor(componentName),
        variablePolicy,
      }
    : {
        kind: "inline-draft",
        status: "approved",
        variablePolicy,
      };

const planStepFor = (
  component: ScreenComponent,
  mode: ComponentPlanMode,
  variablePolicy: ComponentVariablePolicy,
  tokenRefs: ComponentTokenRef[]
): ComponentPlanStep =>
  mode === "create-draft-components"
    ? {
        kind: "create-draft-component",
        componentName: component.name,
        ...(component.usage !== undefined ? { usage: component.usage } : {}),
        componentSpecRef: componentSpecRefFor(component.name),
        variablePolicy,
        tokenRefs,
      }
    : {
        kind: "create-inline-draft",
        componentName: component.name,
        ...(component.usage !== undefined ? { usage: component.usage } : {}),
        variablePolicy,
        tokenRefs,
      };

const updateSpecComponents = (
  spec: ScreenSpec,
  plannedComponents: ScreenComponent[],
  mode: ComponentPlanMode,
  variablePolicy: ComponentVariablePolicy
): ScreenSpec => {
  const plannedNames = new Set(plannedComponents.map((component) => component.name));
  return {
    ...spec,
    components: spec.components.map((component) =>
      plannedNames.has(component.name)
        ? {
            ...component,
            resolution: resolutionFor(mode, component.name, variablePolicy),
          }
        : component
    ),
    metadata: {
      ...spec.metadata,
      updatedAt: nowIso(),
    },
  };
};

export function generateComponentPlan(
  input: GenerateComponentPlanInput
): GenerateComponentPlanOutput {
  const plannedComponents = componentsToPlan(input.spec.components, input.componentNames);
  if (plannedComponents.length === 0) {
    throw new KotikitError(
      "I couldn't find any unresolved components to plan.",
      "Check the component names, or continue with the design task if every component already exists in the synced design system."
    );
  }

  const variablesReady = input.variables !== null && hasUsableVariables(input.variables);
  const literalFallbackAllowed = !variablesReady && input.allowLiteralFallback === true;
  if (!variablesReady && !literalFallbackAllowed) {
    throw new KotikitError(
      "This component plan needs design variables before it can proceed.",
      "Ask kotikit to sync variables through the kotikit Figma plugin, then run this again. If you explicitly accept hardcoded literal values for this draft only, retry with allowLiteralFallback enabled."
    );
  }

  const variablePolicy: ComponentVariablePolicy = literalFallbackAllowed
    ? "allow-literals-after-user-confirmation"
    : "require-existing-variables";
  const tokenRefs = plannedTokenRefs(input.variables);
  const steps = plannedComponents.map((component) =>
    planStepFor(component, input.mode, variablePolicy, tokenRefs)
  );
  const updatedSpec = updateSpecComponents(
    input.spec,
    plannedComponents,
    input.mode,
    variablePolicy
  );

  const plan = ComponentPlanSchema.parse({
    version: 1,
    scope: input.scope,
    ...(input.screen !== null ? { screen: input.screen } : {}),
    mode: input.mode,
    literalFallbackAllowed,
    requiresHumanReview: input.mode === "create-draft-components",
    steps,
    createdAt: nowIso(),
  });

  return { plan, updatedSpec };
}
