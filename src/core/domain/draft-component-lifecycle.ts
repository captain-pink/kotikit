import { KotikitError } from "../../util/result.js";
import type { DraftComponentLifecycle, DraftComponentPlan } from "../schemas/artifact.js";

type CreatedDraftComponent = {
  id?: unknown;
  name?: unknown;
  componentKey?: unknown;
  nodeId?: unknown;
};

type AppliedInstance = {
  draftComponentId?: unknown;
  nodeId?: unknown;
  stateId?: unknown;
};

export function buildDraftComponentLifecycle(input: {
  plan: DraftComponentPlan;
  createdDraftComponents: CreatedDraftComponent[];
  appliedInstances: AppliedInstance[];
}): DraftComponentLifecycle {
  return {
    schemaVersion: "DraftComponentLifecycle/v1",
    sectionName: "Kotikit Draft Components",
    components: input.plan.components.map((component) => {
      const created = input.createdDraftComponents.find((item) => item.id === component.id);
      const instances = input.appliedInstances.filter(
        (instance) =>
          instance.draftComponentId === component.id && typeof instance.nodeId === "string"
      );
      return {
        draftComponentId: component.id,
        name: component.name,
        reason: component.reason,
        ...(typeof created?.componentKey === "string"
          ? { componentKey: created.componentKey }
          : {}),
        ...(typeof created?.nodeId === "string" ? { componentNodeId: created.nodeId } : {}),
        placement: { sectionName: "Kotikit Draft Components" },
        requiredInstances: 1,
        actualInstances: instances.map((instance) => ({
          nodeId: String(instance.nodeId),
          ...(typeof instance.stateId === "string" ? { stateId: instance.stateId } : {}),
        })),
        status: instances.length > 0 ? "used" : "orphan-blocked",
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
