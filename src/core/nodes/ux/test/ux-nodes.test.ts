import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { createBuiltInNodeRegistry } from "../../built-in-registry.js";

describe("UX graph nodes", () => {
  it("builds a UX envelope from screen intent", async () => {
    const output = await runNode("ux.buildEnvelope", {
      userIntent: "Create Admin members page",
      screen: {
        title: "Members",
        requiredUiParts: ["members table"],
        states: ["filled", "loading", "empty", "error"],
      },
    });

    expect(output.statePatch?.uxEnvelope).toMatchObject({
      schemaVersion: "UXEnvelope/v1",
      screenArchetype: "admin-data-table",
    });
  });

  it("plans a state matrix before UI composition", async () => {
    const envelopeOutput = await runNode("ux.buildEnvelope", {
      userIntent: "Create Admin members page",
      screen: {
        title: "Members",
        requiredUiParts: ["members table"],
        states: ["filled", "loading", "empty", "error"],
      },
    });
    const output = await runNode("ux.planStateMatrix", {
      uxEnvelope: envelopeOutput.statePatch?.uxEnvelope,
    });

    expect(output.statePatch?.stateMatrix).toMatchObject({
      schemaVersion: "StateMatrix/v1",
      states: expect.arrayContaining([
        expect.objectContaining({ kind: "loading", scope: "region" }),
      ]),
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
    runId: "run-ux",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/project" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}
