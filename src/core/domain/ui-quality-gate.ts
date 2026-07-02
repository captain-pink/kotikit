import type { CanvasPlan, UIQualityGateReport } from "../schemas/artifact.js";

type AppliedNode = Record<string, unknown>;

export function runUiQualityGate(input: {
  nodes: AppliedNode[];
  canvasPlan?: CanvasPlan;
  iconRequirements?: Record<string, unknown>[];
  iconRefs?: string[];
}): UIQualityGateReport {
  const checks = [
    check(
      "vertical-text",
      "Vertical text",
      input.nodes,
      (node) => node.textDirection === "vertical"
    ),
    check("mirrored-text", "Mirrored text", input.nodes, (node) => node.mirroredText === true),
    check("flipped-transform", "Flipped transforms", input.nodes, (node) =>
      hasNegativeTransform(node)
    ),
    check("positive-dimensions", "Positive dimensions", input.nodes, (node) =>
      hasNegativeDimension(node)
    ),
    check("clipped-text", "Clipped text", input.nodes, (node) => node.clippedText === true),
    check(
      "component-refs",
      "Component refs",
      input.nodes,
      (node) => node.expectedComponentRef === true && node.componentKey === undefined
    ),
    check(
      "detached-instances",
      "Detached instances",
      input.nodes,
      (node) => node.detachedInstance === true
    ),
    check(
      "layout-overlap",
      "Layout overlap",
      input.nodes,
      (node) => Array.isArray(node.overlaps) && node.overlaps.length > 0
    ),
    check(
      "hardcoded-imitation",
      "Hardcoded component imitation",
      input.nodes,
      (node) => node.hardcodedComponentImitation === true
    ),
    check(
      "state-preview-card",
      "State preview cards",
      input.nodes,
      (node) => node.statePreviewCard === true
    ),
    check(
      "missing-state-frame",
      "Missing state frame",
      input.nodes,
      (node) => node.expectedStateFrame === true && node.stateFrameNodeId === undefined
    ),
    check(
      "state-shell-drift",
      "State shell drift",
      input.nodes,
      (node) => node.stateShellDrift === true
    ),
    check(
      "orphan-draft-component",
      "Orphan draft component",
      input.nodes,
      (node) => node.orphanDraftComponent === true
    ),
    check(
      "draft-component-overlap",
      "Draft component overlap",
      input.nodes,
      (node) => node.draftComponentOverlap === true
    ),
    check(
      "draft-component-detached-use",
      "Draft component detached use",
      input.nodes,
      (node) => node.draftComponentDetachedUse === true
    ),
    checkCanvasOverlap(input.nodes),
    checkCanvasMinGap(input.nodes, input.canvasPlan),
    checkCanvasZoneMembership(input.nodes, input.canvasPlan),
    checkIconRefs(input.nodes, input.iconRequirements ?? [], input.iconRefs ?? []),
    checkScreenStateAutoLayout(input.nodes),
    checkMissingTransactionMetadata(input.nodes),
  ];

  return {
    schemaVersion: "UIQualityGateReport/v1",
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "passed",
    checks,
  };
}

function checkCanvasMinGap(
  nodes: AppliedNode[],
  canvasPlan: CanvasPlan | undefined
): UIQualityGateReport["checks"][number] {
  if (canvasPlan === undefined) return checkResult("canvas-min-gap", "Canvas minimum gap", []);
  const topLevelNodes = topLevelCanvasNodes(nodes);
  const findings = topLevelNodes.flatMap((left, index) =>
    topLevelNodes.slice(index + 1).flatMap((right) => {
      if (!hasBounds(left) || !hasBounds(right)) return [];
      const gap = gapBetween(left.bounds, right.bounds);
      return gap < canvasPlan.minGap
        ? [
            `${String(left.id ?? "unknown")} is ${Math.round(gap)}px from ${String(right.id ?? "unknown")}; expected at least ${canvasPlan.minGap}px`,
          ]
        : [];
    })
  );
  return checkResult("canvas-min-gap", "Canvas minimum gap", findings);
}

