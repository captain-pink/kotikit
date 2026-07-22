import type { CommentEvidenceMap } from "../schemas/artifact.js";
import { type Bounds, BoundsSchema } from "../schemas/artifact.js";

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
  parentNodeId?: string;
  partId?: string;
  stateId?: string;
  componentKey?: string;
  draftComponentId?: string;
  bounds?: Bounds;
};

type MappingStrategy = "node-id" | "parent-thread" | "frame-offset";
type MappingConfidence = "exact" | "high";

type TargetResolution = {
  target: NodeTarget;
  strategy: Exclude<MappingStrategy, "parent-thread">;
  confidence: MappingConfidence;
};

const COMMENT_INTENTS = new Set<CommentEvidenceMap["comments"][number]["intent"]>([
  "question",
  "bug-usability",
  "visual-polish",
  "copy-content",
  "design-system-mismatch",
  "implementation-handoff",
  "preference",
  "out-of-scope",
  "needs-human-clarification",
]);

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
  const directResolution = targetForCommentAnchor(input.comment, input.nodeTargets);
  if (directResolution !== undefined) {
    return commentRecord(
      input.comment,
      directResolution.target,
      directResolution.strategy,
      directResolution.confidence
    );
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
    intent: intentFromComment(input.comment),
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
  const parentResolution = targetForCommentAnchor(parent, nodeTargets);
  if (parentResolution !== undefined) return parentResolution.target;
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
    mappedTarget: evidenceTargetFrom(target),
    mappingConfidence: confidence,
    mappingStrategy: strategy,
    intent: intentFromComment(comment),
    status: stringField(comment, "resolved_at") === undefined ? "actionable" : "resolved",
  };
}

// Resolves a verified anchor and narrows frame-relative offsets to direct children.
function targetForCommentAnchor(
  comment: FigmaCommentLike,
  nodeTargets: Map<string, NodeTarget>
): TargetResolution | undefined {
  const directNodeId = nodeIdFromClientMeta(comment.client_meta);
  const rootTarget = directNodeId === undefined ? undefined : nodeTargets.get(directNodeId);
  if (rootTarget === undefined) return undefined;

  const nodeOffset = nodeOffsetFrom(recordFrom(comment.client_meta).node_offset);
  const childTarget =
    rootTarget.bounds === undefined || nodeOffset === undefined
      ? undefined
      : smallestContainingChild({
          rootTarget,
          rootBounds: rootTarget.bounds,
          nodeOffset,
          nodeTargets: [...nodeTargets.values()],
        });

  return childTarget === undefined
    ? { target: rootTarget, strategy: "node-id", confidence: "exact" }
    : { target: childTarget, strategy: "frame-offset", confidence: "high" };
}

// Chooses the most specific verified child at the comment's absolute page point.
function smallestContainingChild(input: {
  rootTarget: NodeTarget;
  rootBounds: Bounds;
  nodeOffset: { x: number; y: number };
  nodeTargets: NodeTarget[];
}): NodeTarget | undefined {
  const point = {
    x: input.rootBounds.x + input.nodeOffset.x,
    y: input.rootBounds.y + input.nodeOffset.y,
  };
  return input.nodeTargets
    .filter(
      (target): target is NodeTarget & { bounds: Bounds } =>
        target.parentNodeId === input.rootTarget.nodeId &&
        target.bounds !== undefined &&
        containsPoint(target.bounds, point)
    )
    .sort(
      (left, right) =>
        left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height
    )[0];
}

function containsPoint(bounds: Bounds, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function evidenceTargetFrom(
  target: NodeTarget
): NonNullable<CommentEvidenceMap["comments"][number]["mappedTarget"]> {
  return {
    nodeId: target.nodeId,
    ...(target.nodeName === undefined ? {} : { nodeName: target.nodeName }),
    ...(target.partId === undefined ? {} : { partId: target.partId }),
    ...(target.stateId === undefined ? {} : { stateId: target.stateId }),
    ...(target.componentKey === undefined ? {} : { componentKey: target.componentKey }),
    ...(target.draftComponentId === undefined ? {} : { draftComponentId: target.draftComponentId }),
    ...(target.bounds === undefined ? {} : { bounds: target.bounds }),
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
        const nodeId = stringField(record, "nodeId") ?? stringField(record, "id");
        if (nodeId === undefined) return [];
        return [
          {
            nodeId,
            ...optionalString(record, "name", "nodeName"),
            ...optionalString(record, "nodeName"),
            ...optionalString(record, "parentNodeId"),
            ...optionalString(record, "partId"),
            ...optionalString(record, "stateId"),
            ...optionalString(record, "componentKey"),
            ...optionalString(record, "draftComponentId"),
            ...(boundsFrom(record.bounds) === undefined
              ? {}
              : { bounds: boundsFrom(record.bounds) }),
          },
        ];
      })
    : [];
}

function boundsFrom(value: unknown): Bounds | undefined {
  const parsed = BoundsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
  return typeof offset.x === "number" &&
    Number.isFinite(offset.x) &&
    typeof offset.y === "number" &&
    Number.isFinite(offset.y)
    ? { x: offset.x, y: offset.y }
    : undefined;
}

function intentFromComment(
  comment: FigmaCommentLike
): CommentEvidenceMap["comments"][number]["intent"] {
  const explicitIntent = stringField(comment, "intent");
  return explicitIntent !== undefined &&
    COMMENT_INTENTS.has(explicitIntent as CommentEvidenceMap["comments"][number]["intent"])
    ? (explicitIntent as CommentEvidenceMap["comments"][number]["intent"])
    : "needs-human-clarification";
}

function authorFromComment(comment: FigmaCommentLike): string | undefined {
  const user = recordFrom(comment.user);
  return stringField(user, "handle") ?? stringField(user, "email") ?? stringField(user, "id");
}

function optionalString(
  record: Record<string, unknown>,
  key: keyof NodeTarget | "name",
  outputKey: keyof NodeTarget = key as keyof NodeTarget
): Partial<NodeTarget> {
  const value = stringField(record, key);
  return value === undefined ? {} : { [outputKey]: value };
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
  const value = record[key];
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
