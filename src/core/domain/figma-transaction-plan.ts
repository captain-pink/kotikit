import { KotikitError } from "../../util/result.js";
import {
  type CanvasPlan,
  type FigmaTransactionPlan,
  FigmaTransactionPlanSchema,
} from "../schemas/artifact.js";

const REQUIRED_METADATA = [
  "node-id",
  "bounds",
  "auto-layout",
  "component-refs",
  "variable-refs",
] as const;

type CanvasPlacement = CanvasPlan["placements"][number];
type FigmaTransaction = FigmaTransactionPlan["transactions"][number];

export function buildFigmaTransactionPlan(input: {
  placements: CanvasPlan["placements"];
  creationOrder: string[];
}): FigmaTransactionPlan {
  const placementsById = new Map(input.placements.map((placement) => [placement.id, placement]));
  const transactions = input.creationOrder.map((placementId, index): FigmaTransaction => {
    const placement = placementsById.get(placementId);
    if (placement === undefined) {
      throw new KotikitError(
        `Figma transaction plan references unknown canvas placement ${placementId}.`,
        "Regenerate the canvas plan before building Figma transactions."
      );
    }
    return transactionFromPlacement(placement, index + 1);
  });

  return FigmaTransactionPlanSchema.parse({
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions,
  });
}

export function nextPendingTransaction(
  plan: FigmaTransactionPlan
): FigmaTransactionPlan["transactions"][number] | undefined {
  return [...plan.transactions]
    .filter((transaction) => transaction.status === "pending" || transaction.status === "active")
    .sort((left, right) => left.order - right.order)[0];
}

export function markTransactionActive(
  plan: FigmaTransactionPlan,
  transactionId: string
): FigmaTransactionPlan {
  assertTransactionExists(plan, transactionId);
  return updateTransactionStatus(plan, transactionId, "active");
}

export function recordTransactionMetadata(
  plan: FigmaTransactionPlan,
  metadata: { transactionId: string }
): FigmaTransactionPlan {
  assertTransactionExists(plan, metadata.transactionId);
  return updateTransactionStatus(plan, metadata.transactionId, "recorded");
}

export function transactionPlanComplete(plan: FigmaTransactionPlan): boolean {
  return plan.transactions.every((transaction) => transaction.status === "recorded");
}

function transactionFromPlacement(placement: CanvasPlacement, order: number): FigmaTransaction {
  return {
    id: placement.transactionId,
    order,
    kind: transactionKindForPlacement(placement),
    label: placement.label,
    placementId: placement.id,
    ...(placement.stateId === undefined ? {} : { stateId: placement.stateId }),
    ...(placement.draftComponentId === undefined
      ? {}
      : { draftComponentId: placement.draftComponentId }),
    status: "pending",
    requiredMetadata: [...REQUIRED_METADATA],
  };
}

function transactionKindForPlacement(placement: CanvasPlacement): FigmaTransaction["kind"] {
  switch (placement.kind) {
    case "draft-component":
      return "create-draft-component";
    case "screen-state":
      return "create-screen-state";
    case "annotation":
      return "verify-created-node";
  }
}

function assertTransactionExists(plan: FigmaTransactionPlan, transactionId: string): void {
  if (!plan.transactions.some((transaction) => transaction.id === transactionId)) {
    throw new KotikitError(
      `Figma transaction plan has no transaction ${transactionId}.`,
      "Refresh the transaction queue before recording Figma metadata."
    );
  }
}

function updateTransactionStatus(
  plan: FigmaTransactionPlan,
  transactionId: string,
  status: FigmaTransaction["status"]
): FigmaTransactionPlan {
  return FigmaTransactionPlanSchema.parse({
    ...plan,
    transactions: plan.transactions.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, status } : transaction
    ),
  });
}
