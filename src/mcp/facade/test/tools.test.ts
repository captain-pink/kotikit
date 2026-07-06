import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { writeConfig } from "../../../config/load.js";
import { type Config, defaultConfig } from "../../../config/schema.js";
import type { RuntimeRunResult } from "../../../core/graph/runtime.js";
import type { Artifact } from "../../../core/schemas/artifact.js";
import type { FlowDefinition } from "../../../core/schemas/flow-definition.js";
import type { KotikitGraphState } from "../../../core/schemas/graph-state.js";
import type { ToolContext } from "../../context.js";
import { buildServer, type ToolRegistry } from "../../server.js";
import { FACADE_TOOL_NAMES, type FacadeRuntime, registerFacadeTools } from "../tools.js";

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (
  config: Config | null = null,
  root: string = "/tmp/kotikit-facade-test"
): ToolContext => ({
  root,
  loadConfig: async () => config,
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

function activeFigmaTransaction(
  transactionId: string
): NonNullable<KotikitGraphState["activeFigmaTransaction"]> {
  return {
    id: transactionId,
    order: 1,
    kind: "create-screen-state",
    label: "Members / Filled",
    placementId: "state-filled",
    stateId: "filled",
    requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
  };
}

function transactionPlan(
  transactionId: string,
  status: "pending" | "active" | "recorded" | "failed"
): NonNullable<KotikitGraphState["figmaTransactionPlan"]> {
  return {
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions: [
      {
        id: transactionId,
        order: 1,
        kind: "create-screen-state",
        label: "Members / Filled",
        placementId: "state-filled",
        stateId: "filled",
        status,
        requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
      },
    ],
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

function figmaWritePreflight(
  transactionId = "txn-active"
): NonNullable<KotikitGraphState["figmaWritePreflight"]> {
  return {
    schemaVersion: "FigmaWritePreflight/v1",
    id: `figma-preflight:run-1:${transactionId}`,
    runId: "run-1",
    transactionId,
    fileKey: "FILE",
    pageId: "1:2",
    pageName: "Draft - Members",
    sectionName: "kotikit / members / 2026-06-30",
    issuedAt: "2026-07-04T10:00:00.000Z",
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
          figmaDefaults: {
            section: {
              background: {
                color: "AED0FF",
                opacity: 0.1,
              },
            },
          },
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
    expect(names).not.toContain("kotikit_workflow_start");
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
    const reviewScreen = detail.flows.find((flow) => flow.id === "review-screen");

    expect(result.isError).toBeFalsy();
    expect(detail.flows.map((flow) => flow.id)).toEqual([
      "create-screen",
      "refine-existing",
      "review-screen",
    ]);
    expect(createScreen?.title).toBe("Create Screen");
    expect(reviewScreen?.title).toBe("Review Screen");
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

    expect(applyTool?.inputSchema.required).toEqual([
      "runId",
      "scope",
      "stepIndex",
      "outcome",
      "transactionId",
      "preflightId",
    ]);
    expect(applyTool?.inputSchema.properties).toHaveProperty("figmaNodeId");
    expect(applyTool?.inputSchema.properties).toHaveProperty("runId");
    expect(registry.tools.map((tool) => tool.name)).not.toContain("kotikit_review_figma_target");
  });

  it("exposes incremental Figma apply metadata in the record tool schema", () => {
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx());
    const applyTool = registry.tools.find((tool) => tool.name === "kotikit_record_figma_apply");

    expect(applyTool?.inputSchema.properties).toHaveProperty("preflightId");
    expect(applyTool?.inputSchema.properties).toHaveProperty("transactionId");
    expect(applyTool?.inputSchema.properties).toHaveProperty("bounds");
    expect(applyTool?.inputSchema.properties).toHaveProperty("componentRefs");
    expect(applyTool?.inputSchema.properties).toHaveProperty("componentSource");
    expect(applyTool?.inputSchema.properties).toHaveProperty("figmaNodeKind");
    expect(applyTool?.inputSchema.properties).toHaveProperty("componentKey");
    expect(applyTool?.inputSchema.properties).toHaveProperty("variableRefs");
    expect(applyTool?.inputSchema.properties).toHaveProperty("iconRefs");
    expect(applyTool?.inputSchema.properties).toHaveProperty("iconPlaceholder");
    expect(applyTool?.inputSchema.properties).toHaveProperty("representation");
    expect(applyTool?.inputSchema.properties).toHaveProperty("autoLayout");
    expect(applyTool?.inputSchema.properties).toHaveProperty("nodes");
    expect(applyTool?.inputSchema.properties).toHaveProperty("evidenceSnapshot");
    expect(applyTool?.inputSchema.properties?.figmaNodeKind).not.toHaveProperty("enum");
  });

  it("prepares a Figma write preflight for the active transaction", async () => {
    let patchedPreflight: unknown;
    const runtime = {
      ...makeRuntime(),
      async getRunState(runId): Promise<KotikitGraphState> {
        expect(runId).toBe("run-1");
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          activeFigmaTransaction: activeFigmaTransaction("txn-active"),
        };
      },
      async patchRunState(input): Promise<RuntimeRunResult> {
        patchedPreflight = input.statePatch.figmaWritePreflight;
        return {
          runId: "run-1",
          status: "waiting-for-figma",
          state: {
            ...makeState("waiting-for-figma"),
            figmaTarget: draftTarget(),
            activeFigmaTransaction: activeFigmaTransaction("txn-active"),
            figmaWritePreflight: input.statePatch.figmaWritePreflight,
          },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_prepare_figma_write", {
      runId: "run-1",
      transactionId: "txn-active",
    });
    const detail = detailOf<{
      preflight: {
        id: string;
        transactionId: string;
        fileKey: string;
        pageId: string;
        pageName: string;
        sectionName: string;
      };
    }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(detail.preflight).toMatchObject({
      transactionId: "txn-active",
      fileKey: "FILE",
      pageId: "1:2",
      pageName: "Draft - Members",
      sectionName: "kotikit / members / 2026-06-30",
    });
    expect(patchedPreflight).toMatchObject({ id: detail.preflight.id });
  });

  it("records incremental transaction metadata into graph apply metadata", async () => {
    let applyMetadata: Record<string, unknown> | undefined;
    const runtime = {
      ...makeRuntime(),
      async getRunState(runId): Promise<KotikitGraphState> {
        expect(runId).toBe("run-1");
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-filled"),
          activeFigmaTransaction: {
            id: "txn-filled",
            order: 1,
            kind: "create-screen-state",
            label: "Members / Filled",
            placementId: "state-filled",
            stateId: "filled",
            requiredMetadata: [
              "node-id",
              "bounds",
              "auto-layout",
              "component-refs",
              "variable-refs",
            ],
          },
        };
      },
      async patchRunState(input): Promise<RuntimeRunResult> {
        applyMetadata = input.statePatch.applyMetadata as Record<string, unknown>;
        return {
          runId: "run-1",
          status: "waiting-for-figma",
          state: {
            ...makeState("waiting-for-figma"),
            figmaTarget: draftTarget(),
            figmaWritePreflight: figmaWritePreflight("txn-filled"),
            activeFigmaTransaction: activeFigmaTransaction("txn-filled"),
            figmaTransactionPlan: transactionPlan("txn-filled", "active"),
            applyMetadata,
          },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-filled",
      preflightId: "figma-preflight:run-1:txn-filled",
      figmaFileKey: "FILE",
      figmaPageId: "1:2",
      figmaSectionName: "kotikit / members / 2026-06-30",
      figmaNodeId: "node-1",
      figmaNodeName: "Members / Filled",
      figmaNodeKind: "frame",
      bounds: { x: 560, y: 0, width: 1440, height: 900 },
      representation: "region-state",
      componentRefs: ["button-key"],
      variableRefs: ["var-color-primary"],
      componentSource: "existing-component",
      iconRefs: ["icon-add-user-key"],
      iconKey: "icon-add-user-key",
      autoLayout: true,
      nodes: [
        {
          id: "node-2",
          name: "Primary action",
          kind: "instance",
          partId: "primary-action",
          draftComponentId: "draft-primary-action",
          componentSource: "draft-component",
          bounds: { x: 1200, y: 72, width: 160, height: 40 },
          componentRefs: ["draft-primary-action"],
          variableRefs: ["var-color-primary"],
          iconPlaceholder: true,
          autoLayout: true,
        },
      ],
      evidenceSnapshot: {
        schemaVersion: "FigmaEvidenceSnapshot/v1",
        transactionId: "txn-filled",
        parts: [
          {
            partId: "primary-action",
            nodeId: "node-2",
            nodeType: "INSTANCE",
            source: "existing-ds-component",
            isInstance: true,
            mainComponentKey: "button-key",
            effectiveVisible: true,
            effectiveOpacity: 1,
            insideRoot: true,
            bounds: { x: 1200, y: 72, width: 160, height: 40 },
          },
        ],
      },
    });
    const detail = detailOf<{
      activeFigmaTransaction?: { id: string };
      figmaTransactionProgress?: { active: number };
    }>(result.content[0]?.text ?? "");

    expect(applyMetadata).toMatchObject({
      transactionId: "txn-filled",
      bounds: { x: 560, y: 0, width: 1440, height: 900 },
      representation: "region-state",
      componentRefs: ["button-key"],
      variableRefs: ["var-color-primary"],
      componentSource: "existing-component",
      iconRefs: ["icon-add-user-key"],
      iconKey: "icon-add-user-key",
      autoLayout: true,
      evidenceSnapshot: expect.objectContaining({
        schemaVersion: "FigmaEvidenceSnapshot/v1",
        transactionId: "txn-filled",
      }),
    });
    expect(applyMetadata?.nodes).toEqual([
      expect.objectContaining({
        id: "node-1",
        kind: "frame",
        componentSource: "existing-component",
        iconRefs: ["icon-add-user-key"],
      }),
      expect.objectContaining({
        id: "node-2",
        draftComponentId: "draft-primary-action",
        componentSource: "draft-component",
        iconPlaceholder: true,
        bounds: { x: 1200, y: 72, width: 160, height: 40 },
      }),
    ]);
    expect(detail.activeFigmaTransaction?.id).toBe("txn-filled");
    expect(detail.figmaTransactionProgress?.active).toBe(1);
  });

  it("rejects Figma apply records when the run is not waiting for the active transaction", async () => {
    const attempts: Record<string, number> = {};
    const runtime = {
      ...makeRuntime(),
      async getRunState(runId): Promise<KotikitGraphState> {
        attempts.getRunState = (attempts.getRunState ?? 0) + 1;
        expect(runId).toBe("run-1");
        return {
          ...makeState("waiting-for-user"),
          activeFigmaTransaction: {
            id: "txn-active",
            order: 1,
            kind: "create-screen-state",
            label: "Members / Filled",
            placementId: "state-filled",
            requiredMetadata: [],
          },
        };
      },
      async patchRunState(): Promise<RuntimeRunResult> {
        attempts.patchRunState = (attempts.patchRunState ?? 0) + 1;
        throw new Error("patchRunState should not be called");
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-active",
    });

    expect(String(result.content[0]?.text)).toContain("waiting for Figma");
    expect(attempts).toEqual({ getRunState: 1 });
  });

  it("rejects mismatched or unconsumed Figma apply metadata before patching state", async () => {
    const patched: string[] = [];
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          activeFigmaTransaction: {
            id: "txn-active",
            order: 1,
            kind: "create-screen-state",
            label: "Members / Filled",
            placementId: "state-filled",
            requiredMetadata: [],
          },
          applyMetadata: { transactionId: "txn-active" },
        };
      },
      async patchRunState(): Promise<RuntimeRunResult> {
        patched.push("patch");
        throw new Error("patchRunState should not be called");
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const mismatched = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-other",
    });
    const stale = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-active",
    });

    expect(String(mismatched.content[0]?.text)).toContain("active Figma transaction");
    expect(String(stale.content[0]?.text)).toContain("already has unconsumed Figma apply metadata");
    expect(patched).toEqual([]);
  });

  it("rejects Figma apply records without a matching preflight before patching state", async () => {
    const patched: string[] = [];
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-active"),
          activeFigmaTransaction: activeFigmaTransaction("txn-active"),
        };
      },
      async patchRunState(): Promise<RuntimeRunResult> {
        patched.push("patch");
        throw new Error("patchRunState should not be called");
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-active",
      figmaFileKey: "FILE",
      figmaPageId: "1:2",
      figmaSectionName: "kotikit / members / 2026-06-30",
    });

    expect(String(result.content[0]?.text)).toContain("preflight");
    expect(patched).toEqual([]);
  });

  it("rejects Figma apply records outside the bound page before patching state", async () => {
    const patched: string[] = [];
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-active"),
          activeFigmaTransaction: activeFigmaTransaction("txn-active"),
        };
      },
      async patchRunState(): Promise<RuntimeRunResult> {
        patched.push("patch");
        throw new Error("patchRunState should not be called");
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-active",
      preflightId: "figma-preflight:run-1:txn-active",
      figmaFileKey: "FILE",
      figmaPageId: "9:10",
      figmaSectionName: "kotikit / members / 2026-06-30",
    });

    expect(String(result.content[0]?.text)).toContain("outside the bound draft page");
    expect(patched).toEqual([]);
  });

  it("rejects invalid component evidence before patching state so the transaction stays repairable", async () => {
    const patched: string[] = [];
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-active"),
          activeFigmaTransaction: activeFigmaTransaction("txn-active"),
          draftPlan: {
            fidelity: "high",
            applyPacket: {
              uiComposition: {
                parts: [
                  {
                    id: "content-heading",
                    name: "content heading",
                    source: "existing-component",
                    componentKey: "heading-key",
                  },
                ],
              },
              iconRequirements: [],
            },
          } as NonNullable<KotikitGraphState["draftPlan"]>,
        };
      },
      async patchRunState(): Promise<RuntimeRunResult> {
        patched.push("patch");
        throw new Error("patchRunState should not be called");
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-active",
      preflightId: "figma-preflight:run-1:txn-active",
      figmaFileKey: "FILE",
      figmaPageId: "1:2",
      figmaSectionName: "kotikit / members / 2026-06-30",
      figmaNodeId: "node-1",
      figmaNodeKind: "FRAME",
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      componentRefs: ["heading-key"],
      variableRefs: [],
      autoLayout: true,
      evidenceSnapshot: {
        schemaVersion: "FigmaEvidenceSnapshot/v1",
        parts: [
          {
            partId: "content-heading",
            id: "3:3746",
            name: "Page title",
            kind: "TEXT",
            visible: true,
            opacity: 1,
            insideRoot: true,
            bounds: { x: 300, y: 48, width: 240, height: 44 },
          },
        ],
      },
    });

    expect(String(result.content[0]?.text)).toContain(
      'found "Page title" as TEXT for "content heading"'
    );
    expect(patched).toEqual([]);
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

  it("starts flows with seeded design-system context", async () => {
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
            designSystem: input.input.designSystem,
          },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "create-screen",
      input: {
        figmaTarget: draftTarget(),
        designSystem: { components: [{ name: "Button", key: "button-key" }] },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured).toMatchObject({
      designSystem: { components: [{ name: "Button", key: "button-key" }] },
    });
  });

  it("starts flows with structured blueprint, canvas intent, and existing design inventory", async () => {
    let captured: RuntimeRunResult["state"] | undefined;
    const runtime = {
      ...makeRuntime(),
      async startFlow(input): Promise<RuntimeRunResult> {
        captured = {
          ...makeState("running"),
          screenBlueprint: input.input.screenBlueprint,
          canvasIntent: input.input.canvasIntent,
          existingDesignInventory: input.input.existingDesignInventory,
        };
        return {
          runId: "run-1",
          status: "running",
          state: captured,
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "create-screen",
      input: {
        userIntent: "Create the supplied mocked Events Experience PRD.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "events",
          title: "Events Experience",
          productDomain: "Mock Operations",
          requiredUiParts: [{ id: "event-stream", name: "Event stream", role: "timeline" }],
        },
        canvasIntent: {
          mode: "replace-existing-frame",
          targetFrame: { nodeId: "12:34", name: "Existing Events Frame" },
        },
        existingDesignInventory: {
          schemaVersion: "ExistingDesignInventoryInput/v1",
          source: "figma-scan",
          targets: [{ nodeId: "12:34", name: "Existing Events Frame", kind: "frame" }],
        },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured).toMatchObject({
      screenBlueprint: { title: "Events Experience" },
      canvasIntent: { mode: "replace-existing-frame", targetFrame: { nodeId: "12:34" } },
      existingDesignInventory: {
        targets: [expect.objectContaining({ nodeId: "12:34" })],
      },
    });
  });

  it("attaches a compact Figma comment snapshot to a review run", async () => {
    const root = mkProject();
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=test-token\n");
    let seenToken = "";
    let patchedFeedback: unknown;
    const runtime = {
      ...makeRuntime(),
      async patchRunState(input): Promise<RuntimeRunResult> {
        patchedFeedback = input.statePatch.feedback;
        return {
          runId: "run-1",
          status: "running",
          state: { ...makeState("running"), feedback: input.statePatch.feedback },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(null, root), {
      runtime,
      figmaClientFactory: (token) => {
        seenToken = token;
        return {
          async getComments(fileKey, opts) {
            expect(fileKey).toBe("FILE");
            expect(opts).toEqual({ asMarkdown: true });
            return [
              {
                id: "comment-1",
                file_key: "FILE",
                message: "Move the empty state inside the table region.",
                client_meta: { node_id: "node-table", ignored: "large" },
                resolved_at: null,
                user: { handle: "Designer", email: "designer@example.com" },
              },
              {
                id: "comment-1-reply",
                file_key: "FILE",
                parent_id: "comment-1",
                message: "Keep the helper copy concise.",
                client_meta: null,
                resolved_at: null,
              },
              {
                id: "comment-2",
                file_key: "FILE",
                message: "Already handled.",
                resolved_at: "2026-07-02T00:00:00.000Z",
              },
            ];
          },
        };
      },
    });

    const result = await callTool(registry, "kotikit_feedback_snapshot", {
      figmaUrl: "https://www.figma.com/design/FILE/Untitled?node-id=1-2",
      runId: "run-1",
    });
    const detail = detailOf<{
      snapshot: { comments: Record<string, unknown>[]; threads: Record<string, unknown>[] };
      run: { runId: string };
    }>(result.content[0]?.text ?? "");

    expect(result.isError).toBeFalsy();
    expect(seenToken).toBe("test-token");
    expect(detail.snapshot.comments).toEqual([
      expect.objectContaining({
        id: "comment-1",
        message: "Move the empty state inside the table region.",
        client_meta: { node_id: "node-table" },
        user: { handle: "Designer" },
      }),
      expect.objectContaining({
        id: "comment-1-reply",
        parent_id: "comment-1",
        message: "Keep the helper copy concise.",
        client_meta: null,
      }),
    ]);
    expect(detail.snapshot.threads).toEqual([
      expect.objectContaining({
        threadId: "comment-1",
        rootCommentId: "comment-1",
        anchorClientMeta: { nodeId: "node-table" },
        messages: [
          expect.objectContaining({
            commentId: "comment-1",
            message: "Move the empty state inside the table region.",
          }),
          expect.objectContaining({
            commentId: "comment-1-reply",
            parentId: "comment-1",
            message: "Keep the helper copy concise.",
            clientMeta: null,
          }),
        ],
      }),
    ]);
    expect(detail.run.runId).toBe("run-1");
    expect(patchedFeedback).toMatchObject({
      commentSnapshot: {
        fileKey: "FILE",
        comments: [
          expect.objectContaining({ id: "comment-1" }),
          expect.objectContaining({ id: "comment-1-reply" }),
        ],
        threads: [expect.objectContaining({ threadId: "comment-1" })],
      },
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

  it("binds a Figma draft target from an exact draft page URL", async () => {
    const root = mkProject();
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=test-token\n");
    let seenToken = "";
    let patchedTarget: unknown;
    const runtime = {
      ...makeRuntime(),
      async getRunState(runId): Promise<KotikitGraphState> {
        expect(runId).toBe("run-1");
        return {
          ...makeState("waiting-for-figma"),
          screen: { id: "admin-members", title: "Admin Members" },
        };
      },
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
    registerFacadeTools(registry, makeCtx(null, root), {
      runtime,
      figmaClientFactory: (token) => {
        seenToken = token;
        return {
          async getNodes(fileKey, ids) {
            expect(fileKey).toBe("FILE");
            expect(ids).toEqual(["1:2"]);
            return {
              "1:2": {
                document: {
                  id: "1:2",
                  name: "Draft - Admin Members",
                  type: "CANVAS",
                },
              },
            };
          },
        };
      },
    });

    const result = await callTool(registry, "kotikit_bind_figma_target", {
      runId: "run-1",
      pageUrl: "https://www.figma.com/design/FILE/Untitled?node-id=1-2",
    });

    expect(result.isError).toBeFalsy();
    expect(seenToken).toBe("test-token");
    expect(patchedTarget).toMatchObject({
      fileKey: "FILE",
      pageId: "1:2",
      pageName: "Draft - Admin Members",
      pageUrl: "https://www.figma.com/design/FILE/Untitled?node-id=1-2",
      section: { name: expect.stringMatching(/^kotikit \/ admin-members \/ \d{4}-\d{2}-\d{2}$/) },
      source: "user-url",
    });
  });

  it("binds a Figma draft target from a copied frame URL", async () => {
    const root = mkProject();
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=test-token\n");
    let patchedTarget: unknown;
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          screen: { id: "events", title: "Events Experience" },
        };
      },
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
    registerFacadeTools(registry, makeCtx(null, root), {
      runtime,
      figmaClientFactory: () => ({
        async getNodes(fileKey, ids) {
          expect(fileKey).toBe("FILE");
          expect(ids).toEqual(["2:3"]);
          return {
            "2:3": {
              document: {
                id: "2:3",
                name: "Events frame",
                type: "FRAME",
              },
            },
          };
        },
        async getFile(fileKey) {
          expect(fileKey).toBe("FILE");
          return {
            document: {
              children: [
                { id: "0:1", name: "Drafts", type: "CANVAS", children: [] },
                {
                  id: "9:10",
                  name: "Product Flow Draft",
                  type: "CANVAS",
                  children: [{ id: "2:3", name: "Events frame", type: "FRAME" }],
                },
              ],
            },
          };
        },
      }),
    });

    const result = await callTool(registry, "kotikit_bind_figma_target", {
      runId: "run-1",
      pageUrl: "https://www.figma.com/design/FILE/Untitled?node-id=2-3",
    });

    expect(result.isError).toBeFalsy();
    expect(patchedTarget).toMatchObject({
      fileKey: "FILE",
      pageId: "9:10",
      pageName: "Product Flow Draft",
      pageUrl: "https://www.figma.com/design/FILE/Untitled?node-id=9-10",
      sourceNode: { id: "2:3", name: "Events frame", type: "FRAME" },
    });
  });

  it("accepts Figma apply-style aliases when binding a draft target object", async () => {
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
      target: {
        figmaFileKey: "FILE",
        figmaPageId: "1:2",
        figmaPageName: "Draft - Members",
        figmaPageUrl: "https://www.figma.com/design/FILE/Name?node-id=1-2",
        figmaSectionId: "section-1",
        figmaSectionName: "kotikit / members / 2026-06-30",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(patchedTarget).toMatchObject({
      fileKey: "FILE",
      pageId: "1:2",
      section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    });
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
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-legacy"),
          activeFigmaTransaction: activeFigmaTransaction("txn-legacy"),
        };
      },
    } satisfies FacadeRuntime;
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_record_figma_apply", {
      runId: "run-1",
      scope: "members",
      stepIndex: 0,
      outcome: "ok",
      transactionId: "txn-legacy",
      preflightId: "figma-preflight:run-1:txn-legacy",
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
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-draft-email-input"),
          activeFigmaTransaction: activeFigmaTransaction("txn-draft-email-input"),
        };
      },
      async patchRunState(input): Promise<RuntimeRunResult> {
        applyMetadata = input.statePatch.applyMetadata as Record<string, unknown>;
        return {
          runId: "run-1",
          status: "waiting-for-figma",
          state: {
            ...makeState("waiting-for-figma"),
            figmaTarget: draftTarget(),
            figmaWritePreflight: figmaWritePreflight("txn-draft-email-input"),
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
      transactionId: "txn-draft-email-input",
      preflightId: "figma-preflight:run-1:txn-draft-email-input",
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

  it("records real Figma component proof for draft component transactions", async () => {
    let applyMetadata: Record<string, unknown> | undefined;
    const runtime = {
      ...makeRuntime(),
      async getRunState(): Promise<KotikitGraphState> {
        return {
          ...makeState("waiting-for-figma"),
          figmaTarget: draftTarget(),
          figmaWritePreflight: figmaWritePreflight("txn-draft-page-shell"),
          activeFigmaTransaction: activeFigmaTransaction("txn-draft-page-shell"),
        };
      },
      async patchRunState(input): Promise<RuntimeRunResult> {
        applyMetadata = input.statePatch.applyMetadata as Record<string, unknown>;
        return {
          runId: "run-1",
          status: "waiting-for-figma",
          state: {
            ...makeState("waiting-for-figma"),
            figmaTarget: draftTarget(),
            figmaWritePreflight: figmaWritePreflight("txn-draft-page-shell"),
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
      transactionId: "txn-draft-page-shell",
      preflightId: "figma-preflight:run-1:txn-draft-page-shell",
      figmaFileKey: "FILE",
      figmaPageId: "1:2",
      figmaSectionName: "kotikit / members / 2026-06-30",
      figmaNodeId: "3:5",
      figmaNodeName: "draft/page shell",
      figmaNodeKind: "COMPONENT",
      bounds: { x: 120, y: 160, width: 320, height: 117 },
      componentKey: "figma-local-component-key",
      componentSource: "draft-component",
      variableRefs: [],
      autoLayout: true,
      representation: "component-state",
      draftComponentId: "draft-page-shell",
      componentName: "page shell",
    });

    expect(applyMetadata).toMatchObject({
      figmaNodeKind: "COMPONENT",
      componentRefs: ["figma-local-component-key"],
    });
    expect(applyMetadata?.nodes).toEqual([
      expect.objectContaining({
        id: "3:5",
        kind: "COMPONENT",
        componentKey: "figma-local-component-key",
        draftComponentId: "draft-page-shell",
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
