import { KotikitError } from "../../util/result.js";
import type { DraftComponentLifecycle, DraftComponentPlan } from "../schemas/artifact.js";

type CreatedDraftComponent = {
  id?: unknown;
  name?: unknown;
  componentKey?: unknown;
  nodeId?: unknown;
  componentNodeId?: unknown;
};

type AppliedInstance = {
  draftComponentId?: unknown;
  nodeId?: unknown;
  stateId?: unknown;
};

type DraftComponentPlacement = {
  draftComponentId?: unknown;
  pageId?: unknown;
  sectionName?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  overlapsGeneratedScreen?: unknown;
  overlapsScreen?: unknown;
};

export function buildDraftComponentLifecycle(input: {
  plan: DraftComponentPlan;
  createdDraftComponents: CreatedDraftComponent[];
  appliedInstances: AppliedInstance[];
  placements?: DraftComponentPlacement[];
}): DraftComponentLifecycle {
  return {
    schemaVersion: "DraftComponentLifecycle/v1",
    sectionName: input.plan.sectionName,
    components: input.plan.components.map((component) => {
      const created = input.createdDraftComponents.find((item) => item.id === component.id);
      const instances = input.appliedInstances.filter(
        (instance) =>
          instance.draftComponentId === component.id && typeof instance.nodeId === "string"
      );
      const placement = (input.placements ?? []).find(
        (item) => item.draftComponentId === component.id
      );
      const overlapsGeneratedScreen =
        placement?.overlapsGeneratedScreen === true || placement?.overlapsScreen === true;
      return {
        draftComponentId: component.id,
        name: component.name,
        reason: component.reason,
        ...(typeof created?.componentKey === "string"
          ? { componentKey: created.componentKey }
          : {}),
        ...(componentNodeIdFrom(created) === undefined
          ? {}
          : { componentNodeId: componentNodeIdFrom(created) }),
        placement: placementFor(placement, input.plan.sectionName),
        requiredInstances: 1,
        actualInstances: instances.map((instance) => ({
          nodeId: String(instance.nodeId),
          ...(typeof instance.stateId === "string" ? { stateId: instance.stateId } : {}),
        })),
        status: overlapsGeneratedScreen
          ? "overlap-blocked"
          : instances.length > 0
            ? "used"
            : "orphan-blocked",
      };
    }),
  };
}

export function verifyDraftComponentLifecycle(lifecycle: DraftComponentLifecycle): void {
  const orphan = lifecycle.components.find((component) => component.status === "orphan-blocked");
  if (orphan !== undefined) {
    throw new KotikitError(
      `Draft component "${orphan.name}" was created but not used in the generated design.`,
      "Use an instance of every created draft component, or explicitly approve keeping it unused."
    );
  }

  const overlap = lifecycle.components.find((component) => component.status === "overlap-blocked");
  if (overlap !== undefined) {
    throw new KotikitError(
      `Draft component "${overlap.name}" overlaps the generated screen.`,
      "Move draft components into the reserved Kotikit Draft Components area before continuing."
    );
  }
}

function componentNodeIdFrom(component: CreatedDraftComponent | undefined): string | undefined {
  if (typeof component?.componentNodeId === "string") return component.componentNodeId;
  if (typeof component?.nodeId === "string") return component.nodeId;
  return undefined;
}

function placementFor(
  placement: DraftComponentPlacement | undefined,
  fallbackSectionName: string
): DraftComponentLifecycle["components"][number]["placement"] {
  if (placement === undefined) return { sectionName: fallbackSectionName };
  return {
    ...(typeof placement.pageId === "string" ? { pageId: placement.pageId } : {}),
    sectionName:
      typeof placement.sectionName === "string" ? placement.sectionName : fallbackSectionName,
    ...(typeof placement.x === "number" ? { x: placement.x } : {}),
    ...(typeof placement.y === "number" ? { y: placement.y } : {}),
    ...(typeof placement.width === "number" ? { width: placement.width } : {}),
    ...(typeof placement.height === "number" ? { height: placement.height } : {}),
  };
}
