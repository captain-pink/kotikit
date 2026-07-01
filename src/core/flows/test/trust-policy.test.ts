import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defaultConfig } from "../../../config/schema.js";
import { KotikitError } from "../../../util/result.js";
import { computeStableHash } from "../../graph/graph-hash.js";
import { createNodeRegistry, type NodeDefinition } from "../../graph/node-registry.js";
import { createGraphRuntime } from "../../graph/runtime.js";
import { createArtifactStore } from "../../runs/artifact-store.js";
import { createRunStore } from "../../runs/run-store.js";
import type { FlowDefinition } from "../../schemas/flow-definition.js";
import { loadExtensionFlows, loadFlowCatalog, loadProjectFlows } from "../catalog.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-flow-trust-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("flow pack trust policy", () => {
  it("defaults project and extension flow packs to disabled", () => {
    expect(defaultConfig().flowPacks).toEqual({
      projectFlowsEnabled: false,
      allowedProjectCapabilities: [],
      extensions: [],
    });
  });

  it("ignores project flows when project flow packs are disabled", async () => {
    await writeProjectFlow(projectFlow());

    const catalog = await loadFlowCatalog(root, { flowPacks: defaultConfig().flowPacks });

    expect(catalog.map((flow) => flow.id)).not.toContain("project-create-screen");
  });

  it("rejects enabled project flows outside the project capability allowlist", async () => {
    await writeProjectFlow(projectFlow());

    await expect(
      loadProjectFlows(root, {
        flowPacks: {
          projectFlowsEnabled: true,
          allowedProjectCapabilities: [],
          extensions: [],
        },
      })
    ).rejects.toThrow(KotikitError);
  });

  it("loads enabled project flows when capabilities are explicitly allowed", async () => {
    await writeProjectFlow(projectFlow());

    await expect(
      loadProjectFlows(root, {
        flowPacks: {
          projectFlowsEnabled: true,
          allowedProjectCapabilities: ["designSystem.search.local"],
          extensions: [],
        },
      })
    ).resolves.toMatchObject([{ id: "project-create-screen" }]);
  });

  it("rejects extension flows without an enabled allowlist entry", async () => {
    await writeExtensionFlow(projectFlow({ id: "extension-polish-screen" }));

    await expect(
      loadExtensionFlows(root, {
        flowPacks: {
          projectFlowsEnabled: false,
          allowedProjectCapabilities: [],
          extensions: [],
        },
      })
    ).rejects.toThrow(KotikitError);
  });

  it("rejects legacy extension allowlist entries that are not explicitly enabled", async () => {
    const flow = projectFlow({ id: "extension-polish-screen" });
    await writeExtensionFlow(flow);

    await expect(
      loadExtensionFlows(root, {
        extensionFlows: {
          allowlist: [
            {
              id: flow.id,
              source: "local-fixture",
              versionOrRef: "1.0.0",
              hash: computeStableHash(flow),
              capabilities: flow.requiredCapabilities,
            },
          ],
        },
      })
    ).rejects.toThrow(KotikitError);
  });

  it("rejects extension flows when the allowlisted hash does not match", async () => {
    const flow = projectFlow({ id: "extension-polish-screen" });
    await writeExtensionFlow(flow);

    await expect(
      loadExtensionFlows(root, {
        flowPacks: {
          projectFlowsEnabled: false,
          allowedProjectCapabilities: [],
          extensions: [
            {
              id: flow.id,
              source: "local-fixture",
              versionOrRef: "1.0.0",
              hash: "not-the-real-hash",
              capabilities: flow.requiredCapabilities,
              enabled: true,
            },
          ],
        },
      })
    ).rejects.toThrow("hash");
  });

  it("loads enabled extension flows with matching hash and allowed capabilities", async () => {
    const flow = projectFlow({ id: "extension-polish-screen" });
    await writeExtensionFlow(flow);

    await expect(
      loadExtensionFlows(root, {
        flowPacks: {
          projectFlowsEnabled: false,
          allowedProjectCapabilities: [],
          extensions: [
            {
              id: flow.id,
              source: "local-fixture",
              versionOrRef: "1.0.0",
              hash: computeStableHash(flow),
              capabilities: flow.requiredCapabilities,
              enabled: true,
            },
          ],
        },
      })
    ).resolves.toMatchObject([{ id: flow.id }]);
  });

  it("active runs persist manifest and graph hashes for trusted flows", async () => {
    const flow = projectFlow({ id: "trusted-project-flow" });
    const runStore = createRunStore(root);
    const runtime = createGraphRuntime({
      registry: createNodeRegistry([
        node("designSystem.searchLocal", {
          requiredCapabilities: ["designSystem.search.local"],
        }),
      ]),
      flowCatalog: [flow],
      runStore,
      artifactStore: createArtifactStore(root),
    });

    const started = await runtime.startFlow({
      flowId: flow.id,
      input: { project: { root } },
    });
    const persisted = await runStore.getRun(started.runId);

    expect(persisted.manifestHash).toBe(computeStableHash(flow));
    expect(persisted.graphHash).toBe(started.state.graphHash);
    expect(persisted.graphHash).not.toBe(persisted.manifestHash);
  });

  it("runtime rejects trusted flows that omit registry-declared node capabilities", async () => {
    const flow = projectFlow({
      id: "omits-node-capability",
      requiredCapabilities: [],
    });
    const runtime = createGraphRuntime({
      registry: createNodeRegistry([
        node("designSystem.searchLocal", {
          requiredCapabilities: ["designSystem.search.local"],
        }),
      ]),
      flowCatalog: [flow],
      runStore: createRunStore(root),
      artifactStore: createArtifactStore(root),
    });

    await expect(
      runtime.startFlow({
        flowId: flow.id,
        input: { project: { root } },
      })
    ).rejects.toThrow("designSystem.search.local");
  });
});

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

function node(key: string, overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  const schema = z.strictObject({});
  return {
    key,
    version: "1.0.0",
    kind: "deterministic",
    paramsSchema: schema,
    inputSchema: schema,
    outputSchema: schema,
    stateReads: [],
    stateWrites: [],
    sideEffects: "none",
    requiredCapabilities: [],
    run: async () => ({}),
    ...overrides,
  };
}
