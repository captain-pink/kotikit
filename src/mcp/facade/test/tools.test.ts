import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { writeConfig } from "../../../config/load.js";
import { defaultConfig } from "../../../config/schema.js";
import type { RuntimeRunResult } from "../../../core/graph/runtime.js";
import type { Artifact } from "../../../core/schemas/artifact.js";
import type { FlowDefinition } from "../../../core/schemas/flow-definition.js";
import type { KotikitGraphState } from "../../../core/schemas/graph-state.js";
import type { ToolContext } from "../../context.js";
import { buildServer, type ToolRegistry } from "../../server.js";
import { FACADE_TOOL_NAMES, type FacadeRuntime, registerFacadeTools } from "../tools.js";

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (): ToolContext => ({
  root: "/tmp/kotikit-facade-test",
  loadConfig: async () => null,
});

const tmpDirs: string[] = [];

afterAll(() => {
  tmpDirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
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

function draftTarget(): NonNullable<KotikitGraphState["figmaTarget"]> {
  return {
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
    async patchRunState(input): Promise<RuntimeRunResult> {
      expect(input).toMatchObject({
        runId: "run-1",
        statePatch: {
          applyMetadata: {
            fileKey: "FILE",
            pageId: "1:2",
            sectionName: "kotikit / members / 2026-06-30",
          },
        },
      });
      return {
        runId: "run-1",
        status: "waiting-for-figma",
        state: {
          ...makeState("waiting-for-figma"),
          applyMetadata: input.statePatch.applyMetadata,
        },
      };
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

  it("buildServer wires the graph runtime for real MCP sessions", async () => {
    const root = mkProject();
    const { registry } = buildServer({ root });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "create-screen",
      input: {
        userIntent: "Create a members table screen.",
      },
    });
    const text = result.content[0]?.text ?? "";

    expect(text).not.toContain("graph runtime is not wired");
    expect(text).toContain("runId");
  });

  it("buildServer exposes trusted project flows in real MCP sessions", async () => {
    const root = mkProject();
    const flow = projectFlow();
    writeProjectFlow(root, flow);
    await writeConfig(root, {
      ...defaultConfig(),
      flowPacks: {
        projectFlowsEnabled: true,
        allowedProjectCapabilities: ["designSystem.search.local"],
        extensions: [],
      },
    });
    const { registry } = buildServer({ root });

    const result = await callTool(registry, "kotikit_flow_list", {});
    const detail = detailOf<{ flows: { id: string; title: string; nodes?: unknown[] }[] }>(
      result.content[0]?.text ?? ""
    );
    const project = detail.flows.find((candidate) => candidate.id === flow.id);

    expect(project).toMatchObject({
      id: flow.id,
      title: flow.title,
    });
    expect(project).not.toHaveProperty("nodes");
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
    expect(applyTool?.inputSchema.properties).toHaveProperty("runId");
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

  it("starts a flow with an initial Figma draft target", async () => {
    let startInput: RuntimeRunResult | undefined;
    const runtime = {
      ...makeRuntime(),
      async startFlow(input): Promise<RuntimeRunResult> {
        expect(input.input.figmaTarget).toMatchObject({
          fileKey: "FILE",
          pageId: "1:2",
        });
        startInput = {
          runId: "run-1",
          status: "waiting-for-user",
          state: { ...makeState("waiting-for-user"), figmaTarget: input.input.figmaTarget },
        };
        return startInput;
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "create-screen",
      input: {
        userIntent: "Create a settings screen",
        figmaTarget: draftTarget(),
      },
    });
    const detail = detailOf<{ runId: string; status: string }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.runId).toBe("run-1");
    expect(startInput?.state.figmaTarget).toMatchObject({ pageName: "Draft - Members" });
  });

  it("starts review flows with seeded review and design-system context", async () => {
    let captured: unknown;
    const runtime = {
      ...makeRuntime(),
      async startFlow(input): Promise<RuntimeRunResult> {
        captured = input.input;
        return {
          runId: "run-1",
          status: "running",
          state: {
            ...makeState("running"),
            review: input.input.review,
            designSystem: input.input.designSystem,
          },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "improve-existing-design",
      input: {
        figmaTarget: draftTarget(),
        review: { target: { fileKey: "FILE", nodeId: "1:2" }, evidence: { regions: [] } },
        designSystem: { components: [{ name: "Button", key: "button-key" }] },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured).toMatchObject({
      review: { target: { fileKey: "FILE", nodeId: "1:2" } },
      designSystem: { components: [{ name: "Button", key: "button-key" }] },
    });
  });

  it("binds a Figma draft target into an active graph run", async () => {
    let patchedTarget: unknown;
    const runtime = {
      ...makeRuntime(),
      async patchRunState(input): Promise<RuntimeRunResult> {
        patchedTarget = input.statePatch.figmaTarget;
        return {
          runId: "run-1",
          status: "running",
          state: { ...makeState("running"), figmaTarget: patchedTarget },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_bind_figma_target", {
      runId: "run-1",
      target: draftTarget(),
    });
    const detail = detailOf<{ runId: string; status: string }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.runId).toBe("run-1");
    expect(patchedTarget).toMatchObject({ fileKey: "FILE", pageId: "1:2" });
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

  it("records Figma apply metadata into a graph run when runId is supplied", async () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime: makeRuntime() });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      figmaFileKey: "FILE",
      figmaPageId: "1:2",
      figmaSectionName: "kotikit / members / 2026-06-30",
      figmaNodeId: "node-1",
      figmaNodeName: "Button",
      componentName: "primary button",
      dsKey: "button-key",
      variableBindings: [{ targetId: "button", property: "fill", source: "variable" }],
      layoutFrames: [{ id: "root", mode: "auto-layout" }],
    });
    const detail = detailOf<{ runId: string; status: string }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.runId).toBe("run-1");
    expect(detail.status).toBe("waiting-for-figma");
  });

  it("records draft component origin metadata into graph apply metadata", async () => {
    let applyMetadata: Record<string, unknown> | undefined;
    const runtime = {
      ...makeRuntime(),
      async patchRunState(input): Promise<RuntimeRunResult> {
        applyMetadata = input.statePatch.applyMetadata as Record<string, unknown>;
        return {
          runId: "run-1",
          status: "waiting-for-figma",
          state: {
            ...makeState("waiting-for-figma"),
            applyMetadata,
          },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      figmaFileKey: "FILE",
      figmaPageId: "1:2",
      figmaSectionName: "kotikit / members / 2026-06-30",
      figmaNodeId: "node-1",
      figmaNodeName: "Email Input",
      partId: "email-input",
      draftComponentId: "draft-email-input",
      componentName: "email input",
      dsKey: "draft:email-input",
    });

    expect(applyMetadata?.nodes).toEqual([
      expect.objectContaining({
        partId: "email-input",
        draftComponentId: "draft-email-input",
        componentKey: "draft:email-input",
      }),
    ]);
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

function mkProject(): string {
  const root = mkdtempSync(join(tmpdir(), "kotikit-facade-"));
  tmpDirs.push(root);
  return root;
}

function writeProjectFlow(root: string, flow: FlowDefinition): void {
  const dir = join(root, ".kotikit", "flows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${flow.id}.flow.json`), `${JSON.stringify(flow, null, 2)}\n`);
}

function projectFlow(): FlowDefinition {
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
  };
}
