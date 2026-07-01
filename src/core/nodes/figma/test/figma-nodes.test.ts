import { describe, expect, it } from "bun:test";
import { ArtifactSchema } from "../../../schemas/artifact.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { figmaNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: { status: "waiting-for-figma" };
  artifacts?: unknown[];
};
type StatePatch = Partial<KotikitGraphState> & Record<string, unknown>;

describe("figma graph nodes", () => {
  it("ensures a safe draft target before Figma writes", async () => {
    await expect(runNode("figma.ensureDraftTarget", {})).rejects.toThrow("draft page target");

    const result = await runNode("figma.ensureDraftTarget", { figmaTarget: draftTarget() });
    expect(result.statePatch?.figmaTarget).toMatchObject({ fileKey: "FILE", pageId: "1:2" });
  });

  it("waits for official Figma MCP apply metadata", async () => {
    const result = await runNode("figma.waitForApplyMetadata", {
      draftPlan: { applyPacket: { target: draftTarget() } },
    });

    expect(result.interrupt).toEqual({ status: "waiting-for-figma" });
  });

  it("records apply metadata only when file, page, and section match", async () => {
    await expect(
      runNode("figma.recordApplyMetadata", {
        figmaTarget: draftTarget(),
        applyMetadata: {
          fileKey: "OTHER",
          pageId: "1:2",
          sectionName: "kotikit / members / 2026-06-30",
        },
      })
    ).rejects.toThrow("different Figma file");

    const result = await runNode("figma.recordApplyMetadata", {
      figmaTarget: draftTarget(),
      applyMetadata: {
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-06-30",
        nodes: [{ id: "node-1", componentKey: "button-key" }],
      },
    });

    expect(result.statePatch?.applyReport).toMatchObject({
      schemaVersion: "FigmaApplyReport/v1",
      status: "recorded",
      nodes: [expect.objectContaining({ id: "node-1", componentKey: "button-key" })],
    });
  });

  it("preserves all apply metadata required by draft invariant verification", async () => {
    const result = await runNode("figma.recordApplyMetadata", {
      figmaTarget: draftTarget(),
      applyMetadata: {
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-06-30",
        nodes: [
          {
            id: "node-1",
            partId: "email-input",
            componentKey: "draft:email-input",
            draftComponentId: "draft-email-input",
          },
        ],
        variableBindings: [
          { targetId: "email-input", property: "fill", source: "approved-literal" },
        ],
        layoutFrames: [{ id: "root", mode: "auto-layout", direction: "vertical" }],
        repeatedItems: [{ id: "members", instances: ["row-key"] }],
        textTransforms: [{ id: "email-label", transform: "none" }],
        states: [{ stateId: "members-loading", representation: "region-state" }],
        draftComponentInstances: [{ draftComponentId: "draft-email-input", nodeId: "node-1" }],
        draftComponentPlacements: [{ draftComponentId: "draft-email-input", sectionName: "draft" }],
      },
    });

    expect(result.statePatch?.applyReport).toMatchObject({
      nodes: [expect.objectContaining({ draftComponentId: "draft-email-input" })],
      variableBindings: [expect.objectContaining({ targetId: "email-input" })],
      layoutFrames: [expect.objectContaining({ id: "root" })],
      repeatedItems: [expect.objectContaining({ id: "members" })],
      textTransforms: [expect.objectContaining({ id: "email-label" })],
      states: [expect.objectContaining({ stateId: "members-loading" })],
      draftComponentInstances: [expect.objectContaining({ draftComponentId: "draft-email-input" })],
      draftComponentPlacements: [
        expect.objectContaining({ draftComponentId: "draft-email-input" }),
      ],
    });
  });

  it("verifies draft invariants after apply", async () => {
    await expect(
      runNode("figma.verifyDraftInvariants", {
        figmaTarget: draftTarget(),
        applyReport: {
          schemaVersion: "FigmaApplyReport/v1",
          status: "recorded",
          fileKey: "FILE",
          pageId: "1:2",
          sectionName: "wrong section",
        },
      })
    ).rejects.toThrow("outside the kotikit-owned draft section");

    await expect(
      runNode("figma.verifyDraftInvariants", {
        figmaTarget: draftTarget(),
        draftPlan: {
          applyPacket: applyPacket(),
        },
        applyReport: {
          schemaVersion: "FigmaApplyReport/v1",
          status: "recorded",
          fileKey: "FILE",
          pageId: "1:2",
          sectionName: "kotikit / members / 2026-06-30",
          nodes: [{ id: "node-1", partId: "button", componentKey: "wrong-key" }],
          variableBindings: [],
          layoutFrames: [],
        },
      })
    ).rejects.toThrow("component key");

    await expect(
      runNode("figma.verifyDraftInvariants", {
        figmaTarget: draftTarget(),
        draftPlan: {
          applyPacket: applyPacket(),
        },
        applyReport: {
          schemaVersion: "FigmaApplyReport/v1",
          status: "recorded",
          fileKey: "FILE",
          pageId: "1:2",
          sectionName: "kotikit / members / 2026-06-30",
          nodes: [{ id: "node-1", partId: "button", componentKey: "button-key" }],
          variableBindings: [
            { targetId: "button", property: "fill", source: "variable", name: "color.bg" },
          ],
          layoutFrames: [{ id: "root", mode: "auto-layout", direction: "vertical" }],
          repeatedItems: [{ id: "members", instances: ["wrong-row-key"] }],
          textTransforms: [{ id: "button-label", transform: "none" }],
        },
      })
    ).rejects.toThrow("repeated item structure");
  });

  it("saves apply reports with applied node metadata", async () => {
    const result = await runNode("figma.saveApplyReport", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        status: "recorded",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-06-30",
        nodes: [{ id: "node-1", partId: "button", componentKey: "button-key" }],
        states: [{ stateId: "members-loading", representation: "region-state" }],
        draftComponentInstances: [{ draftComponentId: "draft-button", nodeId: "node-1" }],
        draftComponentPlacements: [{ draftComponentId: "draft-button", sectionName: "draft" }],
      },
    });

    expect(() => ArtifactSchema.parse(result.artifacts?.[0])).not.toThrow();
    expect(result.artifacts?.[0]).toMatchObject({
      type: "figma-apply-report",
      payload: {
        schemaVersion: "FigmaApplyReport/v1",
        data: {
          status: "recorded",
          nodes: [{ id: "node-1", partId: "button", componentKey: "button-key" }],
          states: [{ stateId: "members-loading", representation: "region-state" }],
          draftComponentInstances: [{ draftComponentId: "draft-button", nodeId: "node-1" }],
          draftComponentPlacements: [{ draftComponentId: "draft-button", sectionName: "draft" }],
        },
      },
    });
  });
});

