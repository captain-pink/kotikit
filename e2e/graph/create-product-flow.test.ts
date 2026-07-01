import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeDraftTarget,
  seedLocalDesignSystem,
} from "./fixtures/fake-figma.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-e2e-product-flow-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("create-product-flow graph flow", () => {
  it("maps actor, goal, scenario, screens, transitions, and incremental draft state", async () => {
    seedLocalDesignSystem(root, {
      includeSecondaryAction: true,
      includeProductFlowParts: true,
    });
    const { runtime } = await createGraphSmokeFixture(root);

    const completed = await runtime.startFlow({
      flowId: "create-product-flow",
      input: {
        project: { root, name: "Smoke Project" },
        userIntent:
          "Create an onboarding flow for admins so they can invite teammates and finish setup.",
        figmaTarget: fakeDraftTarget("Draft - Onboarding Flow"),
      },
    });

    expect(completed.status).toBe("done");
    expect(completed.state.flowModel).toMatchObject({
      actor: "admins",
      goal: "invite teammates",
      scenario: "finish setup",
      screens: expect.arrayContaining([
        expect.objectContaining({ id: "welcome", title: "Welcome" }),
        expect.objectContaining({ id: "invite-teammates", title: "Invite Teammates" }),
        expect.objectContaining({ id: "finish-setup", title: "Finish Setup" }),
      ]),
      transitions: [
        { from: "welcome", to: "invite-teammates", trigger: "continue" },
        { from: "invite-teammates", to: "finish-setup", trigger: "continue" },
      ],
    });
    expect(completed.state.draftPlan).toMatchObject({
      fidelity: "high",
      incremental: true,
    });
  });
});
