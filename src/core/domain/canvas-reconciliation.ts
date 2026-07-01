import type { Bounds, CanvasReconciliationReport, FigmaNodeLedger } from "../schemas/artifact.js";

type CurrentNode = {
  nodeId: string;
  name: string;
  bounds?: Bounds;
};

export function reconcileCanvasNodes(input: {
  fileKey: string;
  pageId: string;
  now: string;
  ledger: FigmaNodeLedger;
  currentNodes: CurrentNode[];
}): CanvasReconciliationReport {
  const currentById = new Map(input.currentNodes.map((node) => [node.nodeId, node]));
  const ledgerIds = new Set(input.ledger.nodes.map((node) => node.nodeId));
  const ledgerNodes = input.ledger.nodes.map((ledgerNode) => {
    const current = currentById.get(ledgerNode.nodeId);
    if (current === undefined) {
      return {
        nodeId: ledgerNode.nodeId,
        ledgerStatus: "missing" as const,
        previousName: ledgerNode.name,
        previousBounds: ledgerNode.bounds,
        transactionId: ledgerNode.transactionId,
        placementId: ledgerNode.placementId,
        ...(ledgerNode.stateId === undefined ? {} : { stateId: ledgerNode.stateId }),
      };
    }

    const moved = current.bounds !== undefined && !boundsEqual(current.bounds, ledgerNode.bounds);
    const renamed = current.name !== ledgerNode.name;
    return {
      nodeId: ledgerNode.nodeId,
      ledgerStatus: moved
        ? ("moved" as const)
        : renamed
          ? ("renamed" as const)
          : ("matched" as const),
      previousName: ledgerNode.name,
      currentName: current.name,
      previousBounds: ledgerNode.bounds,
      ...(current.bounds === undefined ? {} : { currentBounds: current.bounds }),
      transactionId: ledgerNode.transactionId,
      placementId: ledgerNode.placementId,
      ...(ledgerNode.stateId === undefined ? {} : { stateId: ledgerNode.stateId }),
    };
  });
  const untrackedNodes = input.currentNodes
    .filter((node) => !ledgerIds.has(node.nodeId))
    .map((node) => ({
      nodeId: node.nodeId,
      ledgerStatus: "untracked" as const,
      currentName: node.name,
      ...(node.bounds === undefined ? {} : { currentBounds: node.bounds }),
    }));
  const nodes = [...ledgerNodes, ...untrackedNodes];

  return {
    schemaVersion: "CanvasReconciliationReport/v1",
    fileKey: input.fileKey,
    pageId: input.pageId,
    reconciledAt: input.now,
    nodes,
    unmappedCommentsRisk: riskFor(nodes),
  };
}

function boundsEqual(left: Bounds, right: Bounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function riskFor(
  nodes: CanvasReconciliationReport["nodes"]
): CanvasReconciliationReport["unmappedCommentsRisk"] {
  if (nodes.some((node) => node.ledgerStatus === "missing")) return "needs-human";
  if (nodes.some((node) => node.ledgerStatus === "untracked")) return "low";
  return "none";
}
