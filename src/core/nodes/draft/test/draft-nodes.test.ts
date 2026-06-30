import { describe, expect, it } from "bun:test";
import { ArtifactSchema } from "../../../schemas/artifact.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { draftNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: unknown[];
};

describe("draft graph nodes", () => {
  it("refuses guided/deep apply packets without an approved brief", async () => {
    await expect(
      runNode("draft.buildFigmaApplyPacket", {
        brief: { lane: "guided", approved: false },
        figmaTarget: draftTarget(),
        draftPlan: { steps: [] },
      })
    ).rejects.toThrow("approved brief");
  });

  it("allows quick high-fidelity packets from a screen blueprint and assumptions", async () => {
    const result = await runNode("draft.buildFigmaApplyPacket", {
      brief: { lane: "quick", assumptions: ["Use existing design-system components first."] },
      screen: { title: "Members", requiredUiParts: ["primary button"] },
      uiComposition: composition(),
      layoutContract: layout(),
      variableBindingPlan: { schemaVersion: "VariableBindingPlan/v1", bindings: [] },
      figmaTarget: draftTarget(),
      draftPlan: {
        steps: [{ kind: "place-component", componentName: "Button" }],
        repeatedItems: [{ id: "members", instances: ["row-key"] }],
        textTransforms: [{ id: "button-label", transform: "none" }],
      },
    });

    expect(result.statePatch?.draftPlan).toMatchObject({
      applyPacket: expect.objectContaining({
        mode: "official-figma-mcp",
        target: expect.objectContaining({ fileKey: "FILE" }),
        repeatedItems: [{ id: "members", instances: ["row-key"] }],
        textTransforms: [{ id: "button-label", transform: "none" }],
      }),
    });
  });

  it("emits a graph apply-packet artifact with legacy scope metadata", async () => {
    const result = await runNode("draft.buildFigmaApplyPacket", {
      brief: { lane: "quick", assumptions: ["Use existing design-system components first."] },
      screen: {
        title: "Members",
        scope: "admin",
        slug: "members",
        requiredUiParts: ["primary button"],
      },
      uiComposition: composition(),
      layoutContract: layout(),
      variableBindingPlan: { schemaVersion: "VariableBindingPlan/v1", bindings: [] },
      figmaTarget: draftTarget(),
      draftPlan: { steps: [{ kind: "place-component", componentName: "Button" }] },
    });

    expect(() => ArtifactSchema.parse(result.artifacts?.[0])).not.toThrow();
    expect(result.artifacts?.[0]).toMatchObject({
      id: "run-draft-figma-apply-packet",
      runId: "run-draft",
      type: "figma-apply-packet",
      schemaVersion: "FigmaApplyPacket/v1",
      sourceNode: { key: "draft.buildFigmaApplyPacket", version: "1.0.0" },
      payload: {
        schemaVersion: "FigmaApplyPacket/v1",
        data: {
          scope: "admin",
          screen: "members",
          mode: "official-figma-mcp",
          targetFileKey: "FILE",
          targetPageId: "1:2",
          targetSectionName: "kotikit / members / 2026-06-30",
          components: [
            {
              partId: "button",
              name: "primary button",
              source: "existing-component",
              componentKey: "button-key",
            },
          ],
          variableBindings: [],
          layoutFrames: [{ id: "root", mode: "auto-layout", direction: "vertical" }],
        },
      },
    });
  });

  it("refuses Figma write packets without a safe draft page target", async () => {
    await expect(
      runNode("draft.buildFigmaApplyPacket", {
        brief: { lane: "quick", assumptions: ["fast path"] },
        screen: { title: "Members", requiredUiParts: ["primary button"] },
        uiComposition: composition(),
        layoutContract: layout(),
        variableBindingPlan: { schemaVersion: "VariableBindingPlan/v1", bindings: [] },
        draftPlan: { steps: [] },
      })
    ).rejects.toThrow("draft page target");
  });

  it("compiles a high-fidelity draft plan from contracts", async () => {
    const result = await runNode("draft.compileHighFidelityDraft", {
      screen: { title: "Members", states: ["loading", "empty", "error", "filled"] },
      uiComposition: composition(),
      layoutContract: layout(),
      variableBindingPlan: { schemaVersion: "VariableBindingPlan/v1", bindings: [] },
    });

    expect(result.statePatch?.draftPlan).toMatchObject({
      schemaVersion: "DraftPlan/v1",
      fidelity: "high",
      states: ["loading", "empty", "error", "filled"],
    });
  });
});

async function runNode(key: string, patch: Partial<KotikitGraphState>): Promise<NodeOutput> {
  const node = draftNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-draft",
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

function composition(): NonNullable<KotikitGraphState["uiComposition"]> {
  return {
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
  };
}

function layout(): NonNullable<KotikitGraphState["layoutContract"]> {
  return {
    schemaVersion: "LayoutContract/v1",
    strategy: "auto-layout",
    frames: [{ id: "root", name: "Root", mode: "auto-layout", direction: "vertical" }],
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
