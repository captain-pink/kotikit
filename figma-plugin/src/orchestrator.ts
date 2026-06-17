import type { FigmaShim } from "./figma-shim.js";

// Mirror of src/planning/design-plan-schema.ts DesignPlan shape.
// Duplicated because the plugin's tsconfig doesn't reach into src/.
export interface DesignPlan {
  version: 1;
  scope: string;
  screen?: string;
  pageName: string;
  states: string[];
  steps: DesignPlanStep[];
  createdAt: string;
}

export type DesignPlanStep =
  | { kind: "define-state-frame"; state: string; width: number; height: number | "auto" }
  | { kind: "apply-auto-layout"; state: string; direction: "VERTICAL" | "HORIZONTAL"; padding: number; itemSpacing: number }
  | { kind: "place-component"; state: string; componentName: string; dsKey?: string; variant?: Record<string, string> }
  | { kind: "bind-variable"; state: string; variableName: string; property: "fill" | "text" | "effect"; nodeNameHint?: string };

export interface ApplyStepResult {
  stepIndex: number;
  outcome: "ok" | "warned" | "failed";
  note?: string;
  fileKey?: string;
  page?: {
    id: string;
    name: string;
  };
  node?: {
    id: string;
    kind: "page" | "frame" | "instance" | "node";
    name?: string;
  };
  stepKind?: DesignPlanStep["kind"];
  state?: string;
  componentName?: string;
  dsKey?: string;
}

export interface OrchestratorOpts {
  shim: FigmaShim;
  plan: DesignPlan;
  onStep?: (result: ApplyStepResult) => void;
}

interface OrchestratorState {
  pageId: string | null;
  frameByState: Map<string, string>;
}

const resultWithContext = (
  result: ApplyStepResult,
  shim: FigmaShim,
  state: OrchestratorState,
  plan: DesignPlan
): ApplyStepResult => ({
  ...result,
  ...(shim.getFileKey() !== undefined ? { fileKey: shim.getFileKey() } : {}),
  ...(state.pageId !== null ? { page: { id: state.pageId, name: plan.pageName } } : {}),
});

async function ensureState(state: OrchestratorState, shim: FigmaShim, plan: DesignPlan): Promise<void> {
  if (state.pageId !== null) return;
  const page = await shim.findOrCreatePage(plan.pageName);
  await shim.setCurrentPage(page.id);
  state.pageId = page.id;
}

async function applyStepInner(
  step: DesignPlanStep,
  stepIndex: number,
  shim: FigmaShim,
  state: OrchestratorState,
  plan: DesignPlan
): Promise<ApplyStepResult> {
  await ensureState(state, shim, plan);

  try {
    if (step.kind === "define-state-frame") {
      const frame = await shim.createFrame({
        name: step.state,
        parentId: state.pageId!,
        width: step.width,
        height: step.height,
      });
      state.frameByState.set(step.state, frame.id);
      return resultWithContext({
        stepIndex,
        outcome: "ok",
        stepKind: step.kind,
        state: step.state,
        node: { id: frame.id, kind: "frame", name: step.state },
      }, shim, state, plan);
    }
    if (step.kind === "apply-auto-layout") {
      const frameId = state.frameByState.get(step.state);
      if (!frameId) return resultWithContext({ stepIndex, outcome: "warned", note: `no state frame for ${step.state}`, stepKind: step.kind, state: step.state }, shim, state, plan);
      await shim.setAutoLayout(frameId, {
        direction: step.direction,
        padding: step.padding,
        itemSpacing: step.itemSpacing,
      });
      return resultWithContext({
        stepIndex,
        outcome: "ok",
        stepKind: step.kind,
        state: step.state,
        node: { id: frameId, kind: "frame", name: step.state },
      }, shim, state, plan);
    }
    if (step.kind === "place-component") {
      if (!step.dsKey) {
        return resultWithContext({
          stepIndex,
          outcome: "warned",
          note: `no dsKey for ${step.componentName}`,
          stepKind: step.kind,
          state: step.state,
          componentName: step.componentName,
        }, shim, state, plan);
      }
      const frameId = state.frameByState.get(step.state);
      if (!frameId) return resultWithContext({ stepIndex, outcome: "warned", note: `no state frame for ${step.state}`, stepKind: step.kind, state: step.state, componentName: step.componentName, dsKey: step.dsKey }, shim, state, plan);
      const component = await shim.importComponentByKey(step.dsKey);
      const inst = await shim.appendInstance(frameId, component.id);
      if (step.variant) {
        await shim.setVariantProperties(inst.instanceId, step.variant);
      }
      return resultWithContext({
        stepIndex,
        outcome: "ok",
        stepKind: step.kind,
        state: step.state,
        componentName: step.componentName,
        dsKey: step.dsKey,
        node: { id: inst.instanceId, kind: "instance", name: step.componentName },
      }, shim, state, plan);
    }
    // bind-variable
    const frameId = state.frameByState.get(step.state);
    if (!frameId) return resultWithContext({ stepIndex, outcome: "warned", note: `no state frame for ${step.state}`, stepKind: step.kind, state: step.state }, shim, state, plan);
    const variable = await shim.findVariableByName(step.variableName);
    if (!variable) return resultWithContext({ stepIndex, outcome: "warned", note: `variable not found: ${step.variableName}`, stepKind: step.kind, state: step.state }, shim, state, plan);
    await shim.setBoundVariable(frameId, step.property, variable.id);
    return resultWithContext({
      stepIndex,
      outcome: "ok",
      stepKind: step.kind,
      state: step.state,
      node: { id: frameId, kind: "frame", name: step.state },
    }, shim, state, plan);
  } catch (err) {
    return resultWithContext({ stepIndex, outcome: "failed", note: (err as Error).message, stepKind: step.kind }, shim, state, plan);
  }
}

export async function applyAll(opts: OrchestratorOpts): Promise<ApplyStepResult[]> {
  const state: OrchestratorState = { pageId: null, frameByState: new Map() };
  const results: ApplyStepResult[] = [];
  for (let i = 0; i < opts.plan.steps.length; i++) {
    const step = opts.plan.steps[i]!;
    const result = await applyStepInner(step, i, opts.shim, state, opts.plan);
    results.push(result);
    opts.onStep?.(result);
  }
  return results;
}

export async function applyStep(opts: OrchestratorOpts & { stepIndex: number }): Promise<ApplyStepResult> {
  const state: OrchestratorState = { pageId: null, frameByState: new Map() };
  // Rebuild state frame map by re-running all preceding define-state-frame steps.
  // For Phase 5 MVP, applyStep is a "place a single item somewhere" — it requires
  // the state frame to already exist. We do a minimal re-init: if any earlier
  // step is define-state-frame for the same state, re-create it.
  // Simpler: apply ALL steps up to and including stepIndex, returning the final.
  // (The plugin UI typically uses applyAll; per-step Run is meant for incremental.)
  let final: ApplyStepResult = { stepIndex: opts.stepIndex, outcome: "failed", note: "step index out of range" };
  for (let i = 0; i <= opts.stepIndex && i < opts.plan.steps.length; i++) {
    const step = opts.plan.steps[i]!;
    final = await applyStepInner(step, i, opts.shim, state, opts.plan);
    opts.onStep?.(final);
  }
  return final;
}
