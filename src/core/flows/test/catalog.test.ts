import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { KotikitError } from "../../../util/result.js";
import { compileFlowDefinition } from "../../graph/compiler.js";
import { computeStableHash } from "../../graph/graph-hash.js";
import { createNodeRegistry, type NodeDefinition } from "../../graph/node-registry.js";
import type { FlowDefinition } from "../../schemas/flow-definition.js";
import { FlowDefinitionSchema } from "../../schemas/flow-definition.js";
import {
  loadBuiltInFlows,
  loadExtensionFlows,
  loadFlowCatalog,
  loadProjectFlows,
} from "../catalog.js";

const BUILT_IN_FLOW_IDS = ["create-screen", "refine-existing", "review-screen"];

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-flow-catalog-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("flow catalog", () => {
  it("loads unique built-in flow ids", async () => {
    const flows = await loadBuiltInFlows();
    const ids = flows.map((flow) => flow.id);

    expect(ids).toEqual(BUILT_IN_FLOW_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("validates every built-in flow manifest", async () => {
    const flows = await loadBuiltInFlows();

    flows.forEach((flow) => {
      expect(() => FlowDefinitionSchema.parse(flow)).not.toThrow();
    });
  });

  it("compiles every built-in flow against a fixture registry", async () => {
    const flows = await loadBuiltInFlows();
    const registry = createFixtureRegistry(flows);

    flows.forEach((flow) => {
      expect(() =>
        compileFlowDefinition(flow, registry, { allowedCapabilities: flow.requiredCapabilities })
      ).not.toThrow();
    });
  });

  it("ignores project flows unless config enables them", async () => {
    await writeProjectFlow(projectFlow());

    await expect(loadProjectFlows(root, {})).resolves.toEqual([]);
    await expect(
      loadProjectFlows(root, {
        projectFlows: {
          enabled: true,
          allowedCapabilities: ["designSystem.search.local"],
        },
      })
    ).resolves.toMatchObject([{ id: "project-create-screen" }]);
  });

  it("wraps invalid enabled project flow manifests in friendly errors", async () => {
    const dir = join(root, ".kotikit", "flows");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "broken.flow.json"), `${JSON.stringify({ id: "broken" })}\n`);

    await expect(loadProjectFlows(root, { projectFlows: { enabled: true } })).rejects.toThrow(
      KotikitError
    );
  });

  it("requires complete extension allowlist entries", async () => {
    const flow = projectFlow({ id: "extension-polish-screen" });
    await writeExtensionFlow(flow);

    await expect(loadExtensionFlows(root, {})).rejects.toThrow(KotikitError);
    await expect(
      loadExtensionFlows(root, {
        extensionFlows: {
          allowlist: [
            {
              id: flow.id,
              source: "local-fixture",
              enabled: true,
              hash: computeStableHash(flow),
              capabilities: flow.requiredCapabilities,
            },
          ],
        },
      })
    ).rejects.toThrow(KotikitError);
    await expect(
      loadExtensionFlows(root, {
        extensionFlows: {
          allowlist: [
            {
              id: flow.id,
              source: "local-fixture",
              enabled: true,
              version: "",
              hash: computeStableHash(flow),
              capabilities: flow.requiredCapabilities,
            },
          ],
        },
      })
    ).rejects.toThrow(KotikitError);
    await expect(
      loadExtensionFlows(root, {
        extensionFlows: {
          allowlist: [
            {
              id: flow.id,
              source: "local-fixture",
              enabled: true,
              ref: "",
              hash: computeStableHash(flow),
              capabilities: flow.requiredCapabilities,
            },
          ],
        },
      })
    ).rejects.toThrow(KotikitError);
    await expect(
      loadExtensionFlows(root, {
        extensionFlows: {
          allowlist: [
            {
              id: flow.id,
              source: "local-fixture",
              enabled: true,
              version: "1.0.0",
              hash: computeStableHash(flow),
              capabilities: [""],
            },
          ],
        },
      })
    ).rejects.toThrow(KotikitError);
    await expect(
      loadExtensionFlows(root, {
        extensionFlows: {
          allowlist: [
            {
              id: flow.id,
              source: "local-fixture",
              enabled: true,
              version: "1.0.0",
              hash: computeStableHash(flow),
              capabilities: flow.requiredCapabilities,
            },
          ],
        },
      })
    ).resolves.toMatchObject([{ id: flow.id }]);
  });

  it("combines built-in, enabled project, and allowlisted extension flows", async () => {
    const extension = projectFlow({ id: "extension-polish-screen" });
    await writeProjectFlow(projectFlow());
    await writeExtensionFlow(extension);

    const catalog = await loadFlowCatalog(root, {
      projectFlows: {
        enabled: true,
        allowedCapabilities: ["designSystem.search.local"],
      },
      extensionFlows: {
        allowlist: [
          {
            id: extension.id,
            source: "local-fixture",
            enabled: true,
            ref: "main",
            hash: computeStableHash(extension),
            capabilities: extension.requiredCapabilities,
          },
        ],
      },
    });

    expect(catalog.map((flow) => flow.id)).toEqual([
      ...BUILT_IN_FLOW_IDS,
      "project-create-screen",
      "extension-polish-screen",
    ]);
  });

  it("create-screen supports quick, guided, and deep lanes without separate public flow ids", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = requireFlow(flows, "create-screen");
    const laneNode = requireNode(createScreen, "brief.classifyIntent");

    expect(flows.map((flow) => flow.id)).not.toContain("create-screen-quick");
    expect(flows.map((flow) => flow.id)).not.toContain("create-screen-guided");
    expect(flows.map((flow) => flow.id)).not.toContain("create-screen-deep");
    expect(laneNode.params).toMatchObject({ lanes: ["quick", "guided", "deep"] });
  });

  it("create-screen quick high-fidelity lane skips full brief approval when intent is sufficient", async () => {
    const createScreen = requireFlow(await loadBuiltInFlows(), "create-screen");
    const laneNode = requireNode(createScreen, "brief.classifyIntent");

    expect(laneNode.params).toMatchObject({
      quickHighFidelity: {
        skipFullBriefApprovalWhen: "sufficient-intent-and-low-risk",
        recordsAssumptions: true,
      },
    });
  });

  it("create-screen brainstorms a compact design approach before UX envelope planning", async () => {
    const createScreen = requireFlow(await loadBuiltInFlows(), "create-screen");
    const uses = createScreen.nodes.map((node) => node.uses);

    expect(uses).toContain("ux.brainstormApproach");
    expect(uses.indexOf("brief.inferScreenBlueprint")).toBeLessThan(
      uses.indexOf("ux.brainstormApproach")
    );
    expect(uses.indexOf("ux.brainstormApproach")).toBeLessThan(uses.indexOf("ux.buildEnvelope"));
    expect(createScreen.requiredCapabilities).toContain("ux.brainstorm");
  });

  it("refine-existing starts from explicit target mapping", async () => {
    const refineExisting = requireFlow(await loadBuiltInFlows(), "refine-existing");

    expect(refineExisting.nodes.map((node) => node.uses)[0]).toBe("refine.mapExistingTargets");
    expect(refineExisting.requiredCapabilities).toContain("figma.write.remote");
  });

  it("review-screen keeps Figma comment feedback as a lightweight post-screen flow", async () => {
    const reviewScreen = requireFlow(await loadBuiltInFlows(), "review-screen");

    expect(reviewScreen.requiredCapabilities).toEqual(["comments.read", "feedback.plan"]);
    expect(reviewScreen.nodes.map((node) => node.uses)).toEqual([
      "feedback.buildEvidenceMap",
      "feedback.createRevisionPlan",
      "feedback.askRevisionApproval",
    ]);
    expect(reviewScreen.nodes.map((node) => node.uses)).not.toEqual(
      expect.arrayContaining([
        "review.collectEvidence",
        "comments.buildEvidenceMap",
        "memory.promotePreference",
      ])
    );
  });
});

