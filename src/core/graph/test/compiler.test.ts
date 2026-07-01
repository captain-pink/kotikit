import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { KotikitError } from "../../../util/result.js";
import type { FlowDefinition } from "../../schemas/flow-definition.js";
import { compileFlowDefinition, validateFlowDefinition } from "../compiler.js";
import { createNodeRegistry, type NodeDefinition } from "../node-registry.js";

const EmptySchema = z.strictObject({});

function node(key: string, overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    key,
    version: "1.0.0",
    kind: "deterministic",
    paramsSchema: EmptySchema,
    inputSchema: EmptySchema,
    outputSchema: EmptySchema,
    stateReads: [],
    stateWrites: [],
    sideEffects: "none",
    requiredCapabilities: [],
    run: async () => ({}),
    ...overrides,
  };
}

const registry = createNodeRegistry([
  node("brief.captureMinimalIntent", {
    requiredCapabilities: ["brief.write"],
    paramsSchema: z.strictObject({ lane: z.enum(["quick", "guided"]) }),
    stateWrites: ["userIntent"],
  }),
  node("designSystem.searchLocal", {
    requiredCapabilities: ["designSystem.search.local"],
    stateReads: ["userIntent"],
    stateWrites: ["fitReport"],
  }),
  node("qa.postDraftQa", {
    stateReads: ["fitReport"],
    stateWrites: ["uiQualityGate"],
  }),
]);

const policy = {
  allowedCapabilities: ["brief.write", "designSystem.search.local"],
};

function validFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    schemaVersion: 1,
    id: "create-screen",
    version: "1.0.0",
    title: "Create Screen",
    description: "Create a screen draft.",
    stateSchema: "KotikitGraphState/v1",
    requiredCapabilities: ["brief.write", "designSystem.search.local"],
    nodes: [
      {
        id: "capture",
        uses: "brief.captureMinimalIntent",
        params: { lane: "quick" },
      },
      {
        id: "ground",
        uses: "designSystem.searchLocal",
        params: {},
      },
      {
        id: "qa",
        uses: "qa.postDraftQa",
        params: {},
      },
    ],
    edges: [
      ["capture", "ground"],
      ["ground", "qa"],
    ],
    start: "capture",
    end: ["qa"],
    safetyProfile: "standard-design-draft",
    ...overrides,
  };
}

describe("validateFlowDefinition", () => {
  it("rejects malformed flow manifests with a typed error", () => {
    expect(() =>
      validateFlowDefinition(
        {
          ...validFlow(),
          nodes: [],
        },
        registry,
        policy
      )
    ).toThrow(KotikitError);
  });

  it("rejects a missing start node", () => {
    expect(() => validateFlowDefinition(validFlow({ start: "missing" }), registry, policy)).toThrow(
      KotikitError
    );
  });

  it("rejects duplicate node ids", () => {
    const flow = validFlow({
      nodes: [
        { id: "capture", uses: "brief.captureMinimalIntent", params: {} },
        { id: "capture", uses: "designSystem.searchLocal", params: {} },
      ],
    });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects edges with unknown source nodes", () => {
    const flow = validFlow({ edges: [["missing", "qa"]] });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects edges with unknown target nodes", () => {
    const flow = validFlow({ edges: [["capture", "missing"]] });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects unknown uses keys", () => {
    const flow = validFlow({
      nodes: [{ id: "capture", uses: "missing.node", params: {} }],
      edges: [],
      end: ["capture"],
    });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects invalid node params with a typed error", () => {
    const flow = validFlow({
      nodes: [
        {
          id: "capture",
          uses: "brief.captureMinimalIntent",
          params: { lane: "fast" },
        },
      ],
      edges: [],
      end: ["capture"],
    });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects forbidden capabilities", () => {
    const flow = validFlow({ requiredCapabilities: ["figma.write.remote"] });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects side-effecting nodes without declared capabilities", () => {
    const unsafeRegistry = createNodeRegistry([
      node("figma.writeDraft", {
        sideEffects: "figma-write",
        requiredCapabilities: [],
      }),
    ]);
    const flow = validFlow({
      requiredCapabilities: [],
      nodes: [{ id: "write", uses: "figma.writeDraft", params: {} }],
      edges: [],
      start: "write",
      end: ["write"],
    });

    expect(() => validateFlowDefinition(flow, unsafeRegistry, { allowedCapabilities: [] })).toThrow(
      KotikitError
    );
  });

  it("rejects unreachable nodes", () => {
    const flow = validFlow({ edges: [["capture", "ground"]] });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects end nodes that are not terminal", () => {
    const flow = validFlow({ end: ["ground", "qa"] });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects terminal nodes not listed in end", () => {
    const flow = validFlow({ end: ["ground"] });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("rejects cyclic flows", () => {
    const flow = validFlow({
      edges: [
        ["capture", "ground"],
        ["ground", "capture"],
        ["capture", "qa"],
      ],
    });

    expect(() => validateFlowDefinition(flow, registry, policy)).toThrow(KotikitError);
  });

  it("compiles a valid manifest into a graph descriptor without running LangGraph", () => {
    const compiled = compileFlowDefinition(validFlow(), registry, policy);

    expect(compiled.flow.id).toBe("create-screen");
    expect(compiled.nodes.map((entry) => entry.id)).toEqual(["capture", "ground", "qa"]);
    expect(compiled.nodeVersions).toEqual({
      "brief.captureMinimalIntent": "1.0.0",
      "designSystem.searchLocal": "1.0.0",
      "qa.postDraftQa": "1.0.0",
    });
    expect(compiled.capabilities).toEqual(["brief.write", "designSystem.search.local"]);
    expect(compiled.safetyProfile).toBe("standard-design-draft");
    expect(compiled.graphHashInput.flowId).toBe("create-screen");
  });
});
