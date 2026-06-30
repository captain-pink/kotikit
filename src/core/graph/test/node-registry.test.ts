import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { KotikitError } from "../../../util/result.js";
import { createNodeRegistry, type NodeDefinition } from "../node-registry.js";

const FixtureParamsSchema = z.strictObject({
  lane: z.enum(["quick", "guided"]),
});

const FixtureInputSchema = z.strictObject({
  userIntent: z.string().optional(),
});

const FixtureOutputSchema = z.strictObject({
  userIntent: z.string(),
});

function fixtureNode(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    key: "brief.captureMinimalIntent",
    version: "1.0.0",
    kind: "deterministic",
    paramsSchema: FixtureParamsSchema,
    inputSchema: FixtureInputSchema,
    outputSchema: FixtureOutputSchema,
    stateReads: ["userIntent"],
    stateWrites: ["userIntent"],
    sideEffects: "none",
    requiredCapabilities: ["brief.write"],
    run: async () => ({ userIntent: "Create a members admin page" }),
    ...overrides,
  };
}

describe("createNodeRegistry", () => {
  it("rejects duplicate node keys", () => {
    expect(() => createNodeRegistry([fixtureNode(), fixtureNode({ version: "1.0.1" })])).toThrow(
      KotikitError
    );
  });

  it("returns a typed error for unknown node keys", () => {
    const registry = createNodeRegistry([fixtureNode()]);

    expect(() => registry.get("missing.node")).toThrow(KotikitError);
  });

  it("exposes registered node metadata and runner", async () => {
    const node = fixtureNode();
    const registry = createNodeRegistry([node]);

    expect(registry.has(node.key)).toBe(true);
    expect(registry.list()).toEqual([node]);
    expect(registry.get(node.key)).toMatchObject({
      key: "brief.captureMinimalIntent",
      version: "1.0.0",
      kind: "deterministic",
      stateReads: ["userIntent"],
      stateWrites: ["userIntent"],
      sideEffects: "none",
      requiredCapabilities: ["brief.write"],
    });
    expect(registry.get(node.key).paramsSchema.parse({ lane: "quick" })).toEqual({
      lane: "quick",
    });
    await expect(
      registry.get(node.key).run({
        nodeId: "capture-minimal-intent",
        params: { lane: "quick" },
        state: {},
      })
    ).resolves.toEqual({ userIntent: "Create a members admin page" });
  });
});
