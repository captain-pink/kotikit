import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { createBuiltInNodeRegistry } from "../../built-in-registry.js";

describe("UX graph nodes", () => {
  it("brainstorms a compact design approach before UX envelope planning", async () => {
    const output = await runNode("ux.brainstormApproach", {
      userIntent: "Create Admin members page",
      screen: {
        title: "Members",
        requiredUiParts: ["members table", "invite member action", "search"],
        states: ["filled", "loading", "empty", "error"],
      },
    });

    const approach = recordFrom(recordFrom(output.statePatch).designApproach);

    expect(approach).toMatchObject({
      schemaVersion: "DesignApproach/v1",
      decision: "proceed",
      userWorkflow: expect.stringContaining("Members"),
      designSystemStrategy: expect.stringContaining("local design system"),
      iconStrategy: expect.stringContaining("local design-system icons"),
    });
    expect(recordArray(approach.alternativesConsidered).length).toBeGreaterThanOrEqual(2);
    expect(recordArray(approach.alternativesConsidered).length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(approach).length).toBeLessThan(4096);
    expect(output.artifacts?.[0]).toMatchObject({
      type: "design-approach",
      payload: {
        schemaVersion: "DesignApproach/v1",
        decision: "proceed",
      },
    });
  });

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
): Promise<{ statePatch?: Partial<KotikitGraphState>; artifacts?: unknown[] }> {
  const registry = createBuiltInNodeRegistry();
  const node = registry.get(key);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as {
    statePatch?: Partial<KotikitGraphState>;
    artifacts?: unknown[];
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
