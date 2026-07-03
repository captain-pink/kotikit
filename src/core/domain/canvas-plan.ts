import { KotikitError } from "../../util/result.js";
import { type CanvasPlan, CanvasPlanSchema } from "../schemas/artifact.js";

const ZONE_GAP = 200;
const SCREEN_GAP = 160;
const DRAFT_LANE_WIDTH = 360;
const DRAFT_COMPONENT_HEIGHT = 240;
const SCREEN_COLUMNS = 2;
const DEFAULT_SECTION_STYLE = {
  background: {
    color: "AED0FF",
    opacity: 0.1,
  },
} as const;

type CanvasPlacement = CanvasPlan["placements"][number];
type CanvasZone = CanvasPlan["zones"][number];
type Bounds = CanvasPlacement["bounds"];

export function buildCanvasPlan(input: {
  sectionName: string;
  sectionId?: string;
  screenTitle: string;
  screenSize: { width: number; height: number };
  states: { id: string; label: string; kind: string }[];
  draftComponents: { id: string; name: string }[];
  replacementTarget?: {
    nodeId: string;
    name?: string;
    bounds: Bounds;
  };
  sectionStyle?: CanvasPlan["sectionStyle"];
}): CanvasPlan {
  if (input.replacementTarget !== undefined) {
    return buildReplacementCanvasPlan({
      ...input,
      replacementTarget: input.replacementTarget,
    });
  }

  const screenZone = screenZoneFor(input.screenSize, input.states.length);
  const draftZone =
    input.draftComponents.length === 0
      ? undefined
      : draftZoneFor({
          y: screenZone.bounds.y + screenZone.bounds.height + ZONE_GAP,
          draftComponentCount: input.draftComponents.length,
        });

  const statePlacements = input.states.map((state, index): CanvasPlacement => {
    const column = index % SCREEN_COLUMNS;
    const row = Math.floor(index / SCREEN_COLUMNS);
    return {
      id: `state-${state.id}`,
      kind: "screen-state",
      stateId: state.id,
      label: `${input.screenTitle} - ${state.label}`,
      bounds: {
        x: column * (input.screenSize.width + SCREEN_GAP),
        y: row * (input.screenSize.height + SCREEN_GAP),
        width: input.screenSize.width,
        height: input.screenSize.height,
      },
      parentZoneId: "zone-screen-states",
      transactionId: `txn-state-${state.id}`,
    };
  });

  const draftPlacements = input.draftComponents.map(
    (component, index): CanvasPlacement => ({
      id: `draft-${component.id}`,
      kind: "draft-component",
      draftComponentId: component.id,
      label: component.name,
      bounds: {
        x: 0,
        y: (draftZone?.bounds.y ?? 0) + index * (DRAFT_COMPONENT_HEIGHT + SCREEN_GAP),
        width: DRAFT_LANE_WIDTH,
        height: DRAFT_COMPONENT_HEIGHT,
      },
      parentZoneId: "zone-draft-components",
      transactionId: `txn-draft-${component.id}`,
    })
  );

  const placements = [...statePlacements, ...draftPlacements];
  const plan: CanvasPlan = {
    schemaVersion: "CanvasPlan/v1",
    section: {
      ...(input.sectionId === undefined ? {} : { id: input.sectionId }),
      name: input.sectionName,
    },
    coordinateSpace: "section-relative",
    screenSize: input.screenSize,
    minGap: SCREEN_GAP,
    sectionStyle: input.sectionStyle ?? DEFAULT_SECTION_STYLE,
    zones: [screenZone, ...(draftZone === undefined ? [] : [draftZone])],
    placements,
    strategy: {
      primaryFirst: true,
      creationOrder: placements.map((placement) => placement.id),
      designerNotes: [
        "Create screen states first in a deterministic grid; optional draft components are placed below the completed screens.",
      ],
    },
  };

  const parsed = CanvasPlanSchema.parse(plan);
  verifyCanvasPlan(parsed);
  return parsed;
}