function checkCanvasZoneMembership(
  nodes: AppliedNode[],
  canvasPlan: CanvasPlan | undefined
): UIQualityGateReport["checks"][number] {
  if (canvasPlan === undefined) {
    return checkResult("canvas-zone-membership", "Canvas zone membership", []);
  }
  const placementsById = new Map(
    canvasPlan.placements.map((placement) => [placement.id, placement])
  );
  const zonesById = new Map(canvasPlan.zones.map((zone) => [zone.id, zone]));
  const findings = topLevelCanvasNodes(nodes).flatMap((node) => {
    const placementId = stringField(node, "placementId");
    if (placementId === undefined || !hasBounds(node)) return [];
    const placement = placementsById.get(placementId);
    const zone = placement === undefined ? undefined : zonesById.get(placement.parentZoneId);
    if (zone === undefined) return [`${String(node.id ?? "unknown")} has no planned canvas zone`];
    return boundsInside(node.bounds, zone.bounds)
      ? []
      : [`${String(node.id ?? "unknown")} is outside planned zone ${zone.label}`];
  });
  return checkResult("canvas-zone-membership", "Canvas zone membership", findings);
}

function checkIconRefs(
  nodes: AppliedNode[],
  iconRequirements: Record<string, unknown>[],
  iconRefs: string[]
): UIQualityGateReport["checks"][number] {
  if (iconRequirements.length === 0) return checkResult("icon-refs", "Icon refs", []);
  const globalRefs = new Set([
    ...iconRefs,
    ...nodes.flatMap((node) => stringArray(node.iconRefs)),
    ...nodes.flatMap((node) => {
      const iconKey = stringField(node, "iconKey");
      return iconKey === undefined ? [] : [iconKey];
    }),
  ]);
  const placeholderFindings = nodes
    .filter((node) => node.iconPlaceholder === true)
    .map((node) => `${String(node.id ?? "unknown")} uses an icon placeholder`);
  const missingRefFindings = iconRequirements
    .filter((requirement) => !iconRequirementSatisfied(requirement, nodes, globalRefs))
    .map(
      (requirement) => `${String(requirement.id ?? "icon")} has no recorded design-system icon ref`
    );
  return checkResult("icon-refs", "Icon refs", [...placeholderFindings, ...missingRefFindings]);
}

function iconRequirementSatisfied(
  requirement: Record<string, unknown>,
  nodes: AppliedNode[],
  globalIconRefs: Set<string>
): boolean {
  const expectedIconRef =
    stringField(requirement, "iconKey") ?? stringField(requirement, "iconName");
  const partId = stringField(requirement, "partId");
  if (partId === undefined) {
    if (expectedIconRef !== undefined) return globalIconRefs.has(expectedIconRef);
    return globalIconRefs.size > 0;
  }
  return nodes
    .filter((node) => stringField(node, "partId") === partId && node.iconPlaceholder !== true)
    .some((node) => {
      const refs = nodeIconRefs(node);
      if (expectedIconRef !== undefined) return refs.has(expectedIconRef);
      return refs.size > 0;
    });
}

function nodeIconRefs(node: AppliedNode): Set<string> {
  return new Set([
    ...stringArray(node.iconRefs),
    ...(stringField(node, "iconKey") === undefined ? [] : [String(node.iconKey)]),
  ]);
}

function checkCanvasOverlap(nodes: AppliedNode[]): UIQualityGateReport["checks"][number] {
  const topLevelNodes = topLevelCanvasNodes(nodes);
  const findings = topLevelNodes.flatMap((left, index) =>
    topLevelNodes
      .slice(index + 1)
      .flatMap((right) =>
        hasBounds(left) && hasBounds(right) && boundsOverlap(left.bounds, right.bounds)
          ? [`${String(left.id ?? "unknown")} overlaps ${String(right.id ?? "unknown")}`]
          : []
      )
  );
  return checkResult("canvas-overlap", "Canvas overlap", findings);
}

function checkScreenStateAutoLayout(nodes: AppliedNode[]): UIQualityGateReport["checks"][number] {
  return checkResult(
    "screen-state-auto-layout",
    "Screen state auto layout",
    nodes
      .filter((node) => node.semanticRole === "screen-state" && node.autoLayout !== true)
      .map((node) => String(node.id ?? "unknown"))
  );
}

function topLevelCanvasNodes(nodes: AppliedNode[]): AppliedNode[] {
  return nodes.filter((node) =>
    ["screen-state", "draft-component"].includes(String(node.semanticRole ?? ""))
  );
}

