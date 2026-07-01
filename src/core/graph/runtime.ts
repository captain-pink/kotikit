import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { nowIso, uuid } from "../../util/ids.js";
import { KotikitError } from "../../util/result.js";
import type { ArtifactStore } from "../runs/artifact-store.js";
import type { CheckpointStore } from "../runs/checkpoint-store.js";
import type { RunRecord, RunStore } from "../runs/run-store.js";
import { type Artifact, ArtifactSchema } from "../schemas/artifact.js";
import type { FlowDefinition } from "../schemas/flow-definition.js";
import {
  KOTIKIT_GRAPH_STATE_SCHEMA_VERSION,
  type KotikitGraphState,
} from "../schemas/graph-state.js";
import {
  type CompiledFlowDefinition,
  compileFlowDefinition,
  type ResolvedFlowNode,
} from "./compiler.js";
import { computeGraphHash, computeStableHash } from "./graph-hash.js";
import { isRuntimeInterrupt, type RuntimeInterrupt } from "./interrupts.js";
import type { NodeRegistry } from "./node-registry.js";

type FlowCatalogInput = FlowDefinition[] | Map<string, FlowDefinition>;

export type GraphRuntime = {
  startFlow(input: { flowId: string; input: RuntimeStartInput }): Promise<RuntimeRunResult>;
  continueRun(input: { runId: string }): Promise<RuntimeRunResult>;
  answerRun(input: { runId: string; answer: string }): Promise<RuntimeRunResult>;
  patchRunState(input: {
    runId: string;
    statePatch: Partial<KotikitGraphState>;
  }): Promise<RuntimeRunResult>;
  getRunState(runId: string): Promise<KotikitGraphState>;
  getArtifact(artifactId: string): Promise<Artifact>;
};

export type RuntimeStartInput = {
  project: KotikitGraphState["project"];
  userIntent?: string;
  figmaTarget?: KotikitGraphState["figmaTarget"];
  review?: KotikitGraphState["review"];
  designSystem?: KotikitGraphState["designSystem"];
};

export type RuntimeRunResult = {
  runId: string;
  status: KotikitGraphState["status"];
  state: KotikitGraphState;
};

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
  interrupt?: RuntimeInterrupt;
};

type CompiledRuntimeFlow = {
  compiled: CompiledFlowDefinition;
  executionOrder: ResolvedFlowNode[];
  langGraph: RuntimeLangGraph;
  graphHash: string;
  manifestHash: string;
};

type RuntimeLangGraphState = {
  state: KotikitGraphState;
  nodeOutput?: RuntimeNodeOutput;
  nodeId?: string;
  params?: unknown;
};

type RuntimeLangGraph = {
  invoke(input: RuntimeLangGraphState): Promise<RuntimeLangGraphState>;
};

