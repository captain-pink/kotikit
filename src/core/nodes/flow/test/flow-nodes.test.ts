import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { flowNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
};

const baseState = (overrides: Partial<KotikitGraphState> = {}): KotikitGraphState => ({
  schemaVersion: "KotikitGraphState/v1",
  runId: "run-1",
  flowId: "create-product-flow",
  flowVersion: "1.0.0",
  graphHash: "graph-hash",
  status: "running",
  project: { root: "/tmp/project" },
  userIntent:
    "Create onboarding flow for new admins so they can invite teammates and finish setup.",
  artifacts: [],
  errors: [],
  ...overrides,
});

async function runFlowNode(
  key: string,
  state: KotikitGraphState = baseState(),
  params: unknown = {}
): Promise<NodeOutput> {
  const node = flowNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params, state })) as NodeOutput;
}

describe("flow nodes", () => {
  it("captures actor, goal, and scenario for a product flow", async () => {
    const result = await runFlowNode("flow.captureGoalActorScenario");

    expect(result.statePatch?.flowModel).toMatchObject({
      schemaVersion: "FlowModel/v1",
      actor: "new admins",
      goal: expect.stringContaining("invite teammates"),
      scenario: expect.stringContaining("finish setup"),
    });
  });

  it("maps a multi-screen product flow from actor, goal, and scenario", async () => {
    const result = await runFlowNode(
      "flow.mapUserFlow",
      baseState({
        flowModel: {
          schemaVersion: "FlowModel/v1",
          actor: "new admins",
          goal: "invite teammates",
          scenario: "finish setup",
        },
      })
    );

    expect(result.statePatch?.flowModel).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({ id: "welcome", title: "Welcome" }),
        expect.objectContaining({ id: "invite-teammates", title: "Invite Teammates" }),
        expect.objectContaining({ id: "finish-setup", title: "Finish Setup" }),
      ]),
      transitions: expect.arrayContaining([
        { from: "welcome", to: "invite-teammates", trigger: "continue" },
        { from: "invite-teammates", to: "finish-setup", trigger: "continue" },
      ]),
    });
  });

  it("identifies screens and states from the product-flow map", async () => {
    const result = await runFlowNode(
      "flow.identifyScreensAndStates",
      baseState({
        flowModel: {
          schemaVersion: "FlowModel/v1",
          actor: "new admins",
          goal: "invite teammates",
          scenario: "finish setup",
          steps: [
            { id: "welcome", title: "Welcome", goal: "orient the admin" },
            { id: "invite-teammates", title: "Invite Teammates", goal: "invite teammates" },
          ],
        },
      })
    );

    expect(result.statePatch?.flowModel).toMatchObject({
      screens: [
        expect.objectContaining({
          id: "welcome",
          states: ["loading", "empty", "error", "filled"],
          requiredUiParts: expect.arrayContaining(["primary action"]),
        }),
        expect.objectContaining({
          id: "invite-teammates",
          states: ["loading", "empty", "error", "filled"],
          regions: expect.objectContaining({
            forms: expect.arrayContaining(["invite teammates"]),
          }),
        }),
      ],
    });
  });
});
