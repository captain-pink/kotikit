import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeReviewEvidence,
  seedLocalDesignSystem,
} from "./fixtures/fake-figma.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-e2e-improve-design-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("improve-existing-design graph flow", () => {
  it("builds a revision plan from bounded evidence and preserves bindings before approval", async () => {
    seedLocalDesignSystem(root, { includeSecondaryAction: true });
    const { artifactStore, runtime } = await createGraphSmokeFixture(root);

    const paused = await runtime.startFlow({
      flowId: "improve-existing-design",
      input: {
        project: { root, name: "Smoke Project" },
        userIntent: "Improve the existing members admin design.",
        review: fakeReviewEvidence(),
      },
    });

    expect(paused.status).toBe("waiting-for-user");
    expect(paused.state.pendingQuestion?.id).toBe("approve-review-revisions");

    const revisionPlan = await artifactStore.getArtifact(`${paused.runId}-revision-plan`);
    expect(revisionPlan).toMatchObject({
      type: "revision-plan",
      payload: {
        data: {
          revisions: expect.arrayContaining([
            expect.objectContaining({
              nodeId: "primary-action",
              componentKey: "button-primary-key",
              variableBindings: [
                {
                  targetId: "primary-action",
                  property: "fill",
                  source: "variable",
                  name: "Color/Primary",
                  id: "var-color-primary",
                },
              ],
            }),
          ]),
        },
      },
    });
  });
});
