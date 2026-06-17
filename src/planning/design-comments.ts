import type { FigmaComment } from "../sync/figma-types.js";
import type { DesignNodeMap, DesignNodeMapEntry } from "./design-node-map.js";

export interface ReviewCommentTarget {
  stepIndex: number;
  stepKind: DesignNodeMapEntry["stepKind"];
  state?: string;
  componentName?: string;
  dsKey?: string;
  nodeId: string;
  nodeKind: DesignNodeMapEntry["nodeKind"];
  nodeName?: string;
}

export interface ReviewComment {
  id: string;
  message: string;
  createdAt?: string;
  resolvedAt?: string;
  author?: string;
  nodeId?: string;
  target?: ReviewCommentTarget;
}

export interface CommentMappingResult {
  mapped: ReviewComment[];
  unmapped: ReviewComment[];
  skippedResolved: number;
}

export interface MapCommentsOptions {
  includeResolved: boolean;
}

const nodeIdFromComment = (comment: FigmaComment): string | undefined =>
  comment.client_meta?.node_id;

const authorFromComment = (comment: FigmaComment): string | undefined =>
  comment.user?.handle ?? comment.user?.email ?? comment.user?.id;

const toReviewComment = (
  comment: FigmaComment,
  target?: ReviewCommentTarget
): ReviewComment => {
  const nodeId = nodeIdFromComment(comment);
  return {
    id: comment.id,
    message: comment.message ?? "",
    ...(comment.created_at !== undefined ? { createdAt: comment.created_at } : {}),
    ...(comment.resolved_at ? { resolvedAt: comment.resolved_at } : {}),
    ...(authorFromComment(comment) !== undefined ? { author: authorFromComment(comment) } : {}),
    ...(nodeId !== undefined ? { nodeId } : {}),
    ...(target !== undefined ? { target } : {}),
  };
};

const targetFromEntry = (entry: DesignNodeMapEntry): ReviewCommentTarget => ({
  stepIndex: entry.stepIndex,
  stepKind: entry.stepKind,
  ...(entry.state !== undefined ? { state: entry.state } : {}),
  ...(entry.componentName !== undefined ? { componentName: entry.componentName } : {}),
  ...(entry.dsKey !== undefined ? { dsKey: entry.dsKey } : {}),
  nodeId: entry.nodeId,
  nodeKind: entry.nodeKind,
  ...(entry.nodeName !== undefined ? { nodeName: entry.nodeName } : {}),
});

export const mapCommentsToDesignNodes = (
  comments: FigmaComment[],
  nodeMap: DesignNodeMap | null,
  options: MapCommentsOptions
): CommentMappingResult => {
  const unresolvedComments = comments.filter(
    (comment) => options.includeResolved || !comment.resolved_at
  );
  const skippedResolved = comments.length - unresolvedComments.length;
  const nodeTargets = new Map(
    (nodeMap?.nodes ?? []).map((entry) => [entry.nodeId, targetFromEntry(entry)])
  );
  const mapped = unresolvedComments
    .map((comment) => {
      const nodeId = nodeIdFromComment(comment);
      const target = nodeId ? nodeTargets.get(nodeId) : undefined;
      return target ? toReviewComment(comment, target) : null;
    })
    .filter((comment): comment is ReviewComment => comment !== null);
  const unmapped = unresolvedComments
    .filter((comment) => {
      const nodeId = nodeIdFromComment(comment);
      return nodeId === undefined || !nodeTargets.has(nodeId);
    })
    .map((comment) => toReviewComment(comment));

  return { mapped, unmapped, skippedResolved };
};
