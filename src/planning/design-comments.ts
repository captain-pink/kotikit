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

const toReviewComment = (comment: FigmaComment, target?: ReviewCommentTarget): ReviewComment => {
  const nodeId = nodeIdFromComment(comment) ?? target?.nodeId;
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

  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const targetCache = new Map<string, ReviewCommentTarget | null>();
  const targetForComment = (
    comment: FigmaComment,
    seen: Set<string> = new Set()
  ): ReviewCommentTarget | undefined => {
    const cached = targetCache.get(comment.id);
    if (cached !== undefined) return cached ?? undefined;
    if (seen.has(comment.id)) return undefined;

    const directNodeId = nodeIdFromComment(comment);
    const directTarget = directNodeId ? nodeTargets.get(directNodeId) : undefined;
    if (directTarget !== undefined) {
      targetCache.set(comment.id, directTarget);
      return directTarget;
    }

    const parent = comment.parent_id ? commentById.get(comment.parent_id) : undefined;
    const inheritedTarget = parent
      ? targetForComment(parent, new Set([...seen, comment.id]))
      : undefined;
    targetCache.set(comment.id, inheritedTarget ?? null);
    return inheritedTarget;
  };

  const mapped = unresolvedComments
    .map((comment) => {
      const target = targetForComment(comment);
      return target ? toReviewComment(comment, target) : null;
    })
    .filter((comment): comment is ReviewComment => comment !== null);
  const unmapped = unresolvedComments
    .filter((comment) => targetForComment(comment) === undefined)
    .map((comment) => toReviewComment(comment));

  return { mapped, unmapped, skippedResolved };
};
