import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { KotikitError } from "../../../util/result.js";
import { createArtifactStore } from "../../runs/artifact-store.js";
import { createCheckpointStore } from "../../runs/checkpoint-store.js";
import { createRunStore } from "../../runs/run-store.js";
import type { FlowDefinition } from "../../schemas/flow-definition.js";
import { createUserInterrupt } from "../interrupts.js";
import { createNodeRegistry, type NodeDefinition } from "../node-registry.js";
import { createGraphRuntime } from "../runtime.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-runtime-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createGraphRuntime", () => {
  it("starts a flow and persists running state before node execution", async () => {
    const { runtime, runStore } = fixtureRuntime();

    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });
    const persisted = await runStore.getRun(started.runId);

    expect(persisted.flowId).toBe("fixture-flow");
    expect(persisted.flowVersion).toBe("1.0.0");
    expect(persisted.manifestHash).toBeString();
    expect(persisted.graphHash).toBeString();
    expect(persisted.nodeVersions).toEqual({
      "fixture.start": "1.0.0",
      "fixture.askUser": "1.0.0",
      "fixture.finish": "1.0.0",
    });
    expect(persisted.state.userIntent).toBe("Draft a members admin page");
  });

  it("pauses on user interrupt", async () => {
    const { runtime } = fixtureRuntime();

    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    expect(started.status).toBe("waiting-for-user");
    expect(started.state.pendingQuestion).toEqual({
      id: "screen-goal",
      prompt: "What should this screen accomplish?",
    });
  });

  it("does not continue a user interrupt without an answer", async () => {
    const { runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    await expect(runtime.continueRun({ runId: started.runId })).rejects.toThrow("answer");
  });

  it("resumes from answer", async () => {
    const { runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    const completed = await runtime.answerRun({
      runId: started.runId,
      answer: "Help admins invite and suspend members.",
    });

    expect(completed.status).toBe("done");
    expect(completed.state.pendingQuestion).toBeUndefined();
    expect(completed.state.userIntent).toBe("Help admins invite and suspend members.");
  });

  it("records answers by pending question id for downstream nodes", async () => {
    const { runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    const completed = await runtime.answerRun({
      runId: started.runId,
      answer: "Help admins invite and suspend members.",
    });

    expect(completed.state.answers).toEqual({
      "screen-goal": "Help admins invite and suspend members.",
    });
  });

  it("starts a flow with an initial Figma draft target", async () => {
    const { runtime } = fixtureRuntime();

    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: {
        project: { root },
        figmaTarget: {
          fileKey: "FILE",
          pageId: "1:2",
          pageName: "Draft - Members",
          pageUrl: "https://www.figma.com/design/FILE/Name?node-id=1-2",
          boundAt: "2026-06-30T00:00:00.000Z",
          source: "user-url",
          section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
          safety: {
            requireDraftPageName: true,
            allowPageCreation: false,
            requireKotikitSection: true,
          },
        },
      },
    });

    expect(started.state.figmaTarget).toMatchObject({
      fileKey: "FILE",
      pageId: "1:2",
      pageName: "Draft - Members",
    });
  });

  it("patches run state for external apply metadata", async () => {
    const { runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    const patched = await runtime.patchRunState({
      runId: started.runId,
      statePatch: {
        applyMetadata: {
          fileKey: "FILE",
          pageId: "1:2",
          sectionName: "kotikit / members / 2026-06-30",
        },
      },
    });

    expect(patched.state.applyMetadata).toMatchObject({
      fileKey: "FILE",
      pageId: "1:2",
    });
    expect(patched.state.runId).toBe(started.runId);
    expect(patched.status).toBe("waiting-for-user");
  });

  it("rejects answers when the run is not waiting for user input", async () => {
    const { runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });
    await runtime.answerRun({
      runId: started.runId,
      answer: "Help admins invite and suspend members.",
    });

    await expect(
      runtime.answerRun({
        runId: started.runId,
        answer: "Change the already completed run.",
      })
    ).rejects.toThrow("waiting for user");
  });

  it("writes artifact on completion", async () => {
    const { artifactStore, runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    const completed = await runtime.answerRun({
      runId: started.runId,
      answer: "Help admins invite and suspend members.",
    });

    expect(completed.state.artifacts).toEqual([
      {
        id: "artifact-1",
        type: "ui-composition-contract",
        schemaVersion: "UICompositionContract/v1",
      },
    ]);
    await expect(artifactStore.getArtifact("artifact-1")).resolves.toMatchObject({
      id: "artifact-1",
      runId: started.runId,
      type: "ui-composition-contract",
    });
  });

  it("rejects node artifacts that belong to another run", async () => {
    const { runtime } = fixtureRuntime({ finishMode: "wrong-run-artifact" });
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    await expect(
      runtime.answerRun({
        runId: started.runId,
        answer: "Help admins invite and suspend members.",
      })
    ).rejects.toThrow("run");
  });

  it("wraps malformed node artifacts in a friendly runtime error", async () => {
    const { runtime } = fixtureRuntime({ finishMode: "malformed-artifact" });
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    await expect(
      runtime.answerRun({
        runId: started.runId,
        answer: "Help admins invite and suspend members.",
      })
    ).rejects.toThrow(KotikitError);
  });

  it("rejects waiting-for-user interrupts without a pending question", async () => {
    const { runtime } = fixtureRuntime({ askMode: "missing-question" });

    await expect(
      runtime.startFlow({
        flowId: "fixture-flow",
        input: { project: { root } },
      })
    ).rejects.toThrow("pending question");
  });

  it("writes checkpoints after each persisted runtime step", async () => {
    const { checkpointStore, runtime } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    await expect(checkpointStore.getCheckpoint(started.runId)).resolves.toMatchObject({
      runId: started.runId,
      nextNodeIndex: 1,
    });
  });

  it("rejects resume with mismatched graph hash", async () => {
    const { runtime, runStore } = fixtureRuntime();
    const started = await runtime.startFlow({
      flowId: "fixture-flow",
      input: { project: { root } },
    });

    await runStore.updateRunState(started.runId, {
      graphHash: "stale-graph-hash",
      state: { ...started.state, graphHash: "stale-graph-hash" },
    });

    await expect(
      runtime.answerRun({
        runId: started.runId,
        answer: "Help admins invite and suspend members.",
      })
    ).rejects.toThrow("graph hash");
  });
});

