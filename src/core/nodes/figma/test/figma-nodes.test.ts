import { describe, expect, it } from "bun:test";
import { ArtifactSchema } from "../../../schemas/artifact.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { figmaNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: { status: "waiting-for-figma"; resume?: "same-node" | "next-node" };
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

  it("starts the next pending transaction and waits for same-node Figma metadata", async () => {
    const result = await runNode("figma.applyTransactionQueue", {
      figmaTarget: draftTarget(),
      figmaTransactionPlan: transactionPlan(),
    });

    expect(result.interrupt).toEqual({ status: "waiting-for-figma", resume: "same-node" });
    expect(result.statePatch?.figmaTransactionPlan).toMatchObject({
      transactions: [
        expect.objectContaining({ id: "txn-filled", status: "active" }),
        expect.objectContaining({ id: "txn-empty", status: "pending" }),
      ],
    });
    expect(result.statePatch?.activeFigmaTransaction).toEqual({
      id: "txn-filled",
      order: 1,
      kind: "create-screen-state",
      label: "Members / Filled",
      placementId: "state-filled",
      stateId: "filled",
      requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
    });
    expect(result.statePatch?.activeFigmaTransaction).not.toHaveProperty("status");
  });

  it("recovers a plan-level active transaction without completing unfinished work", async () => {
    const result = await runNode("figma.applyTransactionQueue", {
      figmaTarget: draftTarget(),
      figmaTransactionPlan: singleActiveTransactionPlan(),
    });

    expect(result.interrupt).toEqual({ status: "waiting-for-figma", resume: "same-node" });
    expect(result.statePatch?.activeFigmaTransaction).toEqual(activeTransaction());
    expect(result.statePatch?.activeFigmaTransaction).not.toHaveProperty("status");
    expect(result.statePatch?.applyReport).toBeUndefined();
  });

  it("records metadata for a recovered plan-level active transaction", async () => {
    const result = await runNode("figma.applyTransactionQueue", {
      figmaTarget: draftTarget(),
      figmaTransactionPlan: singleActiveTransactionPlan(),
      applyMetadata: {
        transactionId: "txn-filled",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-06-30",
        figmaNodeId: "9:10",
        figmaNodeName: "Members / Filled",
        figmaNodeKind: "FRAME",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
        componentRefs: ["button-key"],
        variableRefs: ["var-color-primary"],
        autoLayout: true,
      },
    });

    expect(result.interrupt).toBeUndefined();
    expect(result.statePatch?.figmaTransactionPlan).toMatchObject({
      transactions: [expect.objectContaining({ id: "txn-filled", status: "recorded" })],
    });
    expect(result.statePatch?.activeFigmaTransaction).toBeUndefined();
    expect(result.statePatch?.applyReport).toMatchObject({
      schemaVersion: "FigmaApplyReport/v1",
      status: "recorded",
      nodes: [expect.objectContaining({ id: "9:10", transactionId: "txn-filled" })],
    });
  });

  it("records matching active transaction metadata into the ledger and apply report", async () => {
    const result = await runNode("figma.applyTransactionQueue", {
      figmaTarget: draftTarget(),
      figmaTransactionPlan: singleActiveTransactionPlan(),
      activeFigmaTransaction: activeTransaction(),
      applyMetadata: {
        transactionId: "txn-filled",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-06-30",
        figmaNodeId: "9:10",
        figmaNodeName: "Members / Filled",
        figmaNodeKind: "FRAME",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
        componentRefs: ["button-key"],
        variableRefs: ["var-color-primary"],
        autoLayout: true,
      },
    });

    expect(result.statePatch?.figmaNodeLedger).toMatchObject({
      schemaVersion: "FigmaNodeLedger/v1",
      fileKey: "FILE",
      pageId: "1:2",
      sectionName: "kotikit / members / 2026-06-30",
      nodes: [
        expect.objectContaining({
          nodeId: "9:10",
          name: "Members / Filled",
          kind: "FRAME",
          semanticRole: "screen-state",
          transactionId: "txn-filled",
          placementId: "state-filled",
          stateId: "filled",
          bounds: { x: 560, y: 0, width: 1440, height: 900 },
          componentRefs: ["button-key"],
          variableRefs: ["var-color-primary"],
          autoLayout: true,
        }),
      ],
    });
    expect(result.statePatch?.figmaTransactionPlan).toMatchObject({
      transactions: [expect.objectContaining({ id: "txn-filled", status: "recorded" })],
    });
    expect(result.statePatch?.activeFigmaTransaction).toBeUndefined();
    expect(result.statePatch?.applyMetadata).toBeUndefined();
    expect(result.statePatch?.applyReport).toMatchObject({
      schemaVersion: "FigmaApplyReport/v1",
      status: "recorded",
      fileKey: "FILE",
      pageId: "1:2",
      sectionName: "kotikit / members / 2026-06-30",
      nodes: [
        expect.objectContaining({
          id: "9:10",
          transactionId: "txn-filled",
          bounds: { x: 560, y: 0, width: 1440, height: 900 },
          componentRefs: ["button-key"],
          variableRefs: ["var-color-primary"],
          autoLayout: true,
        }),
      ],
      layoutFrames: [expect.objectContaining({ id: "9:10", transactionId: "txn-filled" })],
    });
  });

  it("rejects missing or mismatched transaction metadata for an active transaction", async () => {
    await expect(
      runNode("figma.applyTransactionQueue", {
        figmaTarget: draftTarget(),
        figmaTransactionPlan: singleActiveTransactionPlan(),
        activeFigmaTransaction: activeTransaction(),
      })
    ).rejects.toThrow("Record Figma apply metadata for transaction txn-filled");

    await expect(
      runNode("figma.applyTransactionQueue", {
        figmaTarget: draftTarget(),
        figmaTransactionPlan: singleActiveTransactionPlan(),
        activeFigmaTransaction: activeTransaction(),
        applyMetadata: { transactionId: "txn-other" },
      })
    ).rejects.toThrow("does not match the active Figma transaction");
  });

  it("validates transaction apply metadata before appending ledger nodes", async () => {
    const baseState = {
      figmaTarget: draftTarget(),
      figmaTransactionPlan: singleActiveTransactionPlan(),
      activeFigmaTransaction: activeTransaction(),
    };

    await expect(
      runNode("figma.applyTransactionQueue", {
        ...baseState,
        applyMetadata: {
          transactionId: "txn-filled",
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          componentRefs: [],
          variableRefs: [],
          autoLayout: true,
        },
      })
    ).rejects.toThrow("missing the Figma node id");

    await expect(
      runNode("figma.applyTransactionQueue", {
        ...baseState,
        applyMetadata: {
          transactionId: "txn-filled",
          figmaNodeId: "9:10",
          bounds: { x: 0, y: 0, width: 0, height: 900 },
          componentRefs: [],
          variableRefs: [],
          autoLayout: true,
        },
      })
    ).rejects.toThrow("positive bounds");

    await expect(
      runNode("figma.applyTransactionQueue", {
        ...baseState,
        applyMetadata: {
          transactionId: "txn-filled",
          figmaNodeId: "9:10",
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          componentRefs: [],
          variableRefs: [],
          autoLayout: false,
        },
      })
    ).rejects.toThrow("auto layout");
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

function transactionPlan(): NonNullable<KotikitGraphState["figmaTransactionPlan"]> {
  return {
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions: [
      {
        id: "txn-filled",
        order: 1,
        kind: "create-screen-state",
        label: "Members / Filled",
        placementId: "state-filled",
        stateId: "filled",
        status: "pending",
        requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
      },
      {
        id: "txn-empty",
        order: 2,
        kind: "create-screen-state",
        label: "Members / Empty",
        placementId: "state-empty",
        stateId: "empty",
        status: "pending",
        requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
      },
    ],
  };
}

function activeTransaction(): NonNullable<KotikitGraphState["activeFigmaTransaction"]> {
  const transaction = transactionPlan().transactions[0];
  if (transaction === undefined) throw new Error("missing transaction fixture");
  return {
    id: transaction.id,
    order: transaction.order,
    kind: transaction.kind,
    label: transaction.label,
    placementId: transaction.placementId,
    stateId: transaction.stateId,
    requiredMetadata: transaction.requiredMetadata,
  };
}

function singleActiveTransactionPlan(): NonNullable<KotikitGraphState["figmaTransactionPlan"]> {
  return {
    ...transactionPlan(),
    transactions: [{ ...activeTransaction(), status: "active" }],
  };
}