export function createGraphRuntime(input: {
  registry: NodeRegistry;
  flowCatalog: FlowCatalogInput;
  runStore: RunStore;
  artifactStore: ArtifactStore;
  checkpointStore?: CheckpointStore;
}): GraphRuntime {
  const flowCatalog = normalizeFlowCatalog(input.flowCatalog);

  return {
    async startFlow(startInput): Promise<RuntimeRunResult> {
      const flow = getFlow(flowCatalog, startInput.flowId);
      const compiled = compileRuntimeFlow(flow, input.registry);
      const now = nowIso();
      const runId = uuid();
      const state: KotikitGraphState = {
        schemaVersion: KOTIKIT_GRAPH_STATE_SCHEMA_VERSION,
        runId,
        flowId: flow.id,
        flowVersion: flow.version,
        graphHash: compiled.graphHash,
        status: "running",
        project: startInput.input.project,
        userIntent: startInput.input.userIntent,
        figmaTarget: startInput.input.figmaTarget,
        review: startInput.input.review,
        designSystem: startInput.input.designSystem,
        artifacts: [],
        errors: [],
      };
      const run: RunRecord = {
        id: runId,
        flowId: flow.id,
        flowVersion: flow.version,
        manifestHash: compiled.manifestHash,
        graphHash: compiled.graphHash,
        stateSchemaVersion: KOTIKIT_GRAPH_STATE_SCHEMA_VERSION,
        nodeVersions: compiled.compiled.nodeVersions,
        status: "running",
        nextNodeIndex: 0,
        state,
        createdAt: now,
        updatedAt: now,
      };

      await input.runStore.createRun(run);
      return executeRun(run, compiled, input.runStore, input.artifactStore, input.checkpointStore);
    },
    async continueRun({ runId }): Promise<RuntimeRunResult> {
      const run = await input.runStore.getRun(runId);
      const compiled = compileRuntimeFlow(getFlow(flowCatalog, run.flowId), input.registry);
      assertGraphHashMatches(run, compiled);
      if (run.status === "waiting-for-user") {
        throw new KotikitError(
          "This run is waiting for an answer before it can continue.",
          "Use kotikit_answer with the designer's answer to resume the flow."
        );
      }
      return executeRun(run, compiled, input.runStore, input.artifactStore, input.checkpointStore);
    },
    async answerRun({ runId, answer }): Promise<RuntimeRunResult> {
      const run = await input.runStore.getRun(runId);
      const compiled = compileRuntimeFlow(getFlow(flowCatalog, run.flowId), input.registry);
      assertGraphHashMatches(run, compiled);
      if (run.status !== "waiting-for-user") {
        throw new KotikitError(
          "This run is not waiting for user input.",
          "Only answer runs that are paused with a pending question."
        );
      }
      const pendingQuestionId = run.state.pendingQuestion?.id;
      const state = {
        ...run.state,
        status: "running" as const,
        pendingQuestion: undefined,
        userIntent: answer,
        ...(pendingQuestionId === undefined
          ? {}
          : {
              answers: {
                ...(run.state.answers ?? {}),
                [pendingQuestionId]: answer,
              },
            }),
      };
      const updated = await input.runStore.updateRunState(runId, {
        status: "running",
        state,
      });
      return executeRun(
        updated,
        compiled,
        input.runStore,
        input.artifactStore,
        input.checkpointStore
      );
    },
    async patchRunState({ runId, statePatch }): Promise<RuntimeRunResult> {
      const run = await input.runStore.getRun(runId);
      const state = {
        ...run.state,
        ...statePatch,
        runId: run.id,
        flowId: run.flowId,
        flowVersion: run.flowVersion,
        graphHash: run.graphHash,
        status: run.status,
      };
      const updated = await input.runStore.updateRunState(runId, {
        status: run.status,
        state,
      });
      return toResult(updated);
    },
    async getRunState(runId: string): Promise<KotikitGraphState> {
      return (await input.runStore.getRun(runId)).state;
    },
    async getArtifact(artifactId: string): Promise<Artifact> {
      return input.artifactStore.getArtifact(artifactId);
    },
  };
}

function normalizeFlowCatalog(flowCatalog: FlowCatalogInput): Map<string, FlowDefinition> {
  if (flowCatalog instanceof Map) return flowCatalog;
  return new Map(flowCatalog.map((flow) => [flow.id, flow]));
}

function getFlow(flowCatalog: Map<string, FlowDefinition>, flowId: string): FlowDefinition {
  const flow = flowCatalog.get(flowId);
  if (flow === undefined) {
    throw new KotikitError(`Unknown kotikit flow: ${flowId}.`);
  }
  return flow;
}

function compileRuntimeFlow(flow: FlowDefinition, registry: NodeRegistry): CompiledRuntimeFlow {
  const allowedCapabilities = Array.from(
    new Set([
      ...flow.requiredCapabilities,
      ...flow.nodes.flatMap((node) => registry.get(node.uses).requiredCapabilities),
    ])
  );
  const compiled = compileFlowDefinition(flow, registry, { allowedCapabilities });
  const graphHash = computeGraphHash(compiled.graphHashInput);
  return {
    compiled,
    executionOrder: executionOrder(compiled),
    langGraph: compileLangGraph(compiled),
    graphHash,
    manifestHash: computeStableHash(flow),
  };
}

