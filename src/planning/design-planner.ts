import { nowIso, componentNameFor } from "../util/ids.js";
import type { ScreenSpec, FlowManifest } from "../spec/schema.js";
import type { Config } from "../config/schema.js";
import {
  DesignPlanSchema,
  type DesignPlan,
  type DesignPlanStep,
} from "./design-plan-schema.js";

export interface GenerateDesignPlanInput {
  scope: string;
  screen: string | null;
  spec: ScreenSpec;
  flowManifest?: FlowManifest;
  config: Config;
}

/**
 * Pure function: turn a screen spec into a validated DesignPlan.
 * No disk I/O.
 *
 * Step ordering rule: for each state, emit
 *   1. define-state-frame
 *   2. apply-auto-layout
 *   3. place-component (one per spec.components, in declared order)
 *   4. bind-variable (one per declared variable name — see strategy below)
 *
 * Then move to the next state. This way the plugin can apply a partial
 * subset (e.g. only "loading" state steps) without depending on later steps.
 */
export function generateDesignPlan(input: GenerateDesignPlanInput): DesignPlan {
  const { scope, screen, spec } = input;

  // Page name: PascalCase of screen slug for flows; PascalCase of scope for single-screen.
  const pageName = componentNameFor(scope, screen);

  // Resolve states from spec; default to ["default"] if none declared.
  const stateKeys = Object.keys(spec.requirements.states ?? {});
  const states = stateKeys.length > 0 ? stateKeys : ["default"];

  // Build steps state-by-state
  const steps: DesignPlanStep[] = [];
  for (const state of states) {
    // 1. frame
    steps.push({
      kind: "define-state-frame",
      state,
      width: 1440,
      height: "auto",
    });
    // 2. auto-layout
    steps.push({
      kind: "apply-auto-layout",
      state,
      direction: "VERTICAL",
      padding: 24,
      itemSpacing: 16,
    });
    // 3. one place-component per spec.components entry
    for (const c of spec.components ?? []) {
      const step: DesignPlanStep = {
        kind: "place-component",
        state,
        componentName: c.name,
        ...(c.dsKey ? { dsKey: c.dsKey } : {}),
      };
      steps.push(step);
    }
    // 4. NO bind-variable steps by default in Phase 5 MVP.
    //    The spec doesn't carry a variable list. If we want to remind the
    //    designer to bind brand colors, we can emit a single placeholder
    //    bind-variable per state — but that adds noise.
    //    Decision: skip bind-variable in MVP. Designer can add manually.
    //    (The schema supports it; the planner just doesn't generate any.)
  }

  const plan = {
    version: 1 as const,
    scope,
    ...(screen !== null ? { screen } : {}),
    pageName,
    states,
    steps,
    createdAt: nowIso(),
  };

  return DesignPlanSchema.parse(plan);
}
