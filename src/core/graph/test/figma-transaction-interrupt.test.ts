import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createArtifactStore } from "../../runs/artifact-store.js";
import { createCheckpointStore } from "../../runs/checkpoint-store.js";
import { createRunStore } from "../../runs/run-store.js";
import type { FlowDefinition } from "../../schemas/flow-definition.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";
import { createNodeRegistry, type NodeDefinition } from "../node-registry.js";
import { createGraphRuntime } from "../runtime.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-figma-interrupt-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Figma transaction interrupts", () => {
  it("resumes the same runtime node when a Figma interrupt requests same-node resume", async () => {
    let visits = 0;
    const runtime = createRuntime({
      flow: singleNodeFlow(),
      nodes: [
        applyTransactionQueueNode(async () => {
          visits += 1;
          if (visits === 1) {
            return {
              statePatch: { activeFigmaTransaction: validActiveTransaction },
              interrupt: { status: "waiting-for-figma", resume: "same-node" },
            };
          }
          return { statePatch: { activeFigmaTransaction: undefined } };
        }),
      ],
    });

    const started = await runtime.startFlow({
      flowId: "figma-transaction-flow",
      input: { project: { root } },
    });
    expect(started.status).toBe("waiting-for-figma");

    const completed = await runtime.continueRun({ runId: started.runId });

    expect(completed.status).toBe("done");
    expect(completed.state.activeFigmaTransaction).toBeUndefined();
    expect(visits).toBe(2);
  });

  it("advances to the next runtime node for existing Figma interrupts without resume", async () => {
    let secondNodeRan = false;
    const runtime = createRuntime({
      flow: twoNodeFlow(),
      nodes: [
        applyTransactionQueueNode(async () => ({
          interrupt: { status: "waiting-for-figma" },
        })),
        markFinishedNode(async () => {
          secondNodeRan = true;
          return { statePatch: { applyReport: { completedBy: "fixture.finish" } } };
        }),
      ],
    });

    const started = await runtime.startFlow({
      flowId: "figma-default-resume-flow",
      input: { project: { root } },
    });
    expect(started.status).toBe("waiting-for-figma");

    const completed = await runtime.continueRun({ runId: started.runId });

    expect(completed.status).toBe("done");
    expect(secondNodeRan).toBe(true);
    expect(completed.state.applyReport).toEqual({ completedBy: "fixture.finish" });
  });
});

const validActiveTransaction: NonNullable<KotikitGraphState["activeFigmaTransaction"]> = {
  id: "txn-1",
  order: 1,
  kind: "create-screen-state",
  label: "Members / Filled",
  placementId: "state-filled",
  stateId: "filled",
  requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs"],
};

function createRuntime(input: { flow: FlowDefinition; nodes: NodeDefinition[] }) {
  return createGraphRuntime({
    registry: createNodeRegistry(input.nodes),
    flowCatalog: [input.flow],
    runStore: createRunStore(root),
    artifactStore: createArtifactStore(root),
    checkpointStore: createCheckpointStore(root),
  });
}

function singleNodeFlow(): FlowDefinition {
  return {
    schemaVersion: 1,
    id: "figma-transaction-flow",
    version: "1.0.0",
    title: "Figma Transaction Flow",
    stateSchema: "KotikitGraphState/v1",
    requiredCapabilities: ["figma.write"],
    nodes: [{ id: "apply", uses: "figma.applyTransactionQueue", params: {} }],
    edges: [],
    start: "apply",
    end: ["apply"],
    safetyProfile: "figma-transaction-fixture",
  };
}

function twoNodeFlow(): FlowDefinition {
  return {
    schemaVersion: 1,
    id: "figma-default-resume-flow",
    version: "1.0.0",
    title: "Figma Default Resume Flow",
    stateSchema: "KotikitGraphState/v1",
    requiredCapabilities: ["figma.write"],
    nodes: [
      { id: "apply", uses: "figma.applyTransactionQueue", params: {} },
      { id: "finish", uses: "fixture.finish", params: {} },
    ],
    edges: [["apply", "finish"]],
    start: "apply",
    end: ["finish"],
    safetyProfile: "figma-default-resume-fixture",
  };
}

function applyTransactionQueueNode(run: NodeDefinition["run"]): NodeDefinition {
  return node({
    key: "figma.applyTransactionQueue",
    kind: "external-action",
    stateWrites: ["activeFigmaTransaction"],
    sideEffects: "figma-write",
    requiredCapabilities: ["figma.write"],
    run,
  });
}

function markFinishedNode(run: NodeDefinition["run"]): NodeDefinition {
  return node({
    key: "fixture.finish",
    stateWrites: ["applyReport"],
    run,
  });
}

function node(overrides: Partial<NodeDefinition>): NodeDefinition {
  const EmptySchema = z.strictObject({});
  return {
    key: "fixture.node",
    version: "1.0.0",
    kind: "deterministic",
    paramsSchema: EmptySchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: [],
    stateWrites: [],
    sideEffects: "none",
    requiredCapabilities: [],
    run: async () => ({}),
    ...overrides,
  };
}
