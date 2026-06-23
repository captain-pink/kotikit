import type { FigmaShim } from "./figma-shim.js";

// Mirror of src/planning/design-plan-schema.ts DesignPlan shape.
// Duplicated because the plugin's tsconfig doesn't reach into src/.
export interface DesignPlan {
  version: 1;
  scope: string;
  screen?: string;
  pageName: string;
  target?: FigmaDraftTarget;
  states: string[];
  layout?: {
    version: 1;
    strategy: "semantic-zones";
    zones: Array<{
      id: LayoutZoneId;
      parent: LayoutZoneId;
      direction: "VERTICAL" | "HORIZONTAL";
      padding: number;
      itemSpacing: number;
      minTargetSize: number;
    }>;
    placements: Array<{
      componentName: string;
      role: ComponentRole;
      zone: LayoutZoneId;
    }>;
  };
  steps: DesignPlanStep[];
  createdAt: string;
}

export interface FigmaDraftTarget {
  fileKey: string;
  pageId: string;
  pageName: string;
  pageUrl: string;
  boundAt: string;
  source: "user-url" | "plugin-current-page";
  section?: {
    id?: string;
    name: string;
  };
  safety: {
    requireDraftPageName: true;
    allowPageCreation: false;
    requireKotikitSection: true;
  };
}

export type ComponentRole =
  | "navigation"
  | "primary-action"
  | "secondary-action"
  | "destructive-action"
  | "search-input"
  | "filter-control"
  | "data-display"
  | "status-indicator"
  | "binary-control"
  | "feedback"
  | "content";

export type LayoutZoneId =
  | "root"
  | "navigation"
  | "header"
  | "header-actions"
  | "controls"
  | "content"
  | "content-status"
  | "content-toggles"
  | "content-actions"
  | "feedback";

export type DesignPlanStep =
  | { kind: "define-state-frame"; state: string; width: number; height: number | "auto" }
  | {
      kind: "apply-auto-layout";
      state: string;
      direction: "VERTICAL" | "HORIZONTAL";
      padding: number;
      itemSpacing: number;
    }
  | {
      kind: "define-layout-zone";
      state: string;
      zone: LayoutZoneId;
      parentZone?: LayoutZoneId;
      direction: "VERTICAL" | "HORIZONTAL";
      padding: number;
      itemSpacing: number;
      minTargetSize: number;
    }
  | {
      kind: "place-component";
      state: string;
      componentName: string;
      dsKey?: string;
      variant?: Record<string, string>;
      role?: ComponentRole;
      zone?: LayoutZoneId;
    }
  | {
      kind: "bind-variable";
      state: string;
      variableName: string;
      property: "fill" | "text" | "effect";
      nodeNameHint?: string;
    };

