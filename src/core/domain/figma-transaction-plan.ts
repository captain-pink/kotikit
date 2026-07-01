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
  assertCreationOrderCoversPlacements(input.placements, input.creationOrder);
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
  const active = [...plan.transactions]
    .filter((transaction) => transaction.status === "active")
    .sort((left, right) => left.order - right.order)[0];
  if (active !== undefined) return active;

  return [...plan.transactions]
    .filter((transaction) => transaction.status === "pending")
    .sort((left, right) => left.order - right.order)[0];
}

export function markTransactionActive(
  plan: FigmaTransactionPlan,
  transactionId: string
): FigmaTransactionPlan {
  const transaction = findTransactionOrThrow(plan, transactionId);
  if (transaction.status !== "pending") {
    throw new KotikitError(
      `Figma transaction ${transactionId} cannot be marked active from ${transaction.status}.`,
      "Advance only the next pending Figma transaction."
    );
  }
  const existingActive = plan.transactions.find(
    (candidate) => candidate.status === "active" && candidate.id !== transactionId
  );
  if (existingActive !== undefined) {
    throw new KotikitError(
      `Figma transaction ${existingActive.id} is already active.`,
      "Record or fail the active transaction before starting another Figma transaction."
    );
  }
  return updateTransactionStatus(plan, transactionId, "active");
}

export function recordTransactionMetadata(
  plan: FigmaTransactionPlan,
  metadata: { transactionId: string }
): FigmaTransactionPlan {
  const transaction = findTransactionOrThrow(plan, metadata.transactionId);
  if (transaction.status !== "active") {
    throw new KotikitError(
      `Figma transaction ${metadata.transactionId} cannot record metadata from ${transaction.status}.`,
      "Mark the pending transaction active before recording Figma metadata."
    );
  }
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

function assertCreationOrderCoversPlacements(
  placements: CanvasPlan["placements"],
  creationOrder: string[]
): void {
  const placementsById = new Map(placements.map((placement) => [placement.id, placement]));
  const seenPlacementIds = new Set<string>();

  for (const placementId of creationOrder) {
    if (!placementsById.has(placementId)) {
      throw new KotikitError(
        `Figma transaction plan references unknown canvas placement ${placementId}.`,
        "Regenerate the canvas plan before building Figma transactions."
      );
    }
    if (seenPlacementIds.has(placementId)) {
      throw new KotikitError(
        `Figma transaction plan creation order repeats canvas placement ${placementId}.`,
        "Keep each canvas placement in the creation order exactly once."
      );
    }
    seenPlacementIds.add(placementId);
  }

  const omittedPlacement = placements.find((placement) => !seenPlacementIds.has(placement.id));
  if (omittedPlacement !== undefined) {
    throw new KotikitError(
      `Figma transaction plan creation order omits canvas placement ${omittedPlacement.id}.`,
      "Keep each canvas placement in the creation order exactly once."
    );
  }
}

function findTransactionOrThrow(
  plan: FigmaTransactionPlan,
  transactionId: string
): FigmaTransaction {
  const transaction = plan.transactions.find((candidate) => candidate.id === transactionId);
  if (transaction !== undefined) return transaction;

  throw new KotikitError(
    `Figma transaction plan has no transaction ${transactionId}.`,
    "Refresh the transaction queue before recording Figma metadata."
  );
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
