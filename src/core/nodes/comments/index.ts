import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { reconcileCanvasNodes } from "../../domain/canvas-reconciliation.js";
import { buildCommentEvidenceMap } from "../../domain/comment-evidence-map.js";
import {
  pruneCanvasReviewPayloads,
  pruneRawReviewPayloads,
} from "../../domain/context-durability.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType, type Bounds } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});

export const commentNodeDefinitions: NodeDefinition[] = [
  node({
    key: "comments.reconcileCanvas",
    stateReads: ["figmaNodeLedger", "review"],
    stateWrites: ["canvasReconciliation"],
    run: async (input) => {
      const state = graphState(input.state);
      if (state.figmaNodeLedger === undefined) return {} satisfies RuntimeNodeOutput;

      const report = reconcileCanvasNodes({
        fileKey: state.figmaNodeLedger.fileKey,
        pageId: state.figmaNodeLedger.pageId,
        now: nowIso(),
        ledger: state.figmaNodeLedger,
        currentNodes: currentNodesForReview(recordFrom(state.review), state.figmaNodeLedger.nodes),
      });

      return {
        statePatch: {
          canvasReconciliation: report,
          review: pruneCanvasReviewPayloads(recordFrom(state.review)),
        },
        artifacts: [canvasReconciliationArtifact(state, report)],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "comments.buildEvidenceMap",
    stateReads: ["review", "applyReport", "canvasReconciliation"],
    stateWrites: ["commentEvidenceMap", "review"],
    requiredCapabilities: ["comments.read"],
    run: async (input) => {
      const state = graphState(input.state);
      const review = recordFrom(state.review);
      const snapshot = recordFrom(review.commentSnapshot);
      const comments = recordArray(snapshot.comments).map(normalizeComment);
      const applyReport = recordFrom(state.applyReport);
      const canvasReconciliation = recordFrom(state.canvasReconciliation);
      const missingNodeIds = missingReconciliationNodeIds(canvasReconciliation);
      const fileKey = stringField(snapshot, "fileKey") ?? stringField(applyReport, "fileKey");
      if (fileKey === undefined) {
        throw new KotikitError(
          "Kotikit could not find a Figma file key for comment review.",
          "Start the comment review from a Figma file URL or provide a seeded comment snapshot."
        );
      }
      const commentEvidenceMap = buildCommentEvidenceMap({
        fileKey,
        comments,
        nodeMap: {
          fileKey,
          nodes: [
            ...filterMissingTargets(
              nodeTargetsFromNodeMap(recordFrom(snapshot.nodeMap)),
              missingNodeIds
            ),
            ...filterMissingTargets(
              nodeTargetsFromNodeMap(recordFrom(review.nodeMap)),
              missingNodeIds
            ),
            ...filterMissingTargets(nodeTargetsFromNodeMap(applyReport), missingNodeIds),
            ...nodeTargetsFromNodeMap(canvasReconciliation),
          ].filter((node) => !missingNodeIds.has(stringField(node, "nodeId") ?? "")),
        },
        mappedAt: nowIso(),
      });
      return {
        statePatch: {
          commentEvidenceMap,
          review: pruneRawReviewPayloads({ ...review, commentEvidenceMap }),
        },
        artifacts: [commentEvidenceArtifact(state, commentEvidenceMap)],
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function canvasReconciliationArtifact(
  state: KotikitGraphState,
  payload: Artifact["payload"]
): Artifact {
  const now = nowIso();
  return {
    id: `${state.runId}-canvas-reconciliation-report`,
    runId: state.runId,
    type: "canvas-reconciliation-report",
    schemaVersion: ArtifactSchemaVersionByType["canvas-reconciliation-report"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "comments.reconcileCanvas", version: "1.0.0" },
    payload,
  };
}

function commentEvidenceArtifact(state: KotikitGraphState, payload: Artifact["payload"]): Artifact {
  const now = nowIso();
  return {
    id: `${state.runId}-comment-evidence-map`,
    runId: state.runId,
    type: "comment-evidence-map",
    schemaVersion: ArtifactSchemaVersionByType["comment-evidence-map"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "comments.buildEvidenceMap", version: "1.0.0" },
    payload,
  };
}

function node(
  input: Partial<NodeDefinition> & Pick<NodeDefinition, "key" | "run">
): NodeDefinition {
  return {
    key: input.key,
    version: "1.0.0",
    kind: input.kind ?? "deterministic",
    paramsSchema: input.paramsSchema ?? EmptyParamsSchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: input.stateReads ?? [],
    stateWrites: input.stateWrites ?? [],
    sideEffects: input.sideEffects ?? "none",
    requiredCapabilities: input.requiredCapabilities ?? [],
    run: input.run,
  };
}

function normalizeComment(comment: Record<string, unknown>): Record<string, unknown> {
  const nodeId = stringField(comment, "nodeId");
  if (nodeId === undefined || comment.client_meta !== undefined) return comment;
  return {
    ...comment,
    client_meta: { node_id: nodeId },
  };
}

function nodeTargetsFromNodeMap(nodeMap: Record<string, unknown>): Record<string, unknown>[] {
  return recordArray(nodeMap.nodes).flatMap((node) => {
    const nodeId = stringField(node, "nodeId") ?? stringField(node, "id");
    if (nodeId === undefined) return [];
    const partId = stringField(node, "partId");
    const base = {
      nodeId,
      nodeName:
        stringField(node, "nodeName") ??
        stringField(node, "name") ??
        stringField(node, "currentName") ??
        stringField(node, "previousName") ??
        stringField(node, "componentName"),
      partId,
      stateId: stringField(node, "stateId"),
      componentKey: stringField(node, "componentKey"),
      draftComponentId: stringField(node, "draftComponentId"),
      bounds:
        boundsField(node, "currentBounds") ??
        boundsField(node, "bounds") ??
        boundsField(node, "previousBounds"),
    };
    return partId !== undefined && partId !== nodeId ? [base, { ...base, nodeId: partId }] : [base];
  });
}

function currentNodesForReview(
  review: Record<string, unknown>,
  ledgerNodes: Array<{ nodeId: string; name: string; bounds: Bounds }>
): Array<{ nodeId: string; name: string; bounds?: Bounds }> {
  if (!Array.isArray(review.currentNodes)) {
    return ledgerNodes.map((node) => ({
      nodeId: node.nodeId,
      name: node.name,
      bounds: node.bounds,
    }));
  }

  return recordArray(review.currentNodes).flatMap((node) => {
    const nodeId = stringField(node, "nodeId") ?? stringField(node, "id");
    const name =
      stringField(node, "name") ??
      stringField(node, "nodeName") ??
      stringField(node, "currentName");
    const bounds = boundsField(node, "bounds") ?? boundsField(node, "currentBounds");
    if (nodeId === undefined || name === undefined) return [];
    return [
      {
        nodeId,
        name,
        ...(bounds === undefined ? {} : { bounds }),
      },
    ];
  });
}

function missingReconciliationNodeIds(reconciliation: Record<string, unknown>): Set<string> {
  return new Set(
    recordArray(reconciliation.nodes)
      .filter((node) => node.ledgerStatus === "missing")
      .flatMap((node) => {
        const nodeId = stringField(node, "nodeId");
        return nodeId === undefined ? [] : [nodeId];
      })
  );
}

function filterMissingTargets(
  nodes: Record<string, unknown>[],
  missingNodeIds: Set<string>
): Record<string, unknown>[] {
  if (missingNodeIds.size === 0) return nodes;
  return nodes.filter((node) => !missingNodeIds.has(stringField(node, "nodeId") ?? ""));
}

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function boundsField(record: Record<string, unknown>, key: string): Bounds | undefined {
  const bounds = recordFrom(record[key]);
  return typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number" &&
    bounds.width > 0 &&
    bounds.height > 0
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : undefined;
}
