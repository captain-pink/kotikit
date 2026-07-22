import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGraphSmokeFixture } from "./fixtures/fake-figma.js";

describe("review-screen graph flow", () => {
  it("maps twelve verified comments and returns distinct apply and skip handoffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-review-screen-"));
    try {
      const { runtime } = await createGraphSmokeFixture(root);
      const snapshot = mockFeedbackSnapshot();

      const started = await runtime.startFlow({
        flowId: "review-screen",
        input: {
          project: { root, name: "Mock Feedback Project" },
          feedback: snapshot,
        },
      });

      expect(started.status).toBe("waiting-for-user");
      expect(started.state.pendingQuestion).toMatchObject({
        id: "approve-feedback-revisions",
        choices: ["apply-feedback-changes", "skip-feedback-changes"],
      });
      expect(started.state.commentEvidenceMap).toMatchObject({
        unmappedCount: 0,
      });
      expect(started.state.commentEvidenceMap?.comments).toHaveLength(12);
      expect(
        started.state.commentEvidenceMap?.comments.every(
          (comment) => comment.mappingStrategy === "frame-offset" && comment.status === "actionable"
        )
      ).toBe(true);
      const revisionPlan = recordFrom(recordFrom(started.state.feedback).revisionPlan);
      const planData = recordFrom(revisionPlan.data);
      expect(planData.unresolvedCount).toBe(0);
      expect(recordArray(planData.changes)).toHaveLength(12);

      const invalidApproval = await runtime.answerRun({
        runId: started.runId,
        answer: "yes",
      });
      expect(invalidApproval.status).toBe("waiting-for-user");
      expect(recordFrom(recordFrom(invalidApproval.state.feedback).handoff)).toEqual({});

      const approved = await runtime.answerRun({
        runId: started.runId,
        answer: "apply-feedback-changes",
      });
      expect(approved.status).toBe("done");
      expect(recordFrom(recordFrom(approved.state.feedback).handoff)).toEqual({
        status: "approved-for-agent-apply",
        revisionPlanArtifactId: `${started.runId}-revision-plan`,
        changeIds: expectedChangeIds(),
      });

      const startedForSkip = await runtime.startFlow({
        flowId: "review-screen",
        input: {
          project: { root, name: "Mock Feedback Project" },
          feedback: snapshot,
        },
      });
      const skipped = await runtime.answerRun({
        runId: startedForSkip.runId,
        answer: "skip-feedback-changes",
      });
      expect(skipped.status).toBe("done");
      expect(recordFrom(recordFrom(skipped.state.feedback).handoff)).toEqual({
        status: "skipped",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function mockFeedbackSnapshot(): Record<string, unknown> {
  const rootBounds = { x: 100, y: 200, width: 1_200, height: 900 };
  const targets = Array.from({ length: 12 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
      nodeId: `child:${index + 1}`,
      nodeName: `Mock feedback target ${index + 1}`,
      parentNodeId: "frame:1",
      bounds: {
        x: rootBounds.x + 40 + column * 360,
        y: rootBounds.y + 40 + row * 190,
        width: 300,
        height: 140,
      },
    };
  });
  const comments = targets.map((target, index) => ({
    id: `comment-${index + 1}`,
    message: `Adjust mocked target ${index + 1}.`,
    client_meta: {
      node_id: "frame:1",
      node_offset: {
        x: target.bounds.x - rootBounds.x + 20,
        y: target.bounds.y - rootBounds.y + 20,
      },
    },
  }));

  return {
    schemaVersion: "FigmaCommentSnapshot/v1",
    fileKey: "FILE_MOCK_FEEDBACK",
    fetchedAt: "2026-07-22T00:00:00.000Z",
    includeResolved: false,
    comments,
    threads: comments.map((comment) => ({
      threadId: comment.id,
      rootCommentId: comment.id,
      status: "actionable",
      messages: [
        {
          commentId: comment.id,
          message: comment.message,
        },
      ],
    })),
    nodeMap: {
      fileKey: "FILE_MOCK_FEEDBACK",
      nodes: [
        {
          nodeId: "frame:1",
          nodeName: "Mock feedback frame",
          bounds: rootBounds,
        },
        ...targets,
      ],
    },
  };
}

function expectedChangeIds(): string[] {
  return Array.from({ length: 12 }, (_, index) => `thread-comment-${index + 1}`);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}
