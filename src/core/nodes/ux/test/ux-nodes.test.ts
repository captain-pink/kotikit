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

  it("does not infer a fixed archetype from explicit blueprint UI part names", async () => {
    const output = await runNode("ux.buildEnvelope", {
      userIntent: "Create the supplied mocked Events blueprint with table wording.",
      screen: {
        title: "Events Experience",
        confidence: "explicit",
        requiredUiParts: ["Event table", "Detail panel"],
        states: [],
      },
    });

    expect(output.statePatch?.uxEnvelope).toMatchObject({
      screenArchetype: "unknown",
      confidence: "observed",
      primaryGoal: "Events Experience",
    });
  });

  it("asks for direction without substituting a workflow for low-confidence intent", async () => {
    const userIntent =
      "Design a mocked Reports catalog with columns Title, Data source, Chart type, Owner, and Updated plus a sidebar, tabs, search, filters, and an empty state.";
    const output = await runNode("ux.brainstormApproach", {
      userIntent,
      screen: {
        title: "Product Screen",
        confidence: "low",
        requiredUiParts: ["page shell", "content heading", "primary action"],
        states: ["loading", "empty", "error", "filled"],
      },
    });
    const approach = recordFrom(recordFrom(output.statePatch).designApproach);

    expect(approach).toMatchObject({
      decision: "ask-designer",
      userWorkflow: expect.stringContaining("Title, Data source"),
      recommendedApproach: expect.stringContaining("validated blueprint"),
      stateStrategy: expect.stringContaining("validated blueprint"),
    });
    expect(JSON.stringify(approach)).not.toMatch(
      /manage members|invite member|filled|loading|empty|error/i
    );
  });

  it("preserves blueprint traits in the UX envelope without forcing an archetype", async () => {
    const output = await runNode("ux.buildEnvelope", {
      userIntent: "Create the supplied mocked Events blueprint with admin wording.",
      screen: {
        title: "Events Experience",
        requiredUiParts: ["Event stream", "Detail panel"],
        states: ["filled", "loading"],
        traits: {
          regions: [{ id: "activity", name: "Activity", kind: "timeline" }],
          stateScopes: [{ id: "page", name: "Page", kind: "page" }],
          repeatedPatterns: [{ id: "events", name: "Event items", kind: "events" }],
        },
      },
    });

    expect(output.statePatch?.uxEnvelope).toMatchObject({
      screenArchetype: "unknown",
      traits: {
        regions: [expect.objectContaining({ kind: "timeline", name: "Activity" })],
        repeatedPatterns: [expect.objectContaining({ kind: "events" })],
      },
    });
  });

  it("describes explicit blueprint work as execution instead of generic ideation", async () => {
    const output = await runNode("ux.brainstormApproach", {
      userIntent: "Create the supplied mocked Events blueprint.",
      screen: {
        title: "Events Experience",
        confidence: "explicit",
        requiredUiParts: ["Event stream", "Detail panel"],
        states: [],
      },
    });
    const approach = recordFrom(recordFrom(output.statePatch).designApproach);

    expect(approach).toMatchObject({
      decision: "proceed",
      recommendedApproach: expect.stringContaining("Execute the supplied blueprint"),
      userWorkflow: expect.not.stringContaining("without extra setup"),
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