function createFixtureRegistry(flows: FlowDefinition[]) {
  const definitions = Array.from(
    new Set(flows.flatMap((flow) => flow.nodes.map((node) => node.uses)))
  ).map((key) => node(key));
  return createNodeRegistry(definitions);
}

function node(key: string): NodeDefinition {
  return {
    key,
    version: "1.0.0",
    kind: "deterministic",
    paramsSchema: z.record(z.string(), z.unknown()),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: [],
    stateWrites: [],
    sideEffects: "none",
    requiredCapabilities: [],
    run: async () => ({}),
  };
}

async function writeProjectFlow(flow: FlowDefinition): Promise<void> {
  const dir = join(root, ".kotikit", "flows");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${flow.id}.flow.json`), `${JSON.stringify(flow, null, 2)}\n`);
}

async function writeExtensionFlow(flow: FlowDefinition): Promise<void> {
  const dir = join(root, ".kotikit", "extensions", "flows");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${flow.id}.flow.json`), `${JSON.stringify(flow, null, 2)}\n`);
}

function projectFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    schemaVersion: 1,
    id: "project-create-screen",
    version: "1.0.0",
    title: "Project Create Screen",
    description: "Project-specific screen draft flow.",
    stateSchema: "KotikitGraphState/v1",
    requiredCapabilities: ["designSystem.search.local"],
    nodes: [
      {
        id: "search",
        uses: "designSystem.searchLocal",
        params: {},
      },
    ],
    edges: [],
    start: "search",
    end: ["search"],
    safetyProfile: "project-design-draft",
    ...overrides,
  };
}

function requireFlow(flows: FlowDefinition[], id: string): FlowDefinition {
  const flow = flows.find((candidate) => candidate.id === id);
  if (flow === undefined) {
    throw new Error(`Expected ${id} flow.`);
  }
  return flow;
}

function requireNode(flow: FlowDefinition, uses: string): FlowDefinition["nodes"][number] {
  const node = flow.nodes.find((candidate) => candidate.uses === uses);
  if (node === undefined) {
    throw new Error(`Expected ${uses} node.`);
  }
  return node;
}