export interface ApplyStepResult {
  stepIndex: number;
  outcome: "ok" | "warned" | "failed";
  note?: string;
  fileKey?: string;
  page?: {
    id: string;
    name: string;
  };
  section?: {
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
  role?: ComponentRole;
  zone?: LayoutZoneId;
}

export interface OrchestratorOpts {
  shim: FigmaShim;
  plan: DesignPlan;
  onStep?: (result: ApplyStepResult) => void;
}

interface OrchestratorState {
  pageId: string | null;
  pageName: string | null;
  sectionId: string | null;
  sectionName: string | null;
  frameByState: Map<string, string>;
  frameByZone: Map<string, string>;
}

const zoneKey = (state: string, zone: LayoutZoneId): string => `${state}:${zone}`;
const isDraftPageName = (name: string): boolean => /\bdrafts?\b/i.test(name);

const resultWithContext = (
  result: ApplyStepResult,
  shim: FigmaShim,
  state: OrchestratorState,
  _plan: DesignPlan
): ApplyStepResult => ({
  ...result,
  ...(shim.getFileKey() !== undefined ? { fileKey: shim.getFileKey() } : {}),
  ...(state.pageId !== null && state.pageName !== null
    ? { page: { id: state.pageId, name: state.pageName } }
    : {}),
  ...(state.sectionId !== null && state.sectionName !== null
    ? { section: { id: state.sectionId, name: state.sectionName } }
    : {}),
});

async function ensureState(
  state: OrchestratorState,
  shim: FigmaShim,
  plan: DesignPlan
): Promise<void> {
  if (state.pageId !== null && state.sectionId !== null) return;
  const target = plan.target;
  if (target === undefined) {
    throw new Error("Design plan is missing a Figma draft target.");
  }
  const fileKey = shim.getFileKey();
  if (fileKey !== target.fileKey) {
    throw new Error("This plugin is open in a different Figma file than the bound draft target.");
  }
  const page = await shim.getPageById(target.pageId);
  if (page === null) {
    throw new Error("The bound Figma draft page could not be found.");
  }
  if (!isDraftPageName(page.name)) {
    throw new Error(
      "The bound Figma page name must contain Draft or Drafts before kotikit can write to it."
    );
  }
  await shim.setCurrentPage(page.id);
  const sectionName =
    target.section?.name ?? `kotikit / ${plan.scope}${plan.screen ? ` / ${plan.screen}` : ""}`;
  const section = await shim.findOrCreateSection({
    pageId: page.id,
    name: sectionName,
    metadata: {
      scope: plan.scope,
      ...(plan.screen !== undefined ? { screen: plan.screen } : {}),
      targetPageId: page.id,
      targetFileKey: target.fileKey,
      createdAt: target.boundAt,
    },
  });
  state.pageId = page.id;
  state.pageName = page.name;
  state.sectionId = section.id;
  state.sectionName = section.name;
}

async function applyStepInner(
  step: DesignPlanStep,
  stepIndex: number,
  shim: FigmaShim,
  state: OrchestratorState,
  plan: DesignPlan
): Promise<ApplyStepResult> {
  await ensureState(state, shim, plan);
  const sectionId = state.sectionId;
  if (sectionId === null) {
    throw new Error("Design plan section was not initialized.");
  }

  try {
    if (step.kind === "define-state-frame") {
      const frame = await shim.createFrame({
        name: step.state,
        parentId: sectionId,
        width: step.width,
        height: step.height,
      });
      state.frameByState.set(step.state, frame.id);
      state.frameByZone.set(zoneKey(step.state, "root"), frame.id);
      return resultWithContext(
        {
          stepIndex,
          outcome: "ok",
          stepKind: step.kind,
          state: step.state,
          node: { id: frame.id, kind: "frame", name: step.state },
        },
        shim,
        state,
        plan
      );
    }
    if (step.kind === "apply-auto-layout") {
      const frameId = state.frameByState.get(step.state);
      if (!frameId)
        return resultWithContext(
          {
            stepIndex,
            outcome: "warned",
            note: `no state frame for ${step.state}`,
            stepKind: step.kind,
            state: step.state,
          },
          shim,
          state,
          plan
        );
      await shim.setAutoLayout(frameId, {
        direction: step.direction,
        padding: step.padding,
        itemSpacing: step.itemSpacing,
      });
      return resultWithContext(
        {
          stepIndex,
          outcome: "ok",
          stepKind: step.kind,
          state: step.state,
          node: { id: frameId, kind: "frame", name: step.state },
        },
        shim,
        state,
        plan
      );
    }
    if (step.kind === "define-layout-zone") {
      const parentZone = step.parentZone ?? "root";
      const parentId = state.frameByZone.get(zoneKey(step.state, parentZone));
      if (!parentId) {
        return resultWithContext(
          {
            stepIndex,
            outcome: "warned",
            note: `no parent zone ${parentZone} for ${step.state}`,
            stepKind: step.kind,
            state: step.state,
            zone: step.zone,
          },
          shim,
          state,
          plan
        );
      }
      const parentSize = await shim.getNodeSize(parentId);
      const frame = await shim.createFrame({
        name: step.zone,
        parentId,
        width: parentSize?.width ?? step.minTargetSize,
        height: step.minTargetSize,
      });
      await shim.setAutoLayout(frame.id, {
        direction: step.direction,
        padding: step.padding,
        itemSpacing: step.itemSpacing,
      });
      state.frameByZone.set(zoneKey(step.state, step.zone), frame.id);
      return resultWithContext(
        {
          stepIndex,
          outcome: "ok",
          stepKind: step.kind,
          state: step.state,
          zone: step.zone,
          node: { id: frame.id, kind: "frame", name: step.zone },
        },
        shim,
        state,
        plan
      );
    }
    if (step.kind === "place-component") {
      if (!step.dsKey) {
        return resultWithContext(
          {
            stepIndex,
            outcome: "warned",
            note: `no dsKey for ${step.componentName}`,
            stepKind: step.kind,
            state: step.state,
            componentName: step.componentName,
          },
          shim,
          state,
          plan
        );
      }
      const frameId = step.zone
        ? state.frameByZone.get(zoneKey(step.state, step.zone))
        : state.frameByState.get(step.state);
      if (!frameId)
        return resultWithContext(
          {
            stepIndex,
            outcome: "warned",
            note: `no target frame for ${step.state}${step.zone ? `/${step.zone}` : ""}`,
            stepKind: step.kind,
            state: step.state,
            componentName: step.componentName,
            dsKey: step.dsKey,
            role: step.role,
            zone: step.zone,
          },
          shim,
          state,
          plan
        );
      const component = await shim.importComponentByKey(step.dsKey);
      const inst = await shim.appendInstance(frameId, component.id);
      if (step.variant) {
        await shim.setVariantProperties(inst.instanceId, step.variant);
      }
      return resultWithContext(
        {
          stepIndex,
          outcome: "ok",
          stepKind: step.kind,
          state: step.state,
          componentName: step.componentName,
          dsKey: step.dsKey,
          role: step.role,
          zone: step.zone,
          node: { id: inst.instanceId, kind: "instance", name: step.componentName },
        },
        shim,
        state,
        plan
      );
    }
    // bind-variable
    const frameId = state.frameByState.get(step.state);
    if (!frameId)
      return resultWithContext(
        {
          stepIndex,
          outcome: "warned",
          note: `no state frame for ${step.state}`,
          stepKind: step.kind,
          state: step.state,
        },
        shim,
        state,
        plan
      );
    const variable = await shim.findVariableByName(step.variableName);
    if (!variable)
      return resultWithContext(
        {
          stepIndex,
          outcome: "warned",
          note: `variable not found: ${step.variableName}`,
          stepKind: step.kind,
          state: step.state,
        },
        shim,
        state,
        plan
      );
    await shim.setBoundVariable(frameId, step.property, variable.id);
    return resultWithContext(
      {
        stepIndex,
        outcome: "ok",
        stepKind: step.kind,
        state: step.state,
        node: { id: frameId, kind: "frame", name: step.state },
      },
      shim,
      state,
      plan
    );
  } catch (err) {
    return resultWithContext(
      { stepIndex, outcome: "failed", note: (err as Error).message, stepKind: step.kind },
      shim,
      state,
      plan
    );
  }
}

export async function applyAll(opts: OrchestratorOpts): Promise<ApplyStepResult[]> {
  const state: OrchestratorState = {
    pageId: null,
    pageName: null,
    sectionId: null,
    sectionName: null,
    frameByState: new Map(),
    frameByZone: new Map(),
  };
  const results: ApplyStepResult[] = [];
  for (const [i, step] of opts.plan.steps.entries()) {
    const result = await applyStepInner(step, i, opts.shim, state, opts.plan);
    results.push(result);
    opts.onStep?.(result);
  }
  return results;
}

export async function applyStep(
  opts: OrchestratorOpts & { stepIndex: number }
): Promise<ApplyStepResult> {
  const state: OrchestratorState = {
    pageId: null,
    pageName: null,
    sectionId: null,
    sectionName: null,
    frameByState: new Map(),
    frameByZone: new Map(),
  };
  // Rebuild state frame map by re-running all preceding define-state-frame steps.
  // For Phase 5 MVP, applyStep is a "place a single item somewhere" — it requires
  // the state frame to already exist. We do a minimal re-init: if any earlier
  // step is define-state-frame for the same state, re-create it.
  // Simpler: apply ALL steps up to and including stepIndex, returning the final.
  // (The plugin UI typically uses applyAll; per-step Run is meant for incremental.)
  let final: ApplyStepResult = {
    stepIndex: opts.stepIndex,
    outcome: "failed",
    note: "step index out of range",
  };
  for (const [i, step] of opts.plan.steps.entries()) {
    if (i > opts.stepIndex) break;
    final = await applyStepInner(step, i, opts.shim, state, opts.plan);
    opts.onStep?.(final);
  }
  return final;
}
