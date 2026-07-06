import { describe, expect, it } from "bun:test";
import type { Artifact } from "../../../schemas/artifact.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { feedbackNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
  interrupt?: { pendingQuestion?: { id: string; prompt: string; choices?: string[] } };
};

describe("feedback graph nodes", () => {
  it("builds a compact comment evidence map from a Figma snapshot and node ledger", async () => {
    const output = await runNode("feedback.buildEvidenceMap", {
      feedback: {
        commentSnapshot: {
          schemaVersion: "FigmaCommentSnapshot/v1",
          fileKey: "FILE",
          comments: [
            {
              id: "comment-1",
              message: "The empty state should replace the table body.",
              client_meta: { node_id: "node-table" },
            },
          ],
        },
      },
      figmaNodeLedger: {
        schemaVersion: "FigmaNodeLedger/v1",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-07-02",
        nodes: [
          {
            nodeId: "node-table",
            name: "Members table",
            kind: "FRAME",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "place-filled",
            partId: "members-table",
            stateId: "filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            componentRefs: ["table-key"],
            componentSource: "existing-component",
            variableRefs: ["color-bg"],
            autoLayout: true,
            recordedAt: "2026-07-02T00:00:00.000Z",
          },
        ],
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      schemaVersion: "CommentEvidenceMap/v1",
      fileKey: "FILE",
    });
    expect(output.statePatch?.commentEvidenceMap?.comments[0]).toMatchObject({
      commentId: "comment-1",
      mappingStrategy: "node-id",
      mappedTarget: {
        nodeId: "node-table",
        nodeName: "Members table",
        partId: "members-table",
        stateId: "filled",
      },
    });
    expect(output.artifacts?.[0]).toMatchObject({
      id: "run-feedback-comment-evidence-map",
      type: "comment-evidence-map",
      schemaVersion: "CommentEvidenceMap/v1",
    });
  });

  it("turns mapped comments and chat feedback into a lightweight revision plan", async () => {
    const output = await runNode("feedback.createRevisionPlan", {
      userIntent: "Also make the selected state clearer.",
      commentEvidenceMap: {
        schemaVersion: "CommentEvidenceMap/v1",
        fileKey: "FILE",
        mappedAt: "2026-07-02T00:00:00.000Z",
        unmappedCount: 0,
        comments: [
          {
            commentId: "comment-1",
            rootCommentId: "comment-1",
            message: "The empty state should replace the table body.",
            mappedTarget: {
              nodeId: "node-table",
              nodeName: "Members table",
              partId: "members-table",
              stateId: "filled",
            },
            mappingConfidence: "exact",
            mappingStrategy: "node-id",
            intent: "needs-human-clarification",
            status: "actionable",
          },
        ],
      },
    });

    expect(output.statePatch?.feedback).toMatchObject({
      revisionPlan: {
        schemaVersion: "RevisionPlan/v1",
        summary: "2 feedback change(s) prepared.",
        data: {
          mode: "lightweight-post-screen-feedback",
          requiresApproval: true,
          unresolvedCount: 1,
          changes: [
            expect.objectContaining({
              id: "comment-comment-1",
              source: "figma-comment",
              targetNodeId: "members-table",
              targetName: "Members table",
              needsHumanDecision: false,
            }),
            expect.objectContaining({
              id: "chat-feedback",
              source: "chat-feedback",
              needsHumanDecision: true,
            }),
          ],
        },
      },
    });
    expect(output.artifacts?.[0]).toMatchObject({
      id: "run-feedback-revision-plan",
      type: "revision-plan",
      schemaVersion: "RevisionPlan/v1",
    });
  });

  it("turns comment threads into one revision change with ordered messages", async () => {
    const output = await runNode("feedback.createRevisionPlan", {
      feedback: {
        commentSnapshot: {
          schemaVersion: "FigmaCommentSnapshot/v1",
          fileKey: "FILE",
          threads: [
            {
              threadId: "comment-root",
              rootCommentId: "comment-root",
              status: "actionable",
              messages: [
                {
                  commentId: "comment-root",
                  message: "Move the empty state inside the table region.",
                },
                {
                  commentId: "comment-reply",
                  parentId: "comment-root",
                  message: "Keep the helper copy concise.",
                  clientMeta: null,
                },
              ],
            },
          ],
        },
      },
      commentEvidenceMap: {
        schemaVersion: "CommentEvidenceMap/v1",
        fileKey: "FILE",
        mappedAt: "2026-07-02T00:00:00.000Z",
        unmappedCount: 0,
        comments: [
          {
            commentId: "comment-root",
            rootCommentId: "comment-root",
            message: "Move the empty state inside the table region.",
            mappedTarget: {
              nodeId: "node-table",
              nodeName: "Members table",
              partId: "members-table",
            },
            mappingConfidence: "exact",
            mappingStrategy: "node-id",
            intent: "needs-human-clarification",
            status: "actionable",
          },
          {
            commentId: "comment-reply",
            rootCommentId: "comment-root",
            parentId: "comment-root",
            message: "Keep the helper copy concise.",
            mappedTarget: {
              nodeId: "node-table",
              nodeName: "Members table",
              partId: "members-table",
            },
            mappingConfidence: "high",
            mappingStrategy: "parent-thread",
            intent: "needs-human-clarification",
            status: "actionable",
          },
        ],
      },
    });

    expect(output.statePatch?.feedback).toMatchObject({
      revisionPlan: {
        schemaVersion: "RevisionPlan/v1",
        summary: "1 feedback change(s) prepared.",
        data: {
          changes: [
            {
              id: "thread-comment-root",
              source: "figma-comment-thread",
              sourceId: "comment-root",
              targetNodeId: "members-table",
              targetName: "Members table",
              recommendation:
                "Move the empty state inside the table region.\nKeep the helper copy concise.",
              needsHumanDecision: false,
            },
          ],
        },
      },
    });
  });

  it("asks the designer before applying prepared revisions", async () => {
    const output = await runNode("feedback.askRevisionApproval", {
      feedback: {
        revisionPlan: {
          schemaVersion: "RevisionPlan/v1",
          data: {
            changes: [
              {
                id: "comment-comment-1",
                source: "figma-comment",
                recommendation: "Fix empty state placement.",
                needsHumanDecision: false,
              },
            ],
          },
        },
      },
    });

    expect(output.interrupt?.pendingQuestion).toMatchObject({
      id: "approve-feedback-revisions",
      choices: ["apply-feedback-changes", "skip-feedback-changes"],
    });
  });

  it("records revision approval answers without extra side effects", async () => {
    const output = await runNode("feedback.askRevisionApproval", {
      answers: {
        "approve-feedback-revisions": "skip-feedback-changes",
      },
      feedback: {
        revisionPlan: {
          schemaVersion: "RevisionPlan/v1",
          data: {
            changes: [
              {
                id: "comment-comment-1",
                source: "figma-comment",
                recommendation: "Fix empty state placement.",
                needsHumanDecision: false,
              },
            ],
          },
        },
      },
    });

    expect(output.statePatch?.feedback).toMatchObject({
      approval: "skip-feedback-changes",
    });
    expect(output.interrupt).toBeUndefined();
  });
});

async function runNode(key: string, patch: Partial<KotikitGraphState>): Promise<NodeOutput> {
  const node = feedbackNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-feedback",
    flowId: "review-screen",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/kotikit" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}
