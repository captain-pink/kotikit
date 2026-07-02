import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { createBuiltInNodeRegistry } from "../../built-in-registry.js";

describe("comment graph nodes", () => {
  it("builds evidence map from seeded REST snapshot and apply metadata", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "Loading state is missing",
              client_meta: { node_id: "1:2" },
            },
          ],
        },
      },
      applyReport: {
        fileKey: "file-1",
        nodes: [
          {
            nodeId: "1:2",
            nodeName: "Members table",
            partId: "members-table",
          },
        ],
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      schemaVersion: "CommentEvidenceMap/v1",
      comments: [expect.objectContaining({ mappingStrategy: "node-id" })],
    });
  });

  it("builds evidence map from seeded snapshot target metadata", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        nodeMap: {
          nodes: [
            {
              nodeId: "primary-action",
              nodeName: "Primary Action",
              partId: "primary-action",
            },
          ],
        },
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "Spacing around the primary action is loose",
              client_meta: { node_id: "primary-action" },
            },
          ],
          nodeMap: {
            nodes: [
              {
                nodeId: "primary-action",
                nodeName: "Primary Action",
                partId: "primary-action",
              },
            ],
          },
        },
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      schemaVersion: "CommentEvidenceMap/v1",
      comments: [expect.objectContaining({ mappingStrategy: "node-id" })],
    });
    expect(recordFrom(output.statePatch?.review).commentEvidenceMap).toBeUndefined();
    expect(recordFrom(output.statePatch?.review).commentSnapshot).toBeUndefined();
    expect(recordFrom(output.statePatch?.review).nodeMap).toBeUndefined();
    expect(recordFrom(output.statePatch?.review).commentSnapshotRef).toBe("comment-evidence-map");
  });

  it("reconciles moved Figma nodes before comment review", async () => {
    const output = await runNode("comments.reconcileCanvas", {
      figmaNodeLedger: ledgerWithNode({
        nodeId: "9:10",
        name: "Members / Filled",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
      }),
      review: {
        currentNodes: [
          {
            nodeId: "9:10",
            name: "Members / Filled v2",
            bounds: { x: 1200, y: 400, width: 1440, height: 900 },
          },
        ],
      },
    });

    expect(output.statePatch?.canvasReconciliation).toMatchObject({
      schemaVersion: "CanvasReconciliationReport/v1",
      unmappedCommentsRisk: "none",
      nodes: [
        expect.objectContaining({
          nodeId: "9:10",
          ledgerStatus: "moved",
          currentBounds: { x: 1200, y: 400, width: 1440, height: 900 },
        }),
      ],
    });
    expect(recordFrom(output.statePatch?.review).currentNodes).toBeUndefined();
    expect(recordFrom(output.statePatch?.review).currentNodesRef).toBe(
      "canvas-reconciliation-report"
    );
  });

  it("flags deleted generated nodes as human-risk before comment mapping", async () => {
    const output = await runNode("comments.reconcileCanvas", {
      figmaNodeLedger: ledgerWithNode({
        nodeId: "9:10",
        name: "Members / Filled",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
      }),
      review: { currentNodes: [] },
    });

    expect(output.statePatch?.canvasReconciliation).toMatchObject({
      unmappedCommentsRisk: "needs-human",
      nodes: [expect.objectContaining({ nodeId: "9:10", ledgerStatus: "missing" })],
    });
  });

  it("uses reconciled current bounds before ledger bounds in evidence targets", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "This state moved, keep the comment attached.",
              client_meta: { node_id: "9:10" },
            },
          ],
        },
      },
      applyReport: {
        fileKey: "file-1",
        pageId: "1:2",
        nodes: [
          {
            id: "9:10",
            name: "Members / Filled",
            bounds: { x: 560, y: 0, width: 1440, height: 900 },
          },
        ],
      },
      canvasReconciliation: {
        schemaVersion: "CanvasReconciliationReport/v1",
        fileKey: "file-1",
        pageId: "1:2",
        reconciledAt: "2026-07-01T00:00:00.000Z",
        unmappedCommentsRisk: "none",
        nodes: [
          {
            nodeId: "9:10",
            ledgerStatus: "moved",
            previousName: "Members / Filled",
            currentName: "Members / Filled v2",
            previousBounds: { x: 560, y: 0, width: 1440, height: 900 },
            currentBounds: { x: 1200, y: 400, width: 1440, height: 900 },
            transactionId: "txn-state-filled",
            placementId: "state-filled",
            stateId: "filled",
          },
        ],
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      comments: [
        expect.objectContaining({
          mappedTarget: expect.objectContaining({
            nodeId: "9:10",
            nodeName: "Members / Filled v2",
            bounds: { x: 1200, y: 400, width: 1440, height: 900 },
          }),
        }),
      ],
    });
  });

  it("does not map comments to missing generated nodes from stale apply metadata", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "Where did this frame go?",
              client_meta: { node_id: "9:10" },
            },
          ],
        },
      },
      applyReport: {
        fileKey: "file-1",
        pageId: "1:2",
        nodes: [
          {
            id: "9:10",
            name: "Members / Filled",
            bounds: { x: 560, y: 0, width: 1440, height: 900 },
          },
        ],
      },
      canvasReconciliation: {
        schemaVersion: "CanvasReconciliationReport/v1",
        fileKey: "file-1",
        pageId: "1:2",
        reconciledAt: "2026-07-01T00:00:00.000Z",
        unmappedCommentsRisk: "needs-human",
        nodes: [
          {
            nodeId: "9:10",
            ledgerStatus: "missing",
            previousName: "Members / Filled",
            previousBounds: { x: 560, y: 0, width: 1440, height: 900 },
            transactionId: "txn-state-filled",
            placementId: "state-filled",
            stateId: "filled",
          },
        ],
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      unmappedCount: 1,
      comments: [
        expect.objectContaining({
          mappingStrategy: "unmapped",
          mappingConfidence: "none",
          status: "needs-human",
        }),
      ],
    });
  });
});

async function runNode(
  key: string,
  patch: Partial<KotikitGraphState>
): Promise<{ statePatch?: Partial<KotikitGraphState> }> {
  const registry = createBuiltInNodeRegistry();
  const node = registry.get(key);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as {
    statePatch?: Partial<KotikitGraphState>;
  };
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-comments",
    flowId: "review-comments",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/project" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ledgerWithNode(input: {
  nodeId: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
}) {
  return {
    schemaVersion: "FigmaNodeLedger/v1" as const,
    fileKey: "file-1",
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
