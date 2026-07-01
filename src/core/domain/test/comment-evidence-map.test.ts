import { describe, expect, it } from "bun:test";
import { buildCommentEvidenceMap } from "../comment-evidence-map.js";

describe("comment evidence map", () => {
  const nodeMap = {
    fileKey: "file-1",
    nodes: [
      {
        nodeId: "1:2",
        nodeName: "Members table",
        partId: "members-table",
        componentKey: "table-key",
      },
    ],
  };

  it("maps comments by client_meta node id", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-1",
          message: "Table loading state is missing",
          client_meta: { node_id: "1:2" },
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]).toMatchObject({
      commentId: "comment-1",
      mappingStrategy: "node-id",
      mappingConfidence: "exact",
      mappedTarget: { nodeId: "1:2", partId: "members-table" },
      intent: "bug-usability",
    });
  });

  it("inherits target from parent comment replies", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "root",
          message: "Review this table",
          client_meta: { node_id: "1:2" },
        },
        {
          id: "reply",
          parent_id: "root",
          message: "Agree",
        },
      ],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments.find((comment) => comment.commentId === "reply")).toMatchObject({
      mappingStrategy: "parent-thread",
      mappedTarget: { nodeId: "1:2" },
    });
  });

  it("keeps unmapped comments explicit", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [{ id: "comment-2", message: "What about the states?" }],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map).toMatchObject({
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