async function runNode(key: string, patch: StatePatch): Promise<NodeOutput> {
  const node = figmaNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: StatePatch): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-figma",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/kotikit" },
    artifacts: [],
    errors: [],
    ...patch,
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

function applyPacket(): Record<string, unknown> {
  return {
    schemaVersion: "FigmaApplyPacket/v1",
    mode: "official-figma-mcp",
    target: draftTarget(),
    screenTitle: "Members",
    uiComposition: {
      schemaVersion: "UICompositionContract/v1",
      parts: [
        {
          id: "button",
          name: "primary button",
          role: "primary-action",
          source: "existing-component",
          componentKey: "button-key",
        },
      ],
    },
    layoutContract: {
      schemaVersion: "LayoutContract/v1",
      strategy: "auto-layout",
      frames: [{ id: "root", name: "Root", mode: "auto-layout", direction: "vertical" }],
    },
    variableBindingPlan: {
      schemaVersion: "VariableBindingPlan/v1",
      bindings: [{ targetId: "button", property: "fill", source: "variable", name: "color.bg" }],
    },
    steps: [],
    repeatedItems: [{ id: "members", instances: ["row-key"] }],
    textTransforms: [{ id: "button-label", transform: "none" }],
    metadata: {
      requiresApplyMetadata: true,
      verifyComponentRefs: true,
      verifyVariables: true,
      verifyAutoLayout: true,
    },
  };
}
