import { describe, expect, it } from "bun:test";
import {
  ArtifactPayloadSchema,
  ArtifactSchemaVersionByType,
  CanvasPlanSchema,
  CanvasReconciliationReportSchema,
  FigmaNodeLedgerSchema,
  FigmaTransactionPlanSchema,
} from "../../schemas/artifact.js";
import { KotikitGraphStateSchema } from "../../schemas/graph-state.js";

const screenBounds = { x: 0, y: 0, width: 1440, height: 960 };
const headerBounds = { x: 0, y: 0, width: 1440, height: 96 };
const contentBounds = { x: 0, y: 120, width: 1440, height: 720 };
const transactionMetadata = [
  "node-id",
  "bounds",
  "auto-layout",
  "component-refs",
  "variable-refs",
] as const;

function validCanvasPlan() {
  return {
    schemaVersion: "CanvasPlan/v1",
    section: { fileKey: "figma-file-1", pageId: "0:1", name: "Generated screens" },
    coordinateSpace: "section-relative",
    screenSize: screenBounds,
    minGap: 24,
    zones: [
      { id: "header-zone", name: "Header zone", bounds: headerBounds },
      { id: "content-zone", name: "Content zone", bounds: contentBounds },
    ],
    placements: [
      {
        id: "placement-header",
        zoneId: "header-zone",
        name: "Header",
        bounds: headerBounds,
      },
      {
        id: "placement-content",
        zoneId: "content-zone",
        name: "Table region",
        bounds: contentBounds,
      },
    ],
    strategy: "place-screen-states-below-source",
  };
}

function validFigmaTransactionPlan() {
  return {
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions: [
      {
        id: "txn-create-draft",
        order: 0,
        kind: "create-draft-component",
        status: "pending",
        requiredMetadata: transactionMetadata,
        placementId: "placement-content",
      },
      {
        id: "txn-verify-node",
        order: 1,
        kind: "verify-created-node",
        status: "pending",
        requiredMetadata: transactionMetadata,
        dependsOn: ["txn-create-draft"],
      },
    ],
  };
}

function validFigmaNodeLedger() {
  return {
    schemaVersion: "FigmaNodeLedger/v1",
    fileKey: "figma-file-1",
    pageId: "0:1",
    sectionName: "Generated screens",
    nodes: [
      {
        nodeId: "12:34",
        name: "Members filled",
        kind: "FRAME",
        semanticRole: "screen-state",
        transactionId: "txn-create-screen",
        placementId: "placement-content",
        stateId: "members-filled",
        draftComponentId: "draft-table-row",
        partId: "members-table",
        bounds: contentBounds,
        componentRefs: ["table-key"],
        variableRefs: ["color-bg-default"],
        autoLayout: { mode: "vertical", gap: 16 },
        recordedAt: "2026-07-01T10:00:00.000Z",
        updatedAt: "2026-07-01T10:00:00.000Z",
      },
    ],
  };
}

function validCanvasReconciliation() {
  return {
    schemaVersion: "CanvasReconciliationReport/v1",
    fileKey: "figma-file-1",
    pageId: "0:1",
    timestamp: "2026-07-01T10:05:00.000Z",
    nodes: [
      {
        nodeId: "12:34",
        status: "matched",
        previousName: "Members filled",
        currentName: "Members filled",
        previousBounds: contentBounds,
        currentBounds: contentBounds,
        transactionId: "txn-create-screen",
        placementId: "placement-content",
        stateId: "members-filled",
      },
    ],
    unmappedCommentsRisk: "low",
  };
}

describe("canvas and figma ledger artifact schemas", () => {
  it("parses a canvas plan with non-overlapping named zones", () => {
    expect(CanvasPlanSchema.parse(validCanvasPlan())).toMatchObject({
      schemaVersion: "CanvasPlan/v1",
      coordinateSpace: "section-relative",
      zones: [
        { id: "header-zone", name: "Header zone" },
        { id: "content-zone", name: "Content zone" },
      ],
    });
    expect(ArtifactPayloadSchema.parse(validCanvasPlan())).toMatchObject({
      schemaVersion: "CanvasPlan/v1",
    });
    expect(ArtifactSchemaVersionByType["canvas-plan"]).toBe("CanvasPlan/v1");
  });

  it("parses figma transaction plans and node ledgers", () => {
    expect(FigmaTransactionPlanSchema.parse(validFigmaTransactionPlan())).toMatchObject({
      mode: "incremental-official-figma-mcp",
      transactions: expect.arrayContaining([
        expect.objectContaining({ kind: "create-draft-component" }),
      ]),
    });
    expect(FigmaNodeLedgerSchema.parse(validFigmaNodeLedger())).toMatchObject({
      fileKey: "figma-file-1",
      nodes: [expect.objectContaining({ semanticRole: "screen-state" })],
    });
    expect(ArtifactPayloadSchema.parse(validFigmaTransactionPlan())).toMatchObject({
      schemaVersion: "FigmaTransactionPlan/v1",
    });
    expect(ArtifactPayloadSchema.parse(validFigmaNodeLedger())).toMatchObject({
      schemaVersion: "FigmaNodeLedger/v1",
    });
    expect(ArtifactSchemaVersionByType["figma-transaction-plan"]).toBe("FigmaTransactionPlan/v1");
    expect(ArtifactSchemaVersionByType["figma-node-ledger"]).toBe("FigmaNodeLedger/v1");
  });

  it("parses graph state with compact incremental figma canvas refs", () => {
    expect(
      KotikitGraphStateSchema.parse({
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "waiting-for-figma",
        project: { root: "/tmp/project" },
        canvasPlan: validCanvasPlan(),
        figmaTransactionPlan: validFigmaTransactionPlan(),
        activeFigmaTransaction: { id: "txn-create-draft" },
        figmaNodeLedger: validFigmaNodeLedger(),
        canvasReconciliation: validCanvasReconciliation(),
        artifacts: [],
        errors: [],
      })
    ).toMatchObject({
      canvasPlan: { schemaVersion: "CanvasPlan/v1" },
      figmaTransactionPlan: { schemaVersion: "FigmaTransactionPlan/v1" },
      activeFigmaTransaction: { id: "txn-create-draft" },
      figmaNodeLedger: { schemaVersion: "FigmaNodeLedger/v1" },
      canvasReconciliation: { schemaVersion: "CanvasReconciliationReport/v1" },
    });
    expect(CanvasReconciliationReportSchema.parse(validCanvasReconciliation())).toMatchObject({
      schemaVersion: "CanvasReconciliationReport/v1",
    });
    expect(ArtifactPayloadSchema.parse(validCanvasReconciliation())).toMatchObject({
      schemaVersion: "CanvasReconciliationReport/v1",
    });
    expect(ArtifactSchemaVersionByType["canvas-reconciliation-report"]).toBe(
      "CanvasReconciliationReport/v1"
    );
  });
});
