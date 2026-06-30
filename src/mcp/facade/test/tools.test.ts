import { describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RuntimeRunResult } from "../../../core/graph/runtime.js";
import type { Artifact } from "../../../core/schemas/artifact.js";
import type { KotikitGraphState } from "../../../core/schemas/graph-state.js";
import type { ToolContext } from "../../context.js";
import { buildServer, type ToolRegistry } from "../../server.js";
import { FACADE_TOOL_NAMES, type FacadeRuntime, registerFacadeTools } from "../tools.js";

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (): ToolContext => ({
  root: "/tmp/kotikit-facade-test",
  loadConfig: async () => null,
});

async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (handler === undefined) throw new Error(`missing handler ${name}`);
  return handler(args);
}

function detailOf<T>(text: string): T {
  const [, json] = text.split("\n\n");
  if (json === undefined) throw new Error(`missing detail JSON in ${text}`);
  return JSON.parse(json) as T;
}

function makeState(status: KotikitGraphState["status"]): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-1",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "graph-hash",
    status,
    project: { root: "/tmp/kotikit-facade-test" },
    userIntent: "Create a settings screen",
    artifacts: [{ id: "artifact-1", type: "design-brief", schemaVersion: "DesignBrief/v1" }],
    errors: [],
  };
}

const artifact: Artifact = {
  id: "artifact-1",
  runId: "run-1",
  type: "design-brief",
  schemaVersion: "DesignBrief/v1",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  sourceNode: { key: "test.node", version: "1.0.0" },
  payload: { schemaVersion: "DesignBrief/v1", summary: "Brief artifact" },
};

function makeRuntime(): FacadeRuntime {
  return {
    async startFlow(input): Promise<RuntimeRunResult> {
      expect(input).toEqual({
        flowId: "create-screen",
        input: {
          project: { root: "/tmp/kotikit-facade-test" },
          userIntent: "Create a settings screen",
        },
      });
      return { runId: "run-1", status: "waiting-for-user", state: makeState("waiting-for-user") };
    },
    async continueRun(input): Promise<RuntimeRunResult> {
      expect(input).toEqual({ runId: "run-1" });
      return { runId: "run-1", status: "done", state: makeState("done") };
    },
    async answerRun(input): Promise<RuntimeRunResult> {
      expect(input).toEqual({ runId: "run-1", answer: "Use compact desktop density." });
      return { runId: "run-1", status: "done", state: makeState("done") };
    },
    async getRunState(runId): Promise<KotikitGraphState> {
      expect(runId).toBe("run-1");
      return makeState("done");
    },
    async getArtifact(artifactId): Promise<Artifact> {
      expect(artifactId).toBe("artifact-1");
      return artifact;
    },
    async listArtifacts(runId): Promise<Artifact[]> {
      expect(runId).toBe("run-1");
      return [artifact];
    },
  };
}

describe("MCP facade tools", () => {
  it("server registers facade tools before compatibility tools", () => {
    const { registry } = buildServer();
    const names = registry.tools.map((tool) => tool.name);

    expect(names.slice(0, FACADE_TOOL_NAMES.length)).toEqual([...FACADE_TOOL_NAMES]);
    expect(names).toContain("kotikit_workflow_start");
    expect(names.filter((name) => name === "kotikit_doctor")).toHaveLength(1);
  });

  it("lists compact built-in flow summaries", async () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx());

    const result = await callTool(registry, "kotikit_flow_list", {});
    const detail = detailOf<{ flows: Record<string, unknown>[] }>(result.content[0]?.text ?? "");
    const createScreen = detail.flows.find((flow) => flow.id === "create-screen");

    expect(result.isError).toBeFalsy();
    expect(detail.flows.length).toBeGreaterThanOrEqual(7);
    expect(createScreen?.title).toBe("Create Screen");
    expect(createScreen).not.toHaveProperty("nodes");
    expect(createScreen).not.toHaveProperty("edges");
  });

  it("validates a built-in flow by id", async () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx());

    const result = await callTool(registry, "kotikit_flow_validate", { flowId: "create-screen" });
    const detail = detailOf<{ valid: boolean; flow: { id: string } }>(
      result.content[0]?.text ?? ""
    );

    expect(result.isError).toBeFalsy();
    expect(detail.valid).toBe(true);
    expect(detail.flow.id).toBe("create-screen");
  });

  it("exposes discoverable schemas for facade compatibility aliases", () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx());
    const applyTool = registry.tools.find((tool) => tool.name === "kotikit_record_figma_apply");
    const reviewTool = registry.tools.find((tool) => tool.name === "kotikit_review_figma_target");

    expect(applyTool?.inputSchema.required).toEqual(["scope", "stepIndex", "outcome"]);
    expect(applyTool?.inputSchema.properties).toHaveProperty("figmaNodeId");
    expect(reviewTool?.inputSchema.properties).toHaveProperty("figmaUrl");
    expect(reviewTool?.inputSchema.properties).toHaveProperty("fileKey");
    expect(reviewTool?.inputSchema.properties).toHaveProperty("nodeId");
  });

  it("advertises required nested project root for kotikit_start", () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx());
    const startTool = registry.tools.find((tool) => tool.name === "kotikit_start");
    const inputSchema = startTool?.inputSchema.properties?.input as
      | { properties?: Record<string, unknown> }
      | undefined;
    const projectSchema = inputSchema?.properties?.project as { required?: string[] } | undefined;

    expect(projectSchema?.required).toEqual(["root"]);
  });

  it("starts a flow through the injected runtime", async () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime: makeRuntime() });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "create-screen",
      input: { userIntent: "Create a settings screen" },
    });
    const detail = detailOf<{ runId: string; status: string }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.runId).toBe("run-1");
    expect(detail.status).toBe("waiting-for-user");
  });

  it("answers a paused run through the injected runtime", async () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime: makeRuntime() });

    const result = await callTool(registry, "kotikit_answer", {
      runId: "run-1",
      answer: "Use compact desktop density.",
    });
    const detail = detailOf<{ runId: string; status: string }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.runId).toBe("run-1");
    expect(detail.status).toBe("done");
  });

  it("returns one artifact through the injected runtime", async () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime: makeRuntime() });

    const result = await callTool(registry, "kotikit_get_artifact", { artifactId: "artifact-1" });
    const detail = detailOf<{ artifact: Artifact }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.artifact.id).toBe("artifact-1");
    expect(detail.artifact.payload).toEqual({
      schemaVersion: "DesignBrief/v1",
      summary: "Brief artifact",
    });
  });
});
