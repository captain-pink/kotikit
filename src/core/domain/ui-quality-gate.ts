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
  ];

  return {
    schemaVersion: "UIQualityGateReport/v1",
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "passed",
    checks,
  };
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
  };
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
