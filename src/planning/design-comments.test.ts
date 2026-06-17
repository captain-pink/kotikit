import { describe, it, expect } from "bun:test";
import { mapCommentsToDesignNodes } from "./design-comments.js";
import type { DesignNodeMap } from "./design-node-map.js";
import type { FigmaComment } from "../sync/figma-types.js";

const nodeMap: DesignNodeMap = {
  version: 1,
  scope: "members",
  screen: "list",
  figmaFileKey: "fig-file",
  page: { id: "page-1", name: "Members" },
  updatedAt: "2026-06-17T00:00:00.000Z",
  nodes: [
    {
      stepIndex: 2,
      stepKind: "place-component",
      outcome: "ok",
      state: "default",
      componentName: "Button",
      dsKey: "button-key",
      nodeId: "instance-1",
      nodeKind: "instance",
      nodeName: "Invite member",
    },
  ],
};

const comment = (overrides: Partial<FigmaComment>): FigmaComment => ({
  id: "comment-1",
  file_key: "fig-file",
  message: "Use a destructive style here",
  created_at: "2026-06-17T00:00:00Z",
  user: { id: "user-1", handle: "Reviewer" },
  ...overrides,
});

describe("design comments", () => {
  it("maps comments with client_meta.node_id to design node map entries", () => {
    const result = mapCommentsToDesignNodes(
      [comment({ client_meta: { node_id: "instance-1" } })],
      nodeMap,
      { includeResolved: false }
    );

    expect(result.mapped).toHaveLength(1);
    expect(result.unmapped).toHaveLength(0);
    expect(result.mapped[0]?.target?.componentName).toBe("Button");
    expect(result.mapped[0]?.target?.nodeName).toBe("Invite member");
  });

  it("keeps unmatched comments as unmapped instead of guessing", () => {
    const result = mapCommentsToDesignNodes(
      [comment({ client_meta: { node_id: "unknown-node" } })],
      nodeMap,
      { includeResolved: false }
    );

    expect(result.mapped).toHaveLength(0);
    expect(result.unmapped[0]?.nodeId).toBe("unknown-node");
  });

  it("skips resolved comments unless requested", () => {
    const comments = [
      comment({
        id: "resolved-comment",
        resolved_at: "2026-06-17T01:00:00Z",
        client_meta: { node_id: "instance-1" },
      }),
    ];

    expect(
      mapCommentsToDesignNodes(comments, nodeMap, { includeResolved: false }).mapped
    ).toHaveLength(0);
    expect(
      mapCommentsToDesignNodes(comments, nodeMap, { includeResolved: true }).mapped
    ).toHaveLength(1);
  });
});
