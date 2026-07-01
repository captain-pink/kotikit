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

  it("builds a canvas plan from state matrix and draft components using the target section", async () => {
    const result = await runNode("draft.buildCanvasPlan", {
      screen: { title: "Members" },
      figmaTarget: draftTarget(),
      stateMatrix: stateMatrix(),
      draftComponentPlan: draftComponentPlan(),
    });

    expect(result.statePatch?.canvasPlan).toMatchObject({
      schemaVersion: "CanvasPlan/v1",
      section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
      placements: [
        {
          id: "draft-table-row",
          kind: "draft-component",
          draftComponentId: "table-row",
          transactionId: "txn-draft-table-row",
        },
        {
          id: "state-filled",
          kind: "screen-state",
          stateId: "filled",
          transactionId: "txn-state-filled",
        },
      ],
      strategy: { creationOrder: ["draft-table-row", "state-filled"] },
    });
  });

  it("builds ordered Figma transactions from a canvas plan", async () => {
    const result = await runNode("draft.buildFigmaTransactionPlan", {
      canvasPlan: sampleCanvasPlan(),
    });

    expect(result.statePatch?.figmaTransactionPlan).toMatchObject({
      schemaVersion: "FigmaTransactionPlan/v1",
      transactions: [
        {
          id: "txn-draft-table-row",
          order: 1,
          kind: "create-draft-component",
          placementId: "draft-table-row",
          draftComponentId: "table-row",
          status: "pending",
        },
        {
          id: "txn-state-filled",
          order: 2,
          kind: "create-screen-state",
          placementId: "state-filled",
          stateId: "filled",
          status: "pending",
        },
      ],
    });
  });

  it("allows quick high-fidelity packets from a screen blueprint and assumptions", async () => {
    const result = await runNode("draft.buildFigmaApplyPacket", {
      brief: { lane: "quick", assumptions: ["Use existing design-system components first."] },
      screen: { title: "Members", requiredUiParts: ["primary button"] },
      uiComposition: composition(),
      layoutContract: layout(),
      variableBindingPlan: { schemaVersion: "VariableBindingPlan/v1", bindings: [] },
      canvasPlan: sampleCanvasPlan(),
      figmaTransactionPlan: sampleTransactionPlan(),
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
        canvasPlan: sampleCanvasPlan(),
        transactionPlan: sampleTransactionPlan(),
        repeatedItems: [{ id: "members", instances: ["row-key"] }],
        textTransforms: [{ id: "button-label", transform: "none" }],
        metadata: expect.objectContaining({ incrementalTransactions: true }),
      }),
    });
  });

  it("emits a graph apply-packet artifact with legacy scope metadata and compact plan summaries", async () => {
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
      canvasPlan: sampleCanvasPlan(),
      figmaTransactionPlan: sampleTransactionPlan(),
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
          canvasPlan: {
            sectionName: "kotikit / members / 2026-06-30",
            placementCount: 2,
            zoneCount: 2,
          },
          transactions: [
            {
              id: "txn-draft-table-row",
              order: 1,
              kind: "create-draft-component",
              label: "Table row",
              placementId: "draft-table-row",
              draftComponentId: "table-row",
            },
            {
              id: "txn-state-filled",
              order: 2,
              kind: "create-screen-state",
              label: "Members - Filled",
              placementId: "state-filled",
              stateId: "filled",
            },
          ],
        },
      },
    });
  });

  it("refuses Figma write packets without canvas and transaction plans", async () => {
    await expect(
      runNode("draft.buildFigmaApplyPacket", {
        brief: { lane: "quick", assumptions: ["fast path"] },
        screen: { title: "Members", requiredUiParts: ["primary button"] },
        uiComposition: composition(),
        layoutContract: layout(),
        variableBindingPlan: { schemaVersion: "VariableBindingPlan/v1", bindings: [] },
        figmaTarget: draftTarget(),
        draftPlan: { steps: [] },
      })
    ).rejects.toThrow("missing required UI contracts");
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

function stateMatrix(): NonNullable<KotikitGraphState["stateMatrix"]> {
  return {
    schemaVersion: "StateMatrix/v1",
    states: [
      {
        id: "filled",
        label: "Filled",
        kind: "filled",
        scope: "page",
        persistentRegions: [],
        replacementBehavior: "replace-whole-page",
        requiredComponents: ["table row"],
        sourceRefs: ["https://example.com/states/filled"],
      },
    ],
  };
}

function draftComponentPlan(): NonNullable<KotikitGraphState["draftComponentPlan"]> {
  return {
    schemaVersion: "DraftComponentPlan/v1",
    sectionName: "Kotikit Draft Components",
    components: [{ id: "table-row", name: "Table row", reason: "Missing table row" }],
  };
}

function sampleCanvasPlan(): NonNullable<KotikitGraphState["canvasPlan"]> {
  return {
    schemaVersion: "CanvasPlan/v1",
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    coordinateSpace: "section-relative",
    screenSize: { width: 1440, height: 900 },
    minGap: 160,
    zones: [
      {
        id: "zone-draft-components",
        kind: "draft-components",
        label: "Draft components",
        bounds: { x: 0, y: 0, width: 360, height: 240 },
      },
      {
        id: "zone-screen-states",
        kind: "screen-states",
        label: "Screen states",
        bounds: { x: 560, y: 0, width: 3040, height: 900 },
      },
    ],
    placements: [
      {
        id: "draft-table-row",
        kind: "draft-component",
        draftComponentId: "table-row",
        label: "Table row",
        bounds: { x: 0, y: 0, width: 360, height: 240 },
        parentZoneId: "zone-draft-components",
        transactionId: "txn-draft-table-row",
      },
      {
        id: "state-filled",
        kind: "screen-state",
        stateId: "filled",
        label: "Members - Filled",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
        parentZoneId: "zone-screen-states",
        transactionId: "txn-state-filled",
      },
    ],
    strategy: {
      primaryFirst: true,
      creationOrder: ["draft-table-row", "state-filled"],
      designerNotes: [
        "Draft components stay in the left lane; screen states use a deterministic two-column grid.",
      ],
    },
  };
}

function sampleTransactionPlan(): NonNullable<KotikitGraphState["figmaTransactionPlan"]> {
  return {
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions: [
      {
        id: "txn-draft-table-row",
        order: 1,
        kind: "create-draft-component",
        label: "Table row",
        placementId: "draft-table-row",
        draftComponentId: "table-row",
        status: "pending",
        requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
      },
      {
        id: "txn-state-filled",
        order: 2,
        kind: "create-screen-state",
        label: "Members - Filled",
        placementId: "state-filled",
        stateId: "filled",
        status: "pending",
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
