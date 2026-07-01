import { describe, expect, it } from "bun:test";
import {
  ArtifactPayloadSchema,
  ArtifactSchemaVersionByType,
  BoundsSchema,
  CanvasPlanSchema,
  CanvasReconciliationReportSchema,
  FigmaNodeLedgerSchema,
  FigmaTransactionPlanSchema,
} from "../../schemas/artifact.js";
import { KotikitGraphStateSchema } from "../../schemas/graph-state.js";

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
    section: { id: "section-generated", name: "Generated screens" },
    coordinateSpace: "section-relative",
    screenSize: { width: 1440, height: 960 },
    minGap: 24,
    zones: [
      {
        id: "draft-zone",
        kind: "draft-components",
        label: "Draft components",
        bounds: headerBounds,
      },
      {
        id: "screen-zone",
        kind: "screen-states",
        label: "Screen states",
        bounds: contentBounds,
      },
    ],
    placements: [
      {
        id: "placement-header",
        kind: "annotation",
        label: "Header notes",
        bounds: headerBounds,
        parentZoneId: "draft-zone",
        transactionId: "txn-verify-node",
      },
      {
        id: "placement-content",
        kind: "screen-state",
        stateId: "members-filled",
        label: "Table region",
        bounds: contentBounds,
        parentZoneId: "screen-zone",
        transactionId: "txn-create-screen",
      },
    ],
    strategy: {
      primaryFirst: true,
      creationOrder: ["placement-content", "placement-header"],
      designerNotes: ["Keep screen states below draft components."],
    },
  };
}

function validFigmaTransactionPlan() {
  return {
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions: [
      {
        id: "txn-create-draft",
        order: 1,
        kind: "create-draft-component",
        label: "Create draft table row",
        placementId: "placement-content",
        draftComponentId: "draft-table-row",
        status: "pending",
        requiredMetadata: transactionMetadata,
      },
      {
        id: "txn-verify-node",
        order: 2,
        kind: "verify-created-node",
        label: "Verify created table row",
        placementId: "placement-content",
        status: "pending",
        requiredMetadata: transactionMetadata,
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
        autoLayout: true,
        recordedAt: "2026-07-01T10:00:00.000Z",
      },
    ],
    updatedAt: "2026-07-01T10:00:00.000Z",
  };
}

