type NormalizedClientMeta = {
  nodeId?: string;
  nodeOffset?: { x: number; y: number };
};

type ThreadStatus = "actionable" | "needs-human" | "resolved";

export type CompactFigmaComment = Record<string, unknown>;

export type CommentThreadMessage = {
  commentId: string;
  parentId?: string;
  message: string;
  author?: string;
  createdAt?: string;
  resolvedAt?: string;
  clientMeta?: NormalizedClientMeta | null;
};

export type CommentThread = {
  threadId: string;
  rootCommentId: string;
  orderId?: number | string;
  anchorClientMeta?: NormalizedClientMeta;
  status: ThreadStatus;
  messages: CommentThreadMessage[];
};

type IndexedComment = {
  index: number;
  id: string;
  comment: CompactFigmaComment;
};

/**
 * Keeps only the Figma comment fields kotikit needs for feedback review.
 * Replies may legitimately have `client_meta: null`, which is preserved.
 */
export function compactFigmaComment(comment: Record<string, unknown>): CompactFigmaComment {
  const user = recordFrom(comment.user);
  const clientMeta = clientMetaForSnapshot(comment.client_meta);
  return {
    ...(stringField(comment, "id") !== undefined ? { id: stringField(comment, "id") } : {}),
    ...(stringField(comment, "file_key") !== undefined
      ? { file_key: stringField(comment, "file_key") }
      : {}),
    ...(stringField(comment, "parent_id") !== undefined
      ? { parent_id: stringField(comment, "parent_id") }
      : {}),
    ...(stringField(comment, "message") !== undefined
      ? { message: stringField(comment, "message") }
      : {}),
    ...(stringField(comment, "created_at") !== undefined
      ? { created_at: stringField(comment, "created_at") }
      : {}),
    ...(stringField(comment, "resolved_at") !== undefined
      ? { resolved_at: stringField(comment, "resolved_at") }
      : {}),
    ...(orderIdFrom(comment) !== undefined ? { order_id: orderIdFrom(comment) } : {}),
    ...(Object.keys(user).length === 0
      ? {}
      : {
          user: {
            ...(stringField(user, "id") !== undefined ? { id: stringField(user, "id") } : {}),
            ...(stringField(user, "handle") !== undefined
              ? { handle: stringField(user, "handle") }
              : {}),
          },
        }),
    ...(clientMeta === undefined ? {} : { client_meta: clientMeta }),
  };
}

/**
 * Groups flat Figma comments into review threads using parent links.
 * Missing parents degrade to unanchored threads instead of blocking feedback.
 */
export function normalizeCommentThreads(comments: CompactFigmaComment[]): CommentThread[] {
  const indexedComments = comments.map((comment, index) => ({
    index,
    id: stringField(comment, "id") ?? `comment-${index + 1}`,
    comment,
  }));
  const commentsById = new Map(indexedComments.map((entry) => [entry.id, entry]));
  const groups = indexedComments.reduce<Map<string, IndexedComment[]>>((acc, entry) => {
    const threadId = rootIdFor(entry, commentsById);
    acc.set(threadId, [...(acc.get(threadId) ?? []), entry]);
    return acc;
  }, new Map());

  return [...groups.entries()].map(([threadId, entries]) => {
    const sortedEntries = [...entries].sort((a, b) => a.index - b.index);
    const root = commentsById.get(threadId);
    const messages = sortedEntries.map((entry) => messageFrom(entry));
    const anchorClientMeta = anchorForThread(root, sortedEntries);
    return {
      threadId,
      rootCommentId: threadId,
      ...(orderIdFrom(root?.comment ?? {}) !== undefined
        ? { orderId: orderIdFrom(root?.comment ?? {}) }
        : {}),
      ...(anchorClientMeta === undefined ? {} : { anchorClientMeta }),
      status: statusForThread(sortedEntries, anchorClientMeta),
      messages,
    };
  });
}

// Walks parent links to find the thread root and stops safely on malformed cycles.
function rootIdFor(
  entry: IndexedComment,
  commentsById: Map<string, IndexedComment>,
  seen: Set<string> = new Set()
): string {
  if (seen.has(entry.id)) return entry.id;
  const parentId = stringField(entry.comment, "parent_id");
  if (parentId === undefined) return entry.id;
  const parent = commentsById.get(parentId);
  if (parent === undefined) return parentId;
  return rootIdFor(parent, commentsById, new Set([...seen, entry.id]));
}

// Converts a compact Figma comment into the smaller thread message shape.
function messageFrom(entry: IndexedComment): CommentThreadMessage {
  const clientMeta = normalizedClientMeta(entry.comment.client_meta);
  return {
    commentId: entry.id,
    ...(stringField(entry.comment, "parent_id") !== undefined
      ? { parentId: stringField(entry.comment, "parent_id") }
      : {}),
    message: stringField(entry.comment, "message") ?? "",
    ...(authorFromComment(entry.comment) !== undefined
      ? { author: authorFromComment(entry.comment) }
      : {}),
    ...(stringField(entry.comment, "created_at") !== undefined
      ? { createdAt: stringField(entry.comment, "created_at") }
      : {}),
    ...(stringField(entry.comment, "resolved_at") !== undefined
      ? { resolvedAt: stringField(entry.comment, "resolved_at") }
      : {}),
    ...(entry.comment.client_meta === null
      ? { clientMeta: null }
      : clientMeta === undefined
        ? {}
        : { clientMeta }),
  };
}

// Finds the first usable anchor from the root or any positioned message.
function anchorForThread(
  root: IndexedComment | undefined,
  entries: IndexedComment[]
): NormalizedClientMeta | undefined {
  const candidates = root === undefined ? entries : [root, ...entries];
  return candidates
    .map((entry) => normalizedClientMeta(entry.comment.client_meta))
    .find((clientMeta) => clientMeta !== undefined);
}

// Keeps thread status deterministic without inferring design intent from copy.
function statusForThread(
  entries: IndexedComment[],
  anchorClientMeta: NormalizedClientMeta | undefined
): ThreadStatus {
  if (entries.length > 0 && entries.every((entry) => stringField(entry.comment, "resolved_at"))) {
    return "resolved";
  }
  return anchorClientMeta === undefined ? "needs-human" : "actionable";
}

function clientMetaForSnapshot(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  const clientMeta = recordFrom(value);
  if (Object.keys(clientMeta).length === 0) return undefined;
  return {
    ...(stringField(clientMeta, "node_id") !== undefined
      ? { node_id: stringField(clientMeta, "node_id") }
      : {}),
    ...(nodeOffsetFrom(clientMeta.node_offset) === undefined
      ? {}
      : { node_offset: nodeOffsetFrom(clientMeta.node_offset) }),
  };
}

function normalizedClientMeta(value: unknown): NormalizedClientMeta | undefined {
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

function authorFromComment(comment: CompactFigmaComment): string | undefined {
  const user = recordFrom(comment.user);
  return stringField(user, "handle") ?? stringField(user, "id");
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function orderIdFrom(record: Record<string, unknown>): number | string | undefined {
  return numberField(record, "order_id") ?? stringField(record, "order_id");
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
