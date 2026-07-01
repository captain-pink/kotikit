import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import type { CanvasPlan } from "../../schemas/artifact.js";
import {
  buildFigmaTransactionPlan,
  markTransactionActive,
  nextPendingTransaction,
  recordTransactionMetadata,
  transactionPlanComplete,
} from "../figma-transaction-plan.js";

const placements: CanvasPlan["placements"] = [
  {
    id: "draft-table-row",
    kind: "draft-component",
    draftComponentId: "table-row",
    transactionId: "txn-draft-table-row",
    label: "Table row draft component",
    bounds: { x: 0, y: 0, width: 360, height: 240 },
    parentZoneId: "zone-draft-components",
  },
  {
    id: "state-filled",
    kind: "screen-state",
    stateId: "filled",
    transactionId: "txn-state-filled",
    label: "Members - Filled",
    bounds: { x: 560, y: 0, width: 1440, height: 900 },
    parentZoneId: "zone-screen-states",
  },
];

const creationOrder = ["draft-table-row", "state-filled"];

describe("buildFigmaTransactionPlan", () => {
  it("creates draft component transactions before screen-state transactions using creation order placement ids", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });

    expect(plan.transactions.map((transaction) => transaction.id)).toEqual([
      "txn-draft-table-row",
      "txn-state-filled",
    ]);
    expect(plan.transactions[0]).toMatchObject({
      order: 1,
      kind: "create-draft-component",
      placementId: "draft-table-row",
      draftComponentId: "table-row",
      status: "pending",
      requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
    });
    expect(nextPendingTransaction(plan)?.id).toBe("txn-draft-table-row");
  });

  it("throws a KotikitError when creation order references an unknown placement", () => {
    expect(() =>
      buildFigmaTransactionPlan({
        placements,
        creationOrder: ["draft-table-row", "missing-placement"],
      })
    ).toThrow(KotikitError);
  });

  it("throws a KotikitError when creation order omits a placement", () => {
    expect(() =>
      buildFigmaTransactionPlan({
        placements,
        creationOrder: ["draft-table-row"],
      })
    ).toThrow(KotikitError);
  });

  it("throws a KotikitError when creation order duplicates a placement", () => {
    expect(() =>
      buildFigmaTransactionPlan({
        placements,
        creationOrder: ["draft-table-row", "draft-table-row", "state-filled"],
      })
    ).toThrow(KotikitError);
  });
});

describe("figma transaction queue state", () => {
  it("marks one transaction recorded and leaves the next transaction pending", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });
    const active = markTransactionActive(plan, "txn-draft-table-row");
    const updated = recordTransactionMetadata(active, { transactionId: "txn-draft-table-row" });

    expect(updated.transactions.map((transaction) => transaction.status)).toEqual([
      "recorded",
      "pending",
    ]);
    expect(nextPendingTransaction(updated)?.id).toBe("txn-state-filled");
    expect(transactionPlanComplete(updated)).toBe(false);
  });

  it("marks a transaction active and keeps it next until it is recorded", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });
    const updated = markTransactionActive(plan, "txn-draft-table-row");

    expect(updated.transactions[0]).toMatchObject({
      id: "txn-draft-table-row",
      status: "active",
    });
    expect(nextPendingTransaction(updated)?.id).toBe("txn-draft-table-row");
  });

  it("throws when recording metadata for a pending transaction", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });

    expect(() => recordTransactionMetadata(plan, { transactionId: "txn-draft-table-row" })).toThrow(
      KotikitError
    );
  });

  it("throws when marking a recorded transaction active", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });
    const active = markTransactionActive(plan, "txn-draft-table-row");
    const recorded = recordTransactionMetadata(active, { transactionId: "txn-draft-table-row" });

    expect(() => markTransactionActive(recorded, "txn-draft-table-row")).toThrow(KotikitError);
  });

  it("throws when marking a second transaction active while one is active", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });
    const active = markTransactionActive(plan, "txn-draft-table-row");

    expect(() => markTransactionActive(active, "txn-state-filled")).toThrow(KotikitError);
  });

  it("returns an active transaction before an earlier pending transaction", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });
    const active = markTransactionActive(plan, "txn-state-filled");

    expect(nextPendingTransaction(active)?.id).toBe("txn-state-filled");
  });

  it("reports complete only when every transaction is recorded", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });
    const withDraftActive = markTransactionActive(plan, "txn-draft-table-row");
    const withDraftRecorded = recordTransactionMetadata(withDraftActive, {
      transactionId: "txn-draft-table-row",
    });
    const withStateActive = markTransactionActive(withDraftRecorded, "txn-state-filled");
    const complete = recordTransactionMetadata(withStateActive, {
      transactionId: "txn-state-filled",
    });

    expect(transactionPlanComplete(plan)).toBe(false);
    expect(transactionPlanComplete(complete)).toBe(true);
    expect(nextPendingTransaction(complete)).toBeUndefined();
  });

  it("throws when recording metadata for an unknown transaction id", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });

    expect(() => recordTransactionMetadata(plan, { transactionId: "missing-txn" })).toThrow(
      KotikitError
    );
  });

  it("throws when marking an unknown transaction id active", () => {
    const plan = buildFigmaTransactionPlan({ placements, creationOrder });

    expect(() => markTransactionActive(plan, "missing-txn")).toThrow(KotikitError);
  });
});
