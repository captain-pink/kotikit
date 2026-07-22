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

  it("maps comments from the verified node map carried by the snapshot", async () => {
    const output = await runNode("feedback.buildEvidenceMap", {
      feedback: {
        schemaVersion: "FigmaCommentSnapshot/v1",
        fileKey: "FILE",
        comments: [
          {
            id: "comment-verified",
            message: "Adjust this mocked field.",
            client_meta: { node_id: "frame:1", node_offset: { x: 75, y: 55 } },
          },
        ],
        nodeMap: {
          fileKey: "FILE",
          nodes: [
            {
              nodeId: "frame:1",
              nodeName: "Mock settings",
              bounds: { x: 100, y: 200, width: 600, height: 400 },
            },
            {
              nodeId: "child:1",
              nodeName: "Mock field",
              parentNodeId: "frame:1",
              bounds: { x: 160, y: 240, width: 100, height: 50 },
            },
          ],
        },
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      fileKey: "FILE",
      unmappedCount: 0,
      comments: [
        expect.objectContaining({
          commentId: "comment-verified",
          mappingStrategy: "frame-offset",
          mappedTarget: {
            nodeId: "child:1",
            nodeName: "Mock field",
            bounds: { x: 160, y: 240, width: 100, height: 50 },
          },
        }),
      ],
    });
    expect(recordFrom(output.statePatch?.feedback).commentSnapshot).toMatchObject({
      schemaVersion: "FigmaCommentSnapshot/v1",
      fileKey: "FILE",
    });
    expect(recordFrom(output.statePatch?.feedback)).not.toHaveProperty("comments");
    expect(recordFrom(output.statePatch?.feedback)).not.toHaveProperty("nodeMap");
  });

  it("keeps snapshot identity and geometry authoritative over stale fallback targets", async () => {
    const output = await runNode("feedback.buildEvidenceMap", {
      feedback: {
        commentSnapshot: {
          schemaVersion: "FigmaCommentSnapshot/v1",
          fileKey: "FILE",
          comments: [
            {
              id: "comment-live",
              message: "Adjust the verified mock field.",
              client_meta: { node_id: "frame:1", node_offset: { x: 75, y: 55 } },
            },
            {
              id: "comment-deleted",
              message: "Review a deleted mock layer.",
              client_meta: { node_id: "missing:1" },
            },
          ],
          nodeMap: {
            fileKey: "FILE",
            nodes: [
              {
                nodeId: "frame:1",
                nodeName: "Live mock settings",
                bounds: { x: 100, y: 200, width: 600, height: 400 },
              },
              {
                nodeId: "child:1",
                nodeName: "Live mock field",
                parentNodeId: "frame:1",
                bounds: { x: 160, y: 240, width: 100, height: 50 },
              },
            ],
          },
        },
        nodes: [
          {
            nodeId: "frame:1",
            nodeName: "Stale mock settings",
            bounds: { x: 0, y: 0, width: 600, height: 400 },
          },
          {
            nodeId: "child:1",
            nodeName: "Stale mock field",
            partId: "mock-field",
            parentNodeId: "frame:1",
            bounds: { x: 60, y: 40, width: 100, height: 50 },
          },
          {
            nodeId: "missing:1",
            nodeName: "Deleted mock layer",
          },
        ],
      },
    });

    expect(output.statePatch?.commentEvidenceMap?.comments[0]).toMatchObject({
      commentId: "comment-live",
      mappingStrategy: "frame-offset",
      mappedTarget: {
        nodeId: "child:1",
        nodeName: "Live mock field",
        partId: "mock-field",
        bounds: { x: 160, y: 240, width: 100, height: 50 },
      },
    });
    expect(output.statePatch?.commentEvidenceMap?.comments[1]).toMatchObject({
      commentId: "comment-deleted",
      mappingStrategy: "unmapped",
      mappingConfidence: "none",
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
    expect(output.interrupt?.pendingQuestion?.prompt).toContain("assistant");
    expect(output.interrupt?.pendingQuestion?.prompt).toContain("Figma");
  });

  it("hands an approved revision plan back to the assistant in change order", async () => {
    const output = await runNode("feedback.askRevisionApproval", {
      answers: {
        "approve-feedback-revisions": "apply-feedback-changes",
      },
      feedback: {
        revisionPlanArtifactId: "run-feedback-revision-plan",
        revisionPlan: {
          schemaVersion: "RevisionPlan/v1",
          data: {
            changes: [
              {
                id: "thread-comment-1",
                source: "figma-comment-thread",
                recommendation: "Fix mocked empty state placement.",
                needsHumanDecision: false,
              },
              {
                id: "thread-comment-2",
                source: "figma-comment-thread",
                recommendation: "Adjust mocked helper copy.",
                needsHumanDecision: false,
              },
            ],
          },
        },
      },
    });

    expect(output.statePatch?.feedback).toMatchObject({
      approval: "apply-feedback-changes",
      handoff: {
        status: "approved-for-agent-apply",
        revisionPlanArtifactId: "run-feedback-revision-plan",
        changeIds: ["thread-comment-1", "thread-comment-2"],
      },
    });
    expect(output.interrupt).toBeUndefined();
  });

  it("records a skipped revision plan without queuing apply work", async () => {
    const output = await runNode("feedback.askRevisionApproval", {
      answers: {
        "approve-feedback-revisions": "skip-feedback-changes",
      },
      feedback: {
        revisionPlanArtifactId: "run-feedback-revision-plan",
        revisionPlan: {
          schemaVersion: "RevisionPlan/v1",
          data: {
            changes: [
              {
                id: "thread-comment-1",
                source: "figma-comment-thread",
                recommendation: "Fix mocked empty state placement.",
                needsHumanDecision: false,
              },
            ],
          },
        },
      },
    });

    expect(output.statePatch?.feedback).toMatchObject({
      approval: "skip-feedback-changes",
      handoff: { status: "skipped" },
    });
    expect(recordFrom(output.statePatch?.feedback).handoff).not.toHaveProperty("changeIds");
    expect(output.interrupt).toBeUndefined();
  });

  it("asks again when the approval answer is not one of the advertised choices", async () => {
    const output = await runNode("feedback.askRevisionApproval", {
      answers: {
        "approve-feedback-revisions": "yes",
      },
      feedback: {
        revisionPlanArtifactId: "run-feedback-revision-plan",
        revisionPlan: {
          schemaVersion: "RevisionPlan/v1",
          data: {
            changes: [
              {
                id: "thread-comment-1",
                source: "figma-comment-thread",
                recommendation: "Fix mocked empty state placement.",
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
    expect(output.statePatch?.feedback).toBeUndefined();
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

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