async function executeRun(
  initialRun: RunRecord,
  compiled: CompiledRuntimeFlow,
  runStore: RunStore,
  artifactStore: ArtifactStore,
  checkpointStore?: CheckpointStore
): Promise<RuntimeRunResult> {
  let run = initialRun;

  while (run.nextNodeIndex < compiled.executionOrder.length) {
    const node = compiled.executionOrder[run.nextNodeIndex];
    if (node === undefined) {
      throw new KotikitError("This flow run points to an unknown node index.");
    }

    const output = parseRuntimeNodeOutput(
      (
        await compiled.langGraph.invoke({
          state: run.state,
          nodeId: node.id,
          params: node.manifest.params ?? {},
        })
      ).nodeOutput
    );

    const patchedState = { ...run.state, ...output.statePatch };

    if (output.artifacts !== undefined) {
      for (const artifact of output.artifacts) {
        if (artifact.runId !== run.id) {
          throw new KotikitError(
            "A runtime node returned an artifact for a different run.",
            "Node artifacts must use the active run id before they can be persisted."
          );
        }
        await artifactStore.writeArtifact(artifact);
      }
    }

    const stateWithArtifacts =
      output.artifacts === undefined
        ? patchedState
        : {
            ...patchedState,
            artifacts: [
              ...patchedState.artifacts,
              ...output.artifacts.map((artifact) => ({
                id: artifact.id,
                type: artifact.type,
                schemaVersion: artifact.schemaVersion,
              })),
            ],
          };

    if (output.interrupt !== undefined) {
      const interruptedState = {
        ...stateWithArtifacts,
        status: output.interrupt.status,
        pendingQuestion: output.interrupt.pendingQuestion,
      };
      run = await runStore.updateRunState(run.id, {
        currentNodeId: node.id,
        nextNodeIndex:
          output.interrupt.status === "waiting-for-user"
            ? run.nextNodeIndex
            : run.nextNodeIndex + 1,
        status: output.interrupt.status,
        state: interruptedState,
      });
      await writeRuntimeCheckpoint(run, checkpointStore);
      return toResult(run);
    }

    run = await runStore.updateRunState(run.id, {
      currentNodeId: node.id,
      nextNodeIndex: run.nextNodeIndex + 1,
      status: "running",
      state: { ...stateWithArtifacts, status: "running" },
    });
    await writeRuntimeCheckpoint(run, checkpointStore);
  }

  run = await runStore.updateRunState(run.id, {
    status: "done",
    state: { ...run.state, status: "done" },
  });
  await writeRuntimeCheckpoint(run, checkpointStore);
  return toResult(run);
}

async function writeRuntimeCheckpoint(
  run: RunRecord,
  checkpointStore?: CheckpointStore
): Promise<void> {
  await checkpointStore?.writeCheckpoint({
    runId: run.id,
    graphHash: run.graphHash,
    nextNodeIndex: run.nextNodeIndex,
    savedAt: run.updatedAt,
  });
}

function parseRuntimeNodeOutput(output: unknown): RuntimeNodeOutput {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return {};
  const candidate = output as {
    statePatch?: unknown;
    artifacts?: unknown;
    interrupt?: unknown;
  };

  return {
    statePatch:
      typeof candidate.statePatch === "object" && candidate.statePatch !== null
        ? (candidate.statePatch as Partial<KotikitGraphState>)
        : undefined,
    artifacts: Array.isArray(candidate.artifacts)
      ? candidate.artifacts.map(parseRuntimeArtifact)
      : undefined,
    interrupt: parseRuntimeInterrupt(candidate.interrupt),
  };
}

