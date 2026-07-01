import type { CommentEvidenceMap } from "../schemas/artifact.js";

type FigmaCommentLike = Record<string, unknown> & {
  id?: unknown;
  message?: unknown;
  parent_id?: unknown;
  order_id?: unknown;
  user?: unknown;
  created_at?: unknown;
  resolved_at?: unknown;
  client_meta?: unknown;
};

type NodeMapLike = {
  fileKey?: unknown;
  nodes?: unknown;
};

type NodeTarget = {
  nodeId: string;
  nodeName?: string;
  partId?: string;
  stateId?: string;
  componentKey?: string;
  draftComponentId?: string;
};

type MappingStrategy = "node-id" | "parent-thread";
type MappingConfidence = "exact" | "high";

export function buildCommentEvidenceMap(input: {
  fileKey: string;
  comments: FigmaCommentLike[];
  nodeMap: NodeMapLike;
  mappedAt: string;
  includeResolved?: boolean;
}): CommentEvidenceMap {
  const nodeTargets = new Map(
    nodeTargetsFrom(input.nodeMap).map((target) => [target.nodeId, target])
  );
  const commentsById = new Map(
    input.comments
      .filter((comment) => typeof comment.id === "string")
      .map((comment) => [String(comment.id), comment])
  );

  const mappedComments = input.comments
    .filter((comment) => input.includeResolved === true || typeof comment.resolved_at !== "string")
    .map((comment) =>
      mapComment({
        comment,
        commentsById,
        nodeTargets,
      })
    );

  return {
    schemaVersion: "CommentEvidenceMap/v1",
    fileKey: input.fileKey,
    mappedAt: input.mappedAt,
    comments: mappedComments,
    unmappedCount: mappedComments.filter((comment) => comment.mappingStrategy === "unmapped")
      .length,
  };
}

function mapComment(input: {
  comment: FigmaCommentLike;
  commentsById: Map<string, FigmaCommentLike>;
  nodeTargets: Map<string, NodeTarget>;
}): CommentEvidenceMap["comments"][number] {
  const commentId = stringField(input.comment, "id") ?? "unknown-comment";
  const directNodeId = nodeIdFromClientMeta(input.comment.client_meta);
  const directTarget = directNodeId === undefined ? undefined : input.nodeTargets.get(directNodeId);
  if (directTarget !== undefined) {
    return commentRecord(input.comment, directTarget, "node-id", "exact");
  }

  const parentId = stringField(input.comment, "parent_id");
  const parentTarget = targetForParent(parentId, input.commentsById, input.nodeTargets);
  if (parentTarget !== undefined) {
    return commentRecord(input.comment, parentTarget, "parent-thread", "high");
  }

  return {
    commentId,
    rootCommentId: parentId ?? commentId,
    ...(parentId !== undefined ? { parentId } : {}),
    message: stringField(input.comment, "message") ?? "",
    ...commentMetadata(input.comment),
    mappingConfidence: "none",
    mappingStrategy: "unmapped",
    intent: "needs-human-clarification",
    status: "needs-human",
  };
}

function targetForParent(
  parentId: string | undefined,
  commentsById: Map<string, FigmaCommentLike>,
  nodeTargets: Map<string, NodeTarget>,
  seen: Set<string> = new Set()
): NodeTarget | undefined {
  if (parentId === undefined || seen.has(parentId)) return undefined;
  const parent = commentsById.get(parentId);
  if (parent === undefined) return undefined;
  const parentNodeId = nodeIdFromClientMeta(parent.client_meta);
  const parentTarget = parentNodeId === undefined ? undefined : nodeTargets.get(parentNodeId);
  if (parentTarget !== undefined) return parentTarget;
  return targetForParent(
    stringField(parent, "parent_id"),
    commentsById,
    nodeTargets,
    new Set([...seen, parentId])
  );
}

