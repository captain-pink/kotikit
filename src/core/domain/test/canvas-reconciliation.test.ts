import { describe, expect, it } from "bun:test";
import { reconcileCanvasNodes } from "../canvas-reconciliation.js";

describe("canvas reconciliation", () => {
  it("keeps moved nodes mapped by node id and updates current bounds", () => {
    const report = reconcileCanvasNodes({
      fileKey: "FILE",
      pageId: "1:2",
      now: "2026-07-01T00:00:00.000Z",
      ledger: ledgerWithNode({
        nodeId: "9:10",
        name: "Members / Filled",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
      }),
      currentNodes: [
        {
          nodeId: "9:10",
          name: "Members / Filled v2",
          bounds: { x: 1200, y: 400, width: 1440, height: 900 },
        },
      ],
    });

    expect(report.nodes[0]).toMatchObject({
      nodeId: "9:10",
      ledgerStatus: "moved",
      currentBounds: { x: 1200, y: 400, width: 1440, height: 900 },
      transactionId: "txn-state-filled",
    });
  });

  it("flags missing ledger nodes as human-risk for comment mapping", () => {
    const report = reconcileCanvasNodes({
      fileKey: "FILE",
      pageId: "1:2",
      now: "2026-07-01T00:00:00.000Z",
      ledger: ledgerWithNode({
        nodeId: "missing",
        name: "Members / Filled",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
      }),
      currentNodes: [],
    });

    expect(report.unmappedCommentsRisk).toBe("needs-human");
    expect(report.nodes[0]?.ledgerStatus).toBe("missing");
  });
});

function ledgerWithNode(input: {
  nodeId: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
}) {
  return {
    schemaVersion: "FigmaNodeLedger/v1" as const,
    fileKey: "FILE",
    pageId: "1:2",
    sectionName: "kotikit / members / 2026-07-01",
    updatedAt: "2026-07-01T00:00:00.000Z",
    nodes: [
      {
        nodeId: input.nodeId,
        name: input.name,
        kind: "FRAME",
        semanticRole: "screen-state" as const,
        transactionId: "txn-state-filled",
        placementId: "state-filled",
        stateId: "filled",
        bounds: input.bounds,
        componentRefs: [],
        variableRefs: [],
        autoLayout: true,
        recordedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  };
}