function fixtureRuntime(
  options: {
    askMode?: "valid" | "missing-question";
    finishMode?: "valid" | "wrong-run-artifact" | "malformed-artifact";
  } = {}
) {
  const registry = createNodeRegistry([
    startNode(),
    askUserNode(options.askMode ?? "valid"),
    finishNode(options.finishMode ?? "valid"),
  ]);
  const runStore = createRunStore(root);
  const artifactStore = createArtifactStore(root);
  const checkpointStore = createCheckpointStore(root);
  const runtime = createGraphRuntime({
    registry,
    flowCatalog: [fixtureFlow()],
    runStore,
    artifactStore,
    checkpointStore,
  });
  return { artifactStore, checkpointStore, runStore, runtime };
}

function fixtureFlow(): FlowDefinition {
  return {
    schemaVersion: 1,
    id: "fixture-flow",
    version: "1.0.0",
    title: "Fixture Flow",
    stateSchema: "KotikitGraphState/v1",
    requiredCapabilities: ["runtime.fixture"],
    nodes: [
      { id: "start", uses: "fixture.start", params: {} },
      { id: "ask", uses: "fixture.askUser", params: {} },
      { id: "finish", uses: "fixture.finish", params: {} },
    ],
    edges: [
      ["start", "ask"],
      ["ask", "finish"],
    ],
    start: "start",
    end: ["finish"],
    safetyProfile: "runtime-fixture",
  };
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
    requiredCapabilities: ["runtime.fixture"],
    run: async () => ({}),
    ...overrides,
  };
}

function startNode(): NodeDefinition {
  return node({
    key: "fixture.start",
    stateWrites: ["userIntent"],
    run: async () => ({
      statePatch: { userIntent: "Draft a members admin page" },
    }),
  });
}

function askUserNode(mode: "valid" | "missing-question"): NodeDefinition {
  return node({
    key: "fixture.askUser",
    kind: "interrupt",
    stateReads: ["userIntent"],
    stateWrites: ["pendingQuestion"],
    run: async ({ state }) => {
      const answer = (state as { answers?: Record<string, string> }).answers?.["screen-goal"];
      if (answer !== undefined) {
        return { statePatch: { userIntent: answer } };
      }
      return mode === "missing-question"
        ? {
            interrupt: { status: "waiting-for-user" },
          }
        : {
            interrupt: createUserInterrupt({
              id: "screen-goal",
              prompt: "What should this screen accomplish?",
            }),
          };
    },
  });
}

function finishNode(mode: "valid" | "wrong-run-artifact" | "malformed-artifact"): NodeDefinition {
  return node({
    key: "fixture.finish",
    sideEffects: "filesystem",
    requiredCapabilities: ["runtime.fixture", "artifact.write"],
    stateReads: ["userIntent"],
    stateWrites: ["artifacts"],
    run: async ({ state }) => ({
      artifacts: [
        {
          id: "artifact-1",
          runId: mode === "wrong-run-artifact" ? "another-run" : (state as { runId: string }).runId,
          type: "ui-composition-contract",
          schemaVersion: "UICompositionContract/v1",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
          sourceNode: { key: "fixture.finish", version: "1.0.0" },
          payload: {
            schemaVersion:
              mode === "malformed-artifact" ? "LayoutContract/v1" : "UICompositionContract/v1",
            parts: [
              {
                id: "primary-action",
                name: "Primary action",
                role: "button",
                source: "existing-component",
                componentKey: "button-key",
              },
            ],
          },
        },
      ],
    }),
  });
}