function commentRecord(
  comment: FigmaCommentLike,
  target: NodeTarget,
  strategy: MappingStrategy,
  confidence: MappingConfidence
): CommentEvidenceMap["comments"][number] {
  const commentId = stringField(comment, "id") ?? "unknown-comment";
  const parentId = stringField(comment, "parent_id");
  return {
    commentId,
    rootCommentId: parentId ?? commentId,
    ...(parentId !== undefined ? { parentId } : {}),
    message: stringField(comment, "message") ?? "",
    ...commentMetadata(comment),
    mappedTarget: target,
    mappingConfidence: confidence,
    mappingStrategy: strategy,
    intent: classifyIntent(stringField(comment, "message") ?? ""),
    status: stringField(comment, "resolved_at") === undefined ? "actionable" : "resolved",
  };
}

function commentMetadata(
  comment: FigmaCommentLike
): Partial<CommentEvidenceMap["comments"][number]> {
  return {
    ...(numberField(comment, "order_id") !== undefined
      ? { orderId: numberField(comment, "order_id") }
      : {}),
    ...(stringField(comment, "created_at") !== undefined
      ? { createdAt: stringField(comment, "created_at") }
      : {}),
    ...(stringField(comment, "resolved_at") !== undefined
      ? { resolvedAt: stringField(comment, "resolved_at") }
      : {}),
    ...(authorFromComment(comment) !== undefined ? { author: authorFromComment(comment) } : {}),
    ...(normalizedClientMeta(comment.client_meta) !== undefined
      ? { clientMeta: normalizedClientMeta(comment.client_meta) }
      : {}),
  };
}

function nodeTargetsFrom(nodeMap: NodeMapLike): NodeTarget[] {
  return Array.isArray(nodeMap.nodes)
    ? nodeMap.nodes.flatMap((node) => {
        if (typeof node !== "object" || node === null || Array.isArray(node)) return [];
        const record = node as Record<string, unknown>;
        const nodeId = stringField(record, "nodeId");
        if (nodeId === undefined) return [];
        return [
          {
            nodeId,
            ...optionalString(record, "nodeName"),
            ...optionalString(record, "partId"),
            ...optionalString(record, "stateId"),
            ...optionalString(record, "componentKey"),
            ...optionalString(record, "draftComponentId"),
          },
        ];
      })
    : [];
}

function nodeIdFromClientMeta(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? stringField(value as Record<string, unknown>, "node_id")
    : undefined;
}

function normalizedClientMeta(value: unknown): Record<string, unknown> | undefined {
  const clientMeta = recordFrom(value);
  const nodeId = stringField(clientMeta, "node_id");
  const nodeOffset = nodeOffsetFrom(clientMeta.node_offset);
  const normalized = {
    ...(nodeId !== undefined ? { nodeId } : {}),
    ...(nodeOffset !== undefined ? { nodeOffset } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function nodeOffsetFrom(value: unknown): { x: number; y: number } | undefined {
  const offset = recordFrom(value);
  return typeof offset.x === "number" && typeof offset.y === "number"
    ? { x: offset.x, y: offset.y }
    : undefined;
}

function classifyIntent(message: string): CommentEvidenceMap["comments"][number]["intent"] {
  const value = message.toLowerCase();
  if (value.includes("?")) return "question";
  if (value.includes("component") || value.includes("token")) return "design-system-mismatch";
  if (value.includes("copy") || value.includes("text")) return "copy-content";
  if (value.includes("missing") || value.includes("broken") || value.includes("unclear")) {
    return "bug-usability";
  }
  return "visual-polish";
}

function authorFromComment(comment: FigmaCommentLike): string | undefined {
  const user = recordFrom(comment.user);
  return stringField(user, "handle") ?? stringField(user, "email") ?? stringField(user, "id");
}

function optionalString(
  record: Record<string, unknown>,
  key: keyof NodeTarget
): Partial<NodeTarget> {
  const value = stringField(record, key);
  return value === undefined ? {} : { [key]: value };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === "number" ? record[key] : undefined;
}
