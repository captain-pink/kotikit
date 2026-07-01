import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGraphSmokeFixture, fakeCommentSnapshot } from "./fixtures/fake-figma.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-e2e-review-comments-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("review-comments graph flow", () => {
  it("builds comment revision plan, pauses before posting, then pauses before memory promotion", async () => {
    const { artifactStore, runtime } = await createGraphSmokeFixture(root);

    const postingPaused = await runtime.startFlow({
      flowId: "review-comments",
      input: {
        project: { root, name: "Smoke Project" },
        userIntent: "Review open Figma comments for the draft.",
        review: fakeCommentSnapshot(),
      },
    });

    expect(postingPaused.status).toBe("waiting-for-user");
    expect(postingPaused.state.pendingQuestion?.id).toBe("approve-comment-posting");
    await expect(artifactStore.listArtifacts(postingPaused.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "comment-evidence-map",
        }),
      ])
    );
    await expect(
      artifactStore.getArtifact(`${postingPaused.runId}-revision-plan`)
    ).resolves.toMatchObject({
      type: "revision-plan",
      payload: {
        data: {
          revisions: [
            expect.objectContaining({
              nodeId: "primary-action",
              partName: "Primary Action",
            }),
          ],
        },
      },
    });

    const memoryPaused = await runtime.answerRun({
      runId: postingPaused.runId,
      answer: "skip-comment-posting",
    });
    expect(memoryPaused.status).toBe("waiting-for-user");
    expect(memoryPaused.state.pendingQuestion?.id).toBe("approve-memory-promotion");
    expect(memoryPaused.state.review).toMatchObject({
      commentPostingStatus: "skipped",
      memoryCandidate: expect.objectContaining({
        key: expect.stringContaining("spacing"),
      }),
    });

    const completed = await runtime.answerRun({
      runId: postingPaused.runId,
      answer: "skip-memory",
    });
    expect(completed.status).toBe("done");
    expect(completed.state.review).toMatchObject({
      promotedMemory: null,
    });
  });

  it("resumes after comment approval without carrying the raw comment snapshot", async () => {
    const first = await createGraphSmokeFixture(root);

    const postingPaused = await first.runtime.startFlow({
      flowId: "review-comments",
      input: {
        project: { root, name: "Smoke Project" },
        userIntent: "Review open Figma comments for the draft.",
        review: fakeCommentSnapshot(),
      },
    });

    expect(postingPaused.status).toBe("waiting-for-user");
    expect(postingPaused.state.pendingQuestion?.id).toBe("approve-comment-posting");
    expect(reviewRecord(postingPaused.state.review).commentSnapshot).toBeUndefined();
    expect(reviewRecord(postingPaused.state.review).commentSnapshotRef).toBe(
      "comment-evidence-map"
    );

    const second = await createGraphSmokeFixture(root);
    const memoryPaused = await second.runtime.answerRun({
      runId: postingPaused.runId,
      answer: "skip-comment-posting",
    });

    expect(memoryPaused.runId).toBe(postingPaused.runId);
    expect(memoryPaused.status).toBe("waiting-for-user");
    expect(memoryPaused.state.pendingQuestion?.id).toBe("approve-memory-promotion");
    expect(reviewRecord(memoryPaused.state.review).commentSnapshot).toBeUndefined();
    expect(JSON.stringify(memoryPaused.state).length).toBeLessThan(256 * 1024);
  });
});

function reviewRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
