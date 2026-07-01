import type { UIQualityGateReport } from "../schemas/artifact.js";

type AppliedNode = Record<string, unknown>;

export function runUiQualityGate(input: { nodes: AppliedNode[] }): UIQualityGateReport {
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
    checkScreenStateAutoLayout(input.nodes),
    checkMissingTransactionMetadata(input.nodes),
  ];

  return {
    schemaVersion: "UIQualityGateReport/v1",
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "passed",
    checks,
  };
}

function checkCanvasOverlap(nodes: AppliedNode[]): UIQualityGateReport["checks"][number] {
  const topLevelNodes = nodes.filter((node) =>
    ["screen-state", "draft-component"].includes(String(node.semanticRole ?? ""))
  );
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
    "component-refs":
      "Replace hardcoded layers with design-system or approved draft component instances.",
    "draft-component-detached-use":
      "Use linked draft component instances in the generated screen instead of detached copies.",
    "draft-component-overlap":
      "Move the draft component into the reserved draft component area before continuing.",
    "hardcoded-imitation":
      "Use a real design-system component, an approved draft component, or an explicit primitive exception.",
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