function checkMissingTransactionMetadata(
  nodes: AppliedNode[]
): UIQualityGateReport["checks"][number] {
  return checkResult(
    "transaction-metadata",
    "Transaction metadata",
    nodes
      .filter(
        (node) =>
          node.semanticRole !== undefined &&
          (node.transactionId === undefined || node.placementId === undefined)
      )
      .map((node) => String(node.id ?? "unknown"))
  );
}

function check(
  id: string,
  name: string,
  nodes: AppliedNode[],
  predicate: (node: AppliedNode) => boolean
): UIQualityGateReport["checks"][number] {
  const findings = nodes.filter(predicate).map((node) => String(node.id ?? "unknown"));
  return {
    id,
    name,
    status: findings.length > 0 ? "blocked" : "passed",
    ...(findings.length > 0 ? { findings } : {}),
    ...(findings.length > 0 ? { recommendedAction: recommendedActionFor(id) } : {}),
  };
}

function checkResult(
  id: string,
  name: string,
  findings: string[]
): UIQualityGateReport["checks"][number] {
  return {
    id,
    name,
    status: findings.length > 0 ? "blocked" : "passed",
    ...(findings.length > 0 ? { findings } : {}),
    ...(findings.length > 0 ? { recommendedAction: recommendedActionFor(id) } : {}),
  };
}

function recommendedActionFor(id: string): string {
  const actions: Record<string, string> = {
    "canvas-overlap": "Move generated frames into the canvas plan grid before continuing.",
    "canvas-min-gap": "Move generated frames to preserve the canvas plan minimum gap.",
    "canvas-zone-membership": "Move generated frames back into their planned canvas zone.",
    "component-refs":
      "Replace hardcoded layers with design-system or approved draft component instances.",
    "draft-component-detached-use":
      "Use linked draft component instances in the generated screen instead of detached copies.",
    "draft-component-overlap":
      "Move the draft component into the reserved draft component area before continuing.",
    "hardcoded-imitation":
      "Use a real design-system component, an approved draft component, or an explicit primitive exception.",
    "icon-refs": "Replace icon placeholders with icons from the planned design-system icon refs.",
    "layout-overlap": "Rebuild the affected region with auto layout so elements no longer overlap.",
    "missing-state-frame": "Create the required state frame or region state before continuing.",
    "orphan-draft-component":
      "Use every created draft component in the screen or remove the unused draft component.",
    "state-preview-card":
      "Represent this as a page, region, component, or flow state instead of an extra state card.",
    "state-shell-drift": "Keep persistent shell regions aligned across related screen states.",
    "screen-state-auto-layout": "Rebuild the screen state as an auto-layout frame.",
    "transaction-metadata": "Record transactionId and placementId for every generated node.",
  };
  return actions[id] ?? "Fix the blocked UI quality finding before continuing.";
}

function hasNegativeTransform(node: AppliedNode): boolean {
  const transform = node.transform;
  return (
    typeof transform === "object" &&
    transform !== null &&
    !Array.isArray(transform) &&
    (Number((transform as { scaleX?: unknown }).scaleX) < 0 ||
      Number((transform as { scaleY?: unknown }).scaleY) < 0)
  );
}

function hasNegativeDimension(node: AppliedNode): boolean {
  return Number(node.width) < 0 || Number(node.height) < 0;
}

function hasBounds(node: AppliedNode): node is AppliedNode & {
  bounds: { x: number; y: number; width: number; height: number };
} {
  return (
    typeof node.bounds === "object" &&
    node.bounds !== null &&
    !Array.isArray(node.bounds) &&
    typeof (node.bounds as { x?: unknown }).x === "number" &&
    typeof (node.bounds as { y?: unknown }).y === "number" &&
    typeof (node.bounds as { width?: unknown }).width === "number" &&
    typeof (node.bounds as { height?: unknown }).height === "number"
  );
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function boundsInside(
  child: { x: number; y: number; width: number; height: number },
  parent: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

function gapBetween(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): number {
  if (boundsOverlap(left, right)) return 0;
  const horizontalGap = Math.max(
    left.x - (right.x + right.width),
    right.x - (left.x + left.width),
    0
  );
  const verticalGap = Math.max(
    left.y - (right.y + right.height),
    right.y - (left.y + left.height),
    0
  );
  if (horizontalGap === 0) return verticalGap;
  if (verticalGap === 0) return horizontalGap;
  return Math.min(horizontalGap, verticalGap);
}

function boundsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}