function validCanvasReconciliation() {
  return {
    schemaVersion: "CanvasReconciliationReport/v1",
    fileKey: "figma-file-1",
    pageId: "0:1",
    reconciledAt: "2026-07-01T10:05:00.000Z",
    nodes: [
      {
        nodeId: "12:34",
        ledgerStatus: "matched",
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
        { id: "draft-zone", label: "Draft components" },
        { id: "screen-zone", label: "Screen states" },
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
        activeFigmaTransaction: {
          id: "txn-create-draft",
          order: 1,
          kind: "create-draft-component",
          label: "Create draft table row",
          placementId: "placement-content",
          draftComponentId: "draft-table-row",
          requiredMetadata: transactionMetadata,
        },
        figmaNodeLedger: validFigmaNodeLedger(),
        canvasReconciliation: validCanvasReconciliation(),
        artifacts: [],
        errors: [],
      })
    ).toMatchObject({
      canvasPlan: { schemaVersion: "CanvasPlan/v1" },
      figmaTransactionPlan: { schemaVersion: "FigmaTransactionPlan/v1" },
      activeFigmaTransaction: { id: "txn-create-draft", kind: "create-draft-component" },
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

  it("rejects non-executable incremental figma plan data", () => {
    const placementWithoutTransaction = {
      ...validCanvasPlan(),
      placements: validCanvasPlan().placements.map((placement) =>
        placement.id === "placement-content"
          ? {
              id: placement.id,
              kind: placement.kind,
              stateId: placement.stateId,
              label: placement.label,
              bounds: placement.bounds,
              parentZoneId: placement.parentZoneId,
            }
          : placement
      ),
    };
    const transactionWithoutLabel = {
      ...validFigmaTransactionPlan(),
      transactions: validFigmaTransactionPlan().transactions.map((transaction) =>
        transaction.id === "txn-create-draft"
          ? {
              id: transaction.id,
              order: transaction.order,
              kind: transaction.kind,
              placementId: transaction.placementId,
              status: transaction.status,
              requiredMetadata: transaction.requiredMetadata,
            }
          : transaction
      ),
    };
    const ledgerWithObjectAutoLayout = {
      ...validFigmaNodeLedger(),
      nodes: validFigmaNodeLedger().nodes.map((node) => ({
        ...node,
        autoLayout: { mode: "vertical" },
      })),
    };

    expect(() => CanvasPlanSchema.parse(placementWithoutTransaction)).toThrow();
    expect(() => FigmaTransactionPlanSchema.parse(transactionWithoutLabel)).toThrow();
    expect(() => FigmaNodeLedgerSchema.parse(ledgerWithObjectAutoLayout)).toThrow();
  });

  it("rejects raw active figma transaction payloads in graph state", () => {
    expect(() =>
      KotikitGraphStateSchema.parse({
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "waiting-for-figma",
        project: { root: "/tmp/project" },
        activeFigmaTransaction: {
          id: "txn-create-draft",
          order: 1,
          kind: "create-draft-component",
          label: "Create draft table row",
          placementId: "placement-content",
          draftComponentId: "draft-table-row",
          requiredMetadata: transactionMetadata,
          rawNodeTree: { document: { children: [] } },
        },
        artifacts: [],
        errors: [],
      })
    ).toThrow();
  });

  it("rejects dangling and duplicated canvas plan relationships", () => {
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        placements: validCanvasPlan().placements.map((placement) =>
          placement.id === "placement-content"
            ? { ...placement, parentZoneId: "missing-zone" }
            : placement
        ),
      })
    ).toThrow();
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        placements: validCanvasPlan().placements.map((placement) => ({
          ...placement,
          id: "duplicate-placement",
        })),
      })
    ).toThrow();
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        placements: validCanvasPlan().placements.map((placement) => ({
          ...placement,
          transactionId: "duplicate-transaction",
        })),
      })
    ).toThrow();
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        strategy: {
          ...validCanvasPlan().strategy,
          creationOrder: ["missing-placement"],
        },
      })
    ).toThrow();
  });

  it("rejects duplicate canvas zone ids", () => {
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        zones: validCanvasPlan().zones.map((zone) => ({
          ...zone,
          id: "screen-zone",
        })),
        placements: validCanvasPlan().placements.map((placement) => ({
          ...placement,
          parentZoneId: "screen-zone",
        })),
      })
    ).toThrow();
  });

  it("rejects screen-state placements without state ids", () => {
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        placements: validCanvasPlan().placements.map((placement) =>
          placement.id === "placement-content"
            ? {
                id: placement.id,
                kind: placement.kind,
                label: placement.label,
                bounds: placement.bounds,
                parentZoneId: placement.parentZoneId,
                transactionId: placement.transactionId,
              }
            : placement
        ),
      })
    ).toThrow();
  });

  it("rejects draft-component placements without draft component ids", () => {
    expect(() =>
      CanvasPlanSchema.parse({
        ...validCanvasPlan(),
        placements: [
          ...validCanvasPlan().placements,
          {
            id: "placement-draft",
            kind: "draft-component",
            label: "Draft row component",
            bounds: headerBounds,
            parentZoneId: "draft-zone",
            transactionId: "txn-create-draft",
          },
        ],
        strategy: {
          ...validCanvasPlan().strategy,
          creationOrder: [...validCanvasPlan().strategy.creationOrder, "placement-draft"],
        },
      })
    ).toThrow();
  });

  it("rejects active screen-state transactions without state ids", () => {
    expect(() =>
      KotikitGraphStateSchema.parse({
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "waiting-for-figma",
        project: { root: "/tmp/project" },
        activeFigmaTransaction: {
          id: "txn-create-screen",
          order: 1,
          kind: "create-screen-state",
          label: "Create screen state",
          placementId: "placement-content",
          requiredMetadata: transactionMetadata,
        },
        artifacts: [],
        errors: [],
      })
    ).toThrow();
  });

  it("rejects create-draft-component transactions without draft component ids", () => {
    expect(() =>
      FigmaTransactionPlanSchema.parse({
        ...validFigmaTransactionPlan(),
        transactions: validFigmaTransactionPlan().transactions.map((transaction) =>
          transaction.id === "txn-create-draft"
            ? {
                ...transaction,
                draftComponentId: undefined,
              }
            : transaction
        ),
      })
    ).toThrow();
  });

  it("rejects screen-state and region-state transactions without state ids", () => {
    expect(() =>
      FigmaTransactionPlanSchema.parse({
        ...validFigmaTransactionPlan(),
        transactions: [
          ...validFigmaTransactionPlan().transactions,
          {
            id: "txn-create-screen-state",
            order: 3,
            kind: "create-screen-state",
            label: "Create screen state",
            placementId: "placement-content",
            status: "pending",
            requiredMetadata: transactionMetadata,
          },
        ],
      })
    ).toThrow();
    expect(() =>
      FigmaTransactionPlanSchema.parse({
        ...validFigmaTransactionPlan(),
        transactions: [
          ...validFigmaTransactionPlan().transactions,
          {
            id: "txn-create-region-state",
            order: 3,
            kind: "create-region-state",
            label: "Create region state",
            placementId: "placement-content",
            status: "pending",
            requiredMetadata: transactionMetadata,
          },
        ],
      })
    ).toThrow();
  });

  it("rejects duplicate transaction ids, duplicate orders, and empty required metadata", () => {
    expect(() =>
      FigmaTransactionPlanSchema.parse({
        ...validFigmaTransactionPlan(),
        transactions: validFigmaTransactionPlan().transactions.map((transaction) => ({
          ...transaction,
          id: "duplicate-transaction",
        })),
      })
    ).toThrow();
    expect(() =>
      FigmaTransactionPlanSchema.parse({
        ...validFigmaTransactionPlan(),
        transactions: validFigmaTransactionPlan().transactions.map((transaction) => ({
          ...transaction,
          order: 1,
        })),
      })
    ).toThrow();
    expect(() =>
      FigmaTransactionPlanSchema.parse({
        ...validFigmaTransactionPlan(),
        transactions: validFigmaTransactionPlan().transactions.map((transaction) =>
          transaction.id === "txn-create-draft"
            ? { ...transaction, requiredMetadata: [] }
            : transaction
        ),
      })
    ).toThrow();
  });

  it("rejects absurd incremental figma bounds", () => {
    expect(() => BoundsSchema.parse({ x: 0, y: 0, width: 1e12, height: 720 })).toThrow();
  });

  it("parses graph state with empty compact canvas and transaction refs", () => {
    expect(
      KotikitGraphStateSchema.parse({
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "running",
        project: { root: "/tmp/project" },
        canvasPlan: {
          schemaVersion: "CanvasPlan/v1",
          section: { name: "Generated screens" },
          coordinateSpace: "section-relative",
          screenSize: { width: 1440, height: 960 },
          minGap: 24,
          zones: [],
          placements: [],
          strategy: {
            primaryFirst: true,
            creationOrder: [],
            designerNotes: [],
          },
        },
        figmaTransactionPlan: {
          schemaVersion: "FigmaTransactionPlan/v1",
          mode: "incremental-official-figma-mcp",
          transactions: [],
        },
        artifacts: [],
        errors: [],
      })
    ).toMatchObject({
      canvasPlan: { zones: [], placements: [] },
      figmaTransactionPlan: { transactions: [] },
    });
  });
});
