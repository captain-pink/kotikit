import { KotikitError } from "../../util/result.js";
import { type CanvasPlan, CanvasPlanSchema } from "../schemas/artifact.js";

const DRAFT_LANE_WIDTH = 360;
const ZONE_GAP = 200;
const SCREEN_GAP = 160;
const DRAFT_COMPONENT_HEIGHT = 240;
const SCREEN_COLUMNS = 2;

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
}): CanvasPlan {
  const draftPlacements = input.draftComponents.map(
    (component, index): CanvasPlacement => ({
      id: `draft-${component.id}`,
      kind: "draft-component",
      draftComponentId: component.id,
      label: component.name,
      bounds: {
        x: 0,
        y: index * (DRAFT_COMPONENT_HEIGHT + SCREEN_GAP),
        width: DRAFT_LANE_WIDTH,
        height: DRAFT_COMPONENT_HEIGHT,
      },
      parentZoneId: "zone-draft-components",
      transactionId: `txn-draft-${component.id}`,
    })
  );

  const statePlacements = input.states.map((state, index): CanvasPlacement => {
    const column = index % SCREEN_COLUMNS;
    const row = Math.floor(index / SCREEN_COLUMNS);
    return {
      id: `state-${state.id}`,
      kind: "screen-state",
      stateId: state.id,
      label: `${input.screenTitle} - ${state.label}`,
      bounds: {
        x: DRAFT_LANE_WIDTH + ZONE_GAP + column * (input.screenSize.width + SCREEN_GAP),
        y: row * (input.screenSize.height + SCREEN_GAP),
        width: input.screenSize.width,
        height: input.screenSize.height,
      },
      parentZoneId: "zone-screen-states",
      transactionId: `txn-state-${state.id}`,
    };
  });

  const placements = [...draftPlacements, ...statePlacements];
  const plan: CanvasPlan = {
    schemaVersion: "CanvasPlan/v1",
    section: {
      ...(input.sectionId === undefined ? {} : { id: input.sectionId }),
      name: input.sectionName,
    },
    coordinateSpace: "section-relative",
    screenSize: input.screenSize,
    minGap: SCREEN_GAP,
    zones: [
      {
        id: "zone-draft-components",
        kind: "draft-components",
        label: "Draft components",
        bounds: draftZoneBounds(input.draftComponents.length),
      },
      {
        id: "zone-screen-states",
        kind: "screen-states",
        label: "Screen states",
        bounds: screenZoneBounds(input.screenSize, input.states.length),
      },
    ],
    placements,
    strategy: {
      primaryFirst: true,
      creationOrder: placements.map((placement) => placement.id),
      designerNotes: [
        "Draft components stay in the left lane; screen states use a deterministic two-column grid.",
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

function draftZoneBounds(draftComponentCount: number): CanvasZone["bounds"] {
  return {
    x: 0,
    y: 0,
    width: DRAFT_LANE_WIDTH,
    height: gridHeight(draftComponentCount, DRAFT_COMPONENT_HEIGHT),
  };
}

function screenZoneBounds(
  screenSize: { width: number; height: number },
  stateCount: number
): CanvasZone["bounds"] {
  return {
    x: DRAFT_LANE_WIDTH + ZONE_GAP,
    y: 0,
    width: screenSize.width * SCREEN_COLUMNS + SCREEN_GAP,
    height: gridHeight(Math.ceil(stateCount / SCREEN_COLUMNS), screenSize.height),
  };
}

function gridHeight(itemCount: number, itemHeight: number): number {
  const safeCount = Math.max(1, itemCount);
  return safeCount * itemHeight + (safeCount - 1) * SCREEN_GAP;
}
