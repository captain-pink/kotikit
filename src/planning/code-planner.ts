import { nowIso, componentNameFor } from "../util/ids.js";
import type { Config } from "../config/schema.js";
import type { ScreenSpec, FlowManifest } from "../spec/schema.js";
import {
  CodePlanSchema,
  type CodePlan,
  type CodePlanStep,
} from "./code-plan-schema.js";

export interface GenerateCodePlanInput {
  root: string;             // user's project root (used only to construct targetPath if needed)
  scope: string;            // e.g. "checkout-flow"
  screen: string | null;   // e.g. "cart" or null for single-screen
  spec: ScreenSpec;
  flowManifest?: FlowManifest;
  config: Config;
}

/**
 * Pure function: turn a screen spec into an ordered, validated CodePlan.
 * No disk I/O. The plan-store writes it to <screen>.code.plan.json separately.
 */
export function generateCodePlan(input: GenerateCodePlanInput): CodePlan {
  const { scope, screen, spec, config } = input;
  const componentName = componentNameFor(scope, screen);

  // Build relative targetPath: <codeComponentsDir>/<scope>/<componentName>.tsx
  const targetPath = `${config.project.codeComponentsDir}/${scope}/${componentName}.tsx`;

  // tests on?
  const testsOn =
    config.project.tests && config.project.testFramework === "vitest";
  const testPath = testsOn
    ? `${config.project.codeComponentsDir}/${scope}/${componentName}.test.tsx`
    : undefined;

  // Steps
  const steps: CodePlanStep[] = [];

  // 1. scaffold-component
  steps.push({
    kind: "scaffold-component",
    title: `Scaffold ${componentName} component with prop types and default export`,
    notes: [],
  });

  // 2. compose-states — one note per state key
  const stateKeys = Object.keys(spec.requirements.states);
  steps.push({
    kind: "compose-states",
    title: `Implement ${stateKeys.length} state branch${stateKeys.length === 1 ? "" : "es"}`,
    notes: stateKeys.map((k) => `${k}: ${spec.requirements.states[k]}`),
  });

  // 3. compose-interactions — one note per functional requirement
  steps.push({
    kind: "compose-interactions",
    title: `Wire ${spec.requirements.functional.length} functional behavior${spec.requirements.functional.length === 1 ? "" : "s"}`,
    notes: spec.requirements.functional,
  });

  // 4. compose-accessibility
  steps.push({
    kind: "compose-accessibility",
    title: "Apply WCAG-AA accessibility",
    notes: [
      "Ensure semantic HTML first; ARIA only where semantics fall short.",
      "Establish keyboard order; specify what gets focus on mount.",
      "Use aria-live for async feedback; respect reduced-motion.",
      "Verify AA contrast on every visible text/background pair.",
    ],
  });

  // 5. compose-responsive — note breakpoints
  const breakpoints = resolveBreakpoints(spec, config);
  steps.push({
    kind: "compose-responsive",
    title: "Apply responsive layout",
    notes: [`Honor breakpoints: ${breakpoints.join(", ")}px.`],
  });

  // 6. generate-test (only if tests on)
  if (testPath) {
    steps.push({
      kind: "generate-test",
      title: `Generate Vitest unit tests at ${componentName}.test.tsx`,
      notes:
        spec.acceptanceCriteria.length > 0
          ? spec.acceptanceCriteria.map((c) => `Assert: ${c}`)
          : ["No acceptance criteria — emit a placeholder `renders` test."],
    });
  }

  const plan = {
    version: 1 as const,
    scope,
    ...(screen !== null ? { screen } : {}),
    componentName,
    targetPath,
    ...(testPath ? { testPath } : {}),
    dsComponentRefs: spec.components.map((c) => ({
      name: c.name,
      ...(c.dsKey ? { dsKey: c.dsKey } : {}),
    })),
    steps,
    createdAt: nowIso(),
  };

  return CodePlanSchema.parse(plan);
}

function resolveBreakpoints(spec: ScreenSpec, config: Config): number[] {
  const r = spec.requirements.responsive;
  if (typeof r === "object" && "overrides" in r) return r.overrides.breakpoints;
  return config.defaults.breakpoints;
}
