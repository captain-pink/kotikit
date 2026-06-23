import type { Config } from "../config/schema.js";
import type { FigmaDraftTarget } from "../figma/draft-target.js";
import type { FlowManifest, ScreenSpec } from "../spec/schema.js";
import { componentNameFor, nowIso } from "../util/ids.js";
import { type DesignPlan, DesignPlanSchema, type DesignPlanStep } from "./design-plan-schema.js";
import { buildLayoutContract, type LayoutZoneId } from "./layout-contract.js";

export interface GenerateDesignPlanInput {
  scope: string;
  screen: string | null;
  spec: ScreenSpec;
  flowManifest?: FlowManifest;
  config: Config;
  target?: FigmaDraftTarget;
}

/**
 * Pure function: turn a screen spec into a validated DesignPlan.
 * No disk I/O.
 *
 * Step ordering rule: for each state, emit
 *   1. define-state-frame
 *   2. apply-auto-layout
 *   3. define-layout-zone (one per required semantic zone)
 *   4. place-component (one per spec.components, in declared order)
 *   5. bind-variable (one per declared variable name — see strategy below)
 *
 * Then move to the next state. This way the plugin can apply a partial
 * subset (e.g. only "loading" state steps) without depending on later steps.
 */
export function generateDesignPlan(input: GenerateDesignPlanInput): DesignPlan {
  const { scope, screen, spec, target } = input;

  // Page name: PascalCase of screen slug for flows; PascalCase of scope for single-screen.
  const pageName = componentNameFor(scope, screen);

  // Resolve states from spec; default to ["default"] if none declared.
  const stateKeys = Object.keys(spec.requirements.states ?? {});
  const states = stateKeys.length > 0 ? stateKeys : ["default"];
  const layout = buildLayoutContract({ spec });

  const layoutZoneStepsFor = (state: string): DesignPlanStep[] =>
    layout.zones.map((zone) => ({
      kind: "define-layout-zone" as const,
      state,
      zone: zone.id,
      parentZone: zone.parent,
      direction: zone.direction,
      padding: zone.padding,
      itemSpacing: zone.itemSpacing,
      minTargetSize: zone.minTargetSize,
    }));

  const placementByComponent = new Map(
    layout.placements.map((placement) => [placement.componentName, placement])
  );

  // Build steps state-by-state
  const steps: DesignPlanStep[] = states.flatMap((state) => [
    {
      kind: "define-state-frame",
      state,
      width: 1440,
      height: "auto",
    },
    {
      kind: "apply-auto-layout",
      state,
      direction: "VERTICAL",
      padding: 24,
      itemSpacing: 16,
    },
    ...layoutZoneStepsFor(state),
    ...(spec.components ?? []).map<DesignPlanStep>((component) => {
      const placement = placementByComponent.get(component.name);
      return {
        kind: "place-component",
        state,
        componentName: component.name,
        ...(component.dsKey ? { dsKey: component.dsKey } : {}),
        ...(placement?.role ? { role: placement.role } : {}),
        ...(placement?.zone ? { zone: placement.zone as LayoutZoneId } : {}),
      };
    }),
  ]);

  const plan = {
    version: 1 as const,
    scope,
    ...(screen !== null ? { screen } : {}),
    pageName,
    ...(target !== undefined ? { target } : {}),
    states,
    layout,
    steps,
    createdAt: nowIso(),
  };

  return DesignPlanSchema.parse(plan);
}
