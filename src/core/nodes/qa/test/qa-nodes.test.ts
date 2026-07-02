import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { qaNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: unknown[];
};

describe("qa graph nodes", () => {
  it("refuses to run the UI quality gate before Figma apply metadata is recorded", async () => {
    await expect(runNode("qa.runUiQualityGate", {})).rejects.toThrow("apply metadata");
  });

  it("blocks common broken UI output invariants", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        nodes: [
          { id: "vertical", textDirection: "vertical" },
          { id: "mirrored", mirroredText: true },
          { id: "flipped", transform: { scaleX: -1 } },
          { id: "negative", width: -1, height: 20 },
          { id: "clipped", clippedText: true },
          { id: "missing-component", expectedComponentRef: true },
          { id: "detached", detachedInstance: true },
          { id: "overlap", overlaps: ["other"] },
          { id: "hardcoded", hardcodedComponentImitation: true },
          { id: "state-card", statePreviewCard: true },
          { id: "missing-state", expectedStateFrame: true },
          { id: "shell-drift", stateShellDrift: true },
          { id: "orphan-draft", orphanDraftComponent: true },
          { id: "draft-overlap", draftComponentOverlap: true },
          { id: "detached-draft-use", draftComponentDetachedUse: true },
        ],
      },
    });
    const checks = recordArray(recordFrom(result.statePatch?.uiQualityGate).checks);

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      schemaVersion: "UIQualityGateReport/v1",
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "vertical-text", status: "blocked" }),
        expect.objectContaining({ id: "mirrored-text", status: "blocked" }),
        expect.objectContaining({ id: "component-refs", status: "blocked" }),
        expect.objectContaining({ id: "hardcoded-imitation", status: "blocked" }),
        expect.objectContaining({ id: "state-preview-card", status: "blocked" }),
        expect.objectContaining({ id: "missing-state-frame", status: "blocked" }),
        expect.objectContaining({ id: "state-shell-drift", status: "blocked" }),
        expect.objectContaining({ id: "orphan-draft-component", status: "blocked" }),
        expect.objectContaining({ id: "draft-component-overlap", status: "blocked" }),
        expect.objectContaining({ id: "draft-component-detached-use", status: "blocked" }),
      ]),
    });
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "state-preview-card",
          recommendedAction: expect.stringContaining("state"),
        }),
        expect.objectContaining({
          id: "draft-component-overlap",
          recommendedAction: expect.stringContaining("draft component"),
        }),
      ])
    );
  });

  it("passes clean apply reports", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        nodes: [{ id: "button", componentKey: "button-key", width: 120, height: 40 }],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      schemaVersion: "UIQualityGateReport/v1",
      status: "passed",
    });
  });

  it("blocks overlapping canvas placements from applied node bounds", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: true,
            overlaps: [],
          },
          {
            id: "state-loading",
            semanticRole: "screen-state",
            transactionId: "txn-loading",
            placementId: "state-loading",
            bounds: { x: 100, y: 100, width: 1440, height: 900 },
            autoLayout: true,
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "canvas-overlap", status: "blocked" }),
      ]),
    });
  });

  it("blocks screen-state frames that are not auto layout", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: false,
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "screen-state-auto-layout", status: "blocked" }),
      ]),
    });
  });

  it("blocks flat screen-state frames without semantic auto-layout containers", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: true,
            screenshotReviewed: true,
            directVisibleChildCount: 96,
            autoLayoutContainerCount: 1,
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "screen-state-container-structure",
          status: "blocked",
          findings: [
            "state-filled has 96 direct visible children but only 1 auto-layout container",
          ],
        }),
      ]),
    });
  });

  it("blocks screen-state frames that were not reviewed from a screenshot", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: true,
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "screenshot-review", status: "blocked" }),
      ]),
    });
  });

  it("passes screenshot-reviewed screen-state frames", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: true,
            screenshotReviewed: true,
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "passed",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "screenshot-review", status: "passed" }),
      ]),
    });
  });

  it("blocks screenshot-reviewed frames with visible screenshot findings", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: true,
            screenshotReviewed: true,
            screenshotFindings: ["search component overlaps table header"],
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "screenshot-review",
          status: "blocked",
          findings: ["state-filled: search component overlaps table header"],
        }),
      ]),
    });
  });

  it("blocks applied nodes without transaction placement metadata", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            autoLayout: true,
            overlaps: [],
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "transaction-metadata", status: "blocked" }),
      ]),
    });
  });

  it("blocks canvas nodes that do not preserve the planned minimum gap", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      canvasPlan: canvasPlan(),
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 560, y: 0, width: 1440, height: 900 },
            autoLayout: true,
          },
          {
            id: "state-loading",
            semanticRole: "screen-state",
            transactionId: "txn-loading",
            placementId: "state-loading",
            bounds: { x: 2040, y: 0, width: 1440, height: 900 },
            autoLayout: true,
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "canvas-min-gap", status: "blocked" }),
      ]),
    });
  });

  it("blocks applied nodes outside their planned canvas zone", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      canvasPlan: canvasPlan(),
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-filled",
            semanticRole: "screen-state",
            transactionId: "txn-filled",
            placementId: "state-filled",
            bounds: { x: 40, y: 0, width: 1440, height: 900 },
            autoLayout: true,
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "canvas-zone-membership", status: "blocked" }),
      ]),
    });
  });

  it("blocks icon placeholders when the apply packet required icons", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      draftPlan: {
        applyPacket: {
          iconRequirements: [{ id: "search-icon", semantic: "search" }],
        },
      },
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "state-empty-icon",
            semanticRole: "component-instance",
            iconPlaceholder: true,
            name: "State icon",
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "icon-refs", status: "blocked" }),
      ]),
    });
  });

  it("blocks missing per-part icon proof even when another required icon is present", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      draftPlan: {
        applyPacket: {
          iconRequirements: [
            {
              id: "search-icon",
              semantic: "search",
              partId: "search",
              iconKey: "icon-search-key",
            },
            {
              id: "error-icon",
              semantic: "error",
              partId: "error",
              iconKey: "icon-error-key",
            },
          ],
        },
      },
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        nodes: [
          {
            id: "search-node",
            partId: "search",
            semanticRole: "component-instance",
            iconRefs: ["icon-search-key"],
          },
          {
            id: "error-node",
            partId: "error",
            semanticRole: "component-instance",
          },
        ],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "icon-refs", status: "blocked" }),
      ]),
    });
  });

  it("saves post-draft QA findings without posting comments or changing memory", async () => {
    const result = await runNode("qa.postDraftQa", {
      uiQualityGate: {
        schemaVersion: "UIQualityGateReport/v1",
        status: "blocked",
        checks: [{ id: "vertical-text", name: "Vertical text", status: "blocked" }],
      },
    });

    expect(result.artifacts?.[0]).toMatchObject({
      type: "ui-quality-gate-report",
      payload: expect.objectContaining({ status: "blocked" }),
    });
    expect(result.statePatch).not.toHaveProperty("review");
  });

  it("refuses to save post-draft QA before the quality gate runs", async () => {
    await expect(runNode("qa.postDraftQa", {})).rejects.toThrow("quality gate");
  });
});

async function runNode(key: string, patch: Partial<KotikitGraphState>): Promise<NodeOutput> {
  const node = qaNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-qa",
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

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function canvasPlan(): NonNullable<KotikitGraphState["canvasPlan"]> {
  return {
    schemaVersion: "CanvasPlan/v1",
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    coordinateSpace: "section-relative",
    screenSize: { width: 1440, height: 900 },
    minGap: 160,
    sectionStyle: {
      background: {
        color: "AED0FF",
        opacity: 0.1,
      },
    },
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
        id: "state-filled",
        kind: "screen-state",
        stateId: "filled",
        label: "Members / Filled",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
        parentZoneId: "zone-screen-states",
        transactionId: "txn-filled",
      },
      {
        id: "state-loading",
        kind: "screen-state",
        stateId: "loading",
        label: "Members / Loading",
        bounds: { x: 2160, y: 0, width: 1440, height: 900 },
        parentZoneId: "zone-screen-states",
        transactionId: "txn-loading",
      },
    ],
    strategy: {
      primaryFirst: true,
      creationOrder: ["state-filled", "state-loading"],
      designerNotes: ["Screen states use deterministic spacing."],
    },
  };
}
