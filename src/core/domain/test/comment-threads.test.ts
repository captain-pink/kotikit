import { describe, expect, it } from "bun:test";
import { compactFigmaComment, normalizeCommentThreads } from "../comment-threads.js";

describe("comment threads", () => {
  it("groups replies under the root comment and inherits the root anchor", () => {
    const comments = [
      compactFigmaComment({
        id: "root",
        file_key: "FILE",
        message: "Review this settings region.",
        created_at: "2026-07-02T00:00:00.000Z",
        order_id: "7",
        client_meta: { node_id: "node-settings", node_offset: { x: 8, y: 12 } },
        user: { handle: "Designer", email: "designer@example.com" },
      }),
      compactFigmaComment({
        id: "reply",
        file_key: "FILE",
        parent_id: "root",
        message: "Agree, keep the supporting copy shorter.",
        created_at: "2026-07-02T00:05:00.000Z",
        client_meta: null,
      }),
    ];

    expect(normalizeCommentThreads(comments)).toEqual([
      {
        threadId: "root",
        rootCommentId: "root",
        orderId: "7",
        anchorClientMeta: {
          nodeId: "node-settings",
          nodeOffset: { x: 8, y: 12 },
        },
        status: "actionable",
        messages: [
          {
            commentId: "root",
            message: "Review this settings region.",
            author: "Designer",
            createdAt: "2026-07-02T00:00:00.000Z",
            clientMeta: {
              nodeId: "node-settings",
              nodeOffset: { x: 8, y: 12 },
            },
          },
          {
            commentId: "reply",
            parentId: "root",
            message: "Agree, keep the supporting copy shorter.",
            createdAt: "2026-07-02T00:05:00.000Z",
            clientMeta: null,
          },
        ],
      },
    ]);
  });

  it("keeps orphan replies as explicit threads instead of crashing", () => {
    const comments = [
      compactFigmaComment({
        id: "reply",
        file_key: "FILE",
        parent_id: "missing-root",
        message: "Can we also tighten this copy?",
        client_meta: null,
      }),
    ];

    expect(normalizeCommentThreads(comments)).toEqual([
      {
        threadId: "missing-root",
        rootCommentId: "missing-root",
        status: "needs-human",
        messages: [
          {
            commentId: "reply",
            parentId: "missing-root",
            message: "Can we also tighten this copy?",
            clientMeta: null,
          },
        ],
      },
    ]);
  });
});