function parseRuntimeArtifact(value: unknown): Artifact {
  try {
    return ArtifactSchema.parse(value);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new KotikitError(
        "A runtime node returned an invalid artifact.",
        "Node artifacts must match the artifact type, schema version, and payload schema before they can be persisted."
      );
    }
    throw err;
  }
}

function parseRuntimeInterrupt(value: unknown): RuntimeInterrupt | undefined {
  if (value === undefined) return undefined;
  if (!isRuntimeInterrupt(value)) {
    throw new KotikitError(
      "A runtime node returned an invalid interrupt without a pending question.",
      "waiting-for-user interrupts must include a pending question."
    );
  }
  return value;
}

function toResult(run: RunRecord): RuntimeRunResult {
  return { runId: run.id, status: run.status, state: run.state };
}

function assertGraphHashMatches(run: RunRecord, compiled: CompiledRuntimeFlow): void {
  if (run.graphHash !== compiled.graphHash) {
    throw new KotikitError(
      "This run cannot resume because its graph hash no longer matches.",
      "Start a new run or restore the flow and node versions used when the run started."
    );
  }
}

function executionOrder(compiled: CompiledFlowDefinition): ResolvedFlowNode[] {
  const byId = new Map(compiled.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map(compiled.nodes.map((node) => [node.id, 0]));

  compiled.edges.forEach(([source, target]) => {
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  });

  const pending = [compiled.start];
  const ordered: ResolvedFlowNode[] = [];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (nodeId === undefined || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = byId.get(nodeId);
    if (node === undefined) {
      throw new KotikitError(`Compiled flow references missing node "${nodeId}".`);
    }
    ordered.push(node);

    (outgoing.get(nodeId) ?? []).forEach((target) => {
      const nextInDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextInDegree);
      if (nextInDegree === 0) pending.push(target);
    });
  }

  return ordered;
}

function compileLangGraph(compiled: CompiledFlowDefinition): RuntimeLangGraph {
  type RuntimeLangGraphBuilder = {
    addNode(
      id: string,
      action: (state: RuntimeLangGraphState) => Promise<RuntimeLangGraphState>
    ): RuntimeLangGraphBuilder;
    addEdge(source: string, target: string): RuntimeLangGraphBuilder;
    compile(): unknown;
  };

  const RuntimeAnnotation = Annotation.Root({
    state: Annotation<KotikitGraphState>({
      reducer: (_left, right) => right,
      default: () => ({
        schemaVersion: KOTIKIT_GRAPH_STATE_SCHEMA_VERSION,
        runId: "uninitialized",
        flowId: "uninitialized",
        flowVersion: "0.0.0",
        graphHash: "uninitialized",
        status: "running",
        project: { root: "." },
        artifacts: [],
        errors: [],
      }),
    }),
    nodeOutput: Annotation<RuntimeNodeOutput | undefined>({
      reducer: (_left, right) => right,
      default: () => undefined,
    }),
    nodeId: Annotation<string | undefined>({
      reducer: (_left, right) => right,
      default: () => undefined,
    }),
    params: Annotation<unknown>({
      reducer: (_left, right) => right,
      default: () => undefined,
    }),
  });
  let graph = new StateGraph(RuntimeAnnotation) as unknown as RuntimeLangGraphBuilder;
  const nodeById = new Map(compiled.nodes.map((node) => [node.id, node]));

  graph = graph.addNode("execute-node", async (state) => {
    const activeNode = nodeById.get(state.nodeId ?? "");
    if (activeNode === undefined) {
      throw new KotikitError("Compiled LangGraph execution is missing runtime node metadata.");
    }
    return {
      ...state,
      nodeOutput: parseRuntimeNodeOutput(
        await activeNode.definition.run({
          nodeId: activeNode.id,
          params: state.params ?? activeNode.manifest.params ?? {},
          state: state.state,
        })
      ),
    };
  });
  graph = graph.addEdge(START, "execute-node");
  graph = graph.addEdge("execute-node", END);

  return graph.compile() as RuntimeLangGraph;
}