function buildReplacementCanvasPlan(input: {
  sectionName: string;
  sectionId?: string;
  screenTitle: string;
  states: { id: string; label: string; kind: string }[];
  replacementTarget: { nodeId: string; name?: string; bounds: Bounds };
  sectionStyle?: CanvasPlan["sectionStyle"];
}): CanvasPlan {
  const target = input.replacementTarget;
  const zone: CanvasZone = {
    id: "zone-existing-target",
    kind: "screen-states",
    label: target.name ?? input.screenTitle,
    bounds: target.bounds,
  };
  const placements = input.states.map(
    (state): CanvasPlacement => ({
      id: `state-${state.id}`,
      kind: "screen-state",
      stateId: state.id,
      label: `${target.name ?? input.screenTitle} - ${state.label}`,
      bounds: target.bounds,
      parentZoneId: zone.id,
      transactionId: `txn-state-${state.id}`,
      canvasOperation: "replace-target-frame",
      operation: "replace",
      targetNodeId: target.nodeId,
    })
  );
  const plan: CanvasPlan = {
    schemaVersion: "CanvasPlan/v1",
    mode: "replace",
    section: {
      ...(input.sectionId === undefined ? {} : { id: input.sectionId }),
      name: input.sectionName,
    },
    coordinateSpace: "section-relative",
    screenSize: { width: target.bounds.width, height: target.bounds.height },
    minGap: SCREEN_GAP,
    sectionStyle: input.sectionStyle ?? DEFAULT_SECTION_STYLE,
    zones: [zone],
    placements,
    strategy: {
      primaryFirst: true,
      creationOrder: placements.map((placement) => placement.id),
      designerNotes: [
        "Replace the exact existing target frame in place; do not create a new section or sibling screen frame.",
      ],
    },
  };

  const parsed = CanvasPlanSchema.parse(plan);
  verifyCanvasPlan(parsed);
  return parsed;
}

export function verifyCanvasPlan(plan: CanvasPlan): void {
  const zonesById = new Map(plan.zones.map((zone) => [zone.id, zone]));
  const missingParent = plan.placements.find((placement) => !zonesById.has(placement.parentZoneId));
  if (missingParent !== undefined) {
    throw new KotikitError(
      `Canvas placement ${missingParent.label} references missing zone ${missingParent.parentZoneId}.`,
      "Regenerate the canvas plan before creating Figma nodes."
    );
  }

  const outsideParent = plan.placements.find((placement) => {
    const parentZone = zonesById.get(placement.parentZoneId);
    return parentZone !== undefined && !boundsContain(parentZone.bounds, placement.bounds);
  });
  if (outsideParent !== undefined) {
    const parentZone = zonesById.get(outsideParent.parentZoneId);
    throw new KotikitError(
      `Canvas placement ${outsideParent.label} is outside parent zone ${parentZone?.label ?? outsideParent.parentZoneId}.`,
      "Move the placement fully inside its declared zone or regenerate the canvas plan before creating Figma nodes."
    );
  }

  plan.placements.forEach((left, leftIndex) => {
    const overlap = plan.placements
      .slice(leftIndex + 1)
      .find((right) => placementsOverlap(left, right, plan.minGap));
    if (overlap !== undefined) {
      throw new KotikitError(
        `Canvas placements overlap: ${left.label} and ${overlap.label}.`,
        "Move one placement or regenerate the deterministic canvas plan before creating Figma nodes."
      );
    }
  });
}

export function placementsOverlap(
  left: { bounds: Bounds },
  right: { bounds: Bounds },
  minGap = 0
): boolean {
  return (
    left.bounds.x < right.bounds.x + right.bounds.width + minGap &&
    right.bounds.x < left.bounds.x + left.bounds.width + minGap &&
    left.bounds.y < right.bounds.y + right.bounds.height + minGap &&
    right.bounds.y < left.bounds.y + left.bounds.height + minGap
  );
}

function boundsContain(parent: Bounds, child: Bounds): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

function draftZoneFor(input: { y: number; draftComponentCount: number }): CanvasZone {
  return {
    id: "zone-draft-components",
    kind: "draft-components",
    label: "Draft components",
    bounds: {
      x: 0,
      y: input.y,
      width: DRAFT_LANE_WIDTH,
      height: gridHeight(input.draftComponentCount, DRAFT_COMPONENT_HEIGHT),
    },
  };
}

function screenZoneFor(
  screenSize: { width: number; height: number },
  stateCount: number
): CanvasZone {
  return {
    id: "zone-screen-states",
    kind: "screen-states",
    label: "Screen states",
    bounds: {
      x: 0,
      y: 0,
      width: screenSize.width * SCREEN_COLUMNS + SCREEN_GAP,
      height: gridHeight(Math.ceil(stateCount / SCREEN_COLUMNS), screenSize.height),
    },
  };
}

function gridHeight(itemCount: number, itemHeight: number): number {
  const safeCount = Math.max(1, itemCount);
  return safeCount * itemHeight + (safeCount - 1) * SCREEN_GAP;
}
