import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { createBuiltInNodeRegistry } from "../../built-in-registry.js";

describe("comment graph nodes", () => {
  it("builds evidence map from seeded REST snapshot and apply metadata", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "Loading state is missing",
              client_meta: { node_id: "1:2" },
            },
          ],
        },
      },
      applyReport: {
        fileKey: "file-1",
        nodes: [
          {
            nodeId: "1:2",
            nodeName: "Members table",
            partId: "members-table",
          },
        ],
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      schemaVersion: "CommentEvidenceMap/v1",
      comments: [expect.objectContaining({ mappingStrategy: "node-id" })],
    });
  });

  it("builds evidence map from a seeded snapshot node map", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "Spacing around the primary action is loose",
              client_meta: { node_id: "primary-action" },
            },
          ],
          nodeMap: {
            nodes: [
              {
                nodeId: "primary-action",
                nodeName: "Primary Action",
                partId: "primary-action",
              },
            ],
          },
        },
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      schemaVersion: "CommentEvidenceMap/v1",
      comments: [expect.objectContaining({ mappingStrategy: "node-id" })],
    });
  });
});

async function runNode(
  key: string,
  patch: Partial<KotikitGraphState>
): Promise<{ statePatch?: Partial<KotikitGraphState> }> {
  const registry = createBuiltInNodeRegistry();
  const node = registry.get(key);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as {
    statePatch?: Partial<KotikitGraphState>;
  };
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-comments",
    flowId: "review-comments",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/project" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}
