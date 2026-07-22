import { type Bounds, BoundsSchema } from "../../core/schemas/artifact.js";
import type { FigmaNode } from "../../sync/figma-types.js";

export type CompactCommentNode = {
  nodeId: string;
  nodeName?: string;
  kind?: string;
  parentNodeId?: string;
  bounds?: Bounds;
};

export type CompactCommentNodeMap = {
  nodes: CompactCommentNode[];
};

/** Wraps a returned comment snapshot in the graph's canonical feedback shape. */
export function normalizeReviewFeedback(value: unknown): unknown {
  const feedback = recordFrom(value);
  if (stringField(feedback, "schemaVersion") !== "FigmaCommentSnapshot/v1") return value;
  return {
    commentSnapshot: feedback,
    includeResolved: feedback.includeResolved === true,
  };
}

/** Collects unique Figma node ids referenced by compact comment anchors. */
export function commentAnchorNodeIds(comments: Record<string, unknown>[]): string[] {
  return [
    ...new Set(
      comments.flatMap((comment) => {
        const nodeId = stringField(recordFrom(comment.client_meta), "node_id");
        return nodeId === undefined ? [] : [nodeId];
      })
    ),
  ];
}

/** Keeps only target geometry needed to map comments to verified Figma nodes. */
export function compactCommentNodeMap(nodesById: Record<string, FigmaNode>): CompactCommentNodeMap {
  const nodes = Object.entries(nodesById).flatMap(([requestedId, response]) => {
    const document = recordFrom(response.document);
    if (Object.keys(document).length === 0) return [];
    const rootId = stringField(document, "id") ?? nonEmptyString(requestedId);
    if (rootId === undefined) return [];

    const root = compactNode(document, rootId);
    const children = recordArray(document.children).flatMap((child) => {
      const childId = stringField(child, "id");
      return childId === undefined ? [] : [compactNode(child, childId, rootId)];
    });
    return [root, ...children];
  });

  return {
    nodes: [
      ...nodes
        .reduce<Map<string, CompactCommentNode>>((unique, node) => {
          if (!unique.has(node.nodeId)) unique.set(node.nodeId, node);
          return unique;
        }, new Map())
        .values(),
    ],
  };
}

// Compacts one Figma document node without retaining arbitrary API payload data.
function compactNode(
  node: Record<string, unknown>,
  nodeId: string,
  parentNodeId?: string
): CompactCommentNode {
  const bounds = boundsFrom(node.absoluteBoundingBox);
  return {
    nodeId,
    ...(stringField(node, "name") === undefined ? {} : { nodeName: stringField(node, "name") }),
    ...(stringField(node, "type") === undefined ? {} : { kind: stringField(node, "type") }),
    ...(parentNodeId === undefined ? {} : { parentNodeId }),
    ...(bounds === undefined ? {} : { bounds }),
  };
}

function boundsFrom(value: unknown): Bounds | undefined {
  const parsed = BoundsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
  return nonEmptyString(record[key]);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
