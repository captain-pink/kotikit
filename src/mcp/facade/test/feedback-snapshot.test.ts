import { describe, expect, it } from "bun:test";
import { commentAnchorNodeIds, compactCommentNodeMap } from "../feedback-snapshot.js";

describe("feedback snapshot targets", () => {
  it("collects unique positioned comment node ids in first-seen order", () => {
    expect(
      commentAnchorNodeIds([
        { id: "comment-1", client_meta: { node_id: "frame:1" } },
        { id: "comment-1-reply", parent_id: "comment-1", client_meta: null },
        { id: "comment-2", client_meta: { node_id: "frame:1" } },
        { id: "comment-3", client_meta: { node_id: "frame:2" } },
        { id: "comment-4", client_meta: { node_id: "" } },
      ])
    ).toEqual(["frame:1", "frame:2"]);
  });

  it("compacts verified roots and their direct children", () => {
    expect(
      compactCommentNodeMap({
        "frame:1": {
          document: {
            id: "frame:1",
            name: "Mock settings",
            type: "FRAME",
            absoluteBoundingBox: { x: 100, y: 200, width: 600, height: 400 },
            children: [
              {
                id: "child:1",
                name: "Mock field",
                type: "INSTANCE",
                absoluteBoundingBox: { x: 120, y: 240, width: 200, height: 80 },
                children: [{ id: "grandchild:1", name: "Ignored depth" }],
              },
              {
                id: "child:2",
                name: "Mock helper",
                type: "TEXT",
                absoluteBoundingBox: { x: 120, y: 330, width: 300, height: 24 },
              },
            ],
          },
        },
        "frame:2": {
          document: {
            name: "Mock fallback id",
            type: "FRAME",
          },
        },
        "missing:1": {},
      })
    ).toEqual({
      nodes: [
        {
          nodeId: "frame:1",
          nodeName: "Mock settings",
          kind: "FRAME",
          bounds: { x: 100, y: 200, width: 600, height: 400 },
        },
        {
          nodeId: "child:1",
          nodeName: "Mock field",
          kind: "INSTANCE",
          parentNodeId: "frame:1",
          bounds: { x: 120, y: 240, width: 200, height: 80 },
        },
        {
          nodeId: "child:2",
          nodeName: "Mock helper",
          kind: "TEXT",
          parentNodeId: "frame:1",
          bounds: { x: 120, y: 330, width: 300, height: 24 },
        },
        {
          nodeId: "frame:2",
          nodeName: "Mock fallback id",
          kind: "FRAME",
        },
      ],
    });
  });
});
