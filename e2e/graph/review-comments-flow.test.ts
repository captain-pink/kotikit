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
});
