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

  it("maps comments by client_meta node id without guessing intent from copy", () => {
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
      mappedTarget: { nodeId: "1:2", nodeName: "Members table", partId: "members-table" },
      intent: "needs-human-clarification",
      status: "actionable",
    });
  });

  it("preserves explicit comment intent when the caller provides one", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-1",
          message: "This does not match our table pattern.",
          intent: "design-system-mismatch",
          client_meta: { node_id: "1:2" },
        },
      ],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]?.intent).toBe("design-system-mismatch");
  });

  it("normalizes client metadata without copying raw payload fields", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-1",
          message: "Table loading state is missing",
          client_meta: {
            node_id: "1:2",
            node_offset: { x: 8, y: 12 },
            ignoredLargePayload: "x".repeat(1_000),
          },
        },
      ],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]?.clientMeta).toEqual({
      nodeId: "1:2",
      nodeOffset: { x: 8, y: 12 },
    });
  });

  it("maps a frame offset to the smallest verified direct child containing it", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-offset",
          message: "Adjust this mocked field.",
          client_meta: { node_id: "frame:1", node_offset: { x: 75, y: 55 } },
        },
      ],
      nodeMap: offsetNodeMap(),
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]).toMatchObject({
      mappingStrategy: "frame-offset",
      mappingConfidence: "high",
      mappedTarget: { nodeId: "child:small", nodeName: "Mock field" },
    });
    expect(map.comments[0]?.mappedTarget).not.toHaveProperty("parentNodeId");
  });

  it("falls back to the verified root when no direct child contains the offset", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-root",
          message: "Review the mocked frame edge.",
          client_meta: { node_id: "frame:1", node_offset: { x: 550, y: 350 } },
        },
      ],
      nodeMap: offsetNodeMap(),
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]).toMatchObject({
      mappingStrategy: "node-id",
      mappingConfidence: "exact",
      mappedTarget: { nodeId: "frame:1", nodeName: "Mock settings" },
    });
  });

  it("keeps a stale anchored node id unmapped", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-stale",
          message: "Review the deleted mock layer.",
          client_meta: { node_id: "missing:1", node_offset: { x: 10, y: 10 } },
        },
      ],
      nodeMap: offsetNodeMap(),
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]).toMatchObject({
      mappingStrategy: "unmapped",
      mappingConfidence: "none",
      status: "needs-human",
    });
  });

  it("inherits an offset-resolved child target for thread replies", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "root-offset",
          message: "Review the mocked field.",
          client_meta: { node_id: "frame:1", node_offset: { x: 75, y: 55 } },
        },
        {
          id: "reply-offset",
          parent_id: "root-offset",
          message: "Keep its helper concise.",
          client_meta: null,
        },
      ],
      nodeMap: offsetNodeMap(),
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments.find((comment) => comment.commentId === "reply-offset")).toMatchObject({
      mappingStrategy: "parent-thread",
      mappingConfidence: "high",
      mappedTarget: { nodeId: "child:small", nodeName: "Mock field" },
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

  it("skips resolved comments unless requested", () => {
    const resolvedComment = {
      id: "resolved-comment",
      message: "Already handled",
      client_meta: { node_id: "1:2" },
      resolved_at: "2026-07-01T01:00:00.000Z",
    };

    expect(
      buildCommentEvidenceMap({
        fileKey: "file-1",
        comments: [resolvedComment],
        nodeMap,
        mappedAt: "2026-07-01T00:00:00.000Z",
      }).comments
    ).toHaveLength(0);
    expect(
      buildCommentEvidenceMap({
        fileKey: "file-1",
        comments: [resolvedComment],
        nodeMap,
        mappedAt: "2026-07-01T00:00:00.000Z",
        includeResolved: true,
      }).comments
    ).toHaveLength(1);
  });
});

function offsetNodeMap() {
  return {
    fileKey: "file-1",
    nodes: [
      {
        nodeId: "frame:1",
        nodeName: "Mock settings",
        bounds: { x: 100, y: 200, width: 600, height: 400 },
      },
      {
        nodeId: "child:large",
        nodeName: "Mock form region",
        parentNodeId: "frame:1",
        bounds: { x: 120, y: 230, width: 300, height: 200 },
      },
      {
        nodeId: "child:small",
        nodeName: "Mock field",
        parentNodeId: "frame:1",
        bounds: { x: 160, y: 240, width: 100, height: 50 },
      },
    ],
  };
}
