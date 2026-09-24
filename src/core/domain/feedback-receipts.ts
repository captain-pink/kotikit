import { KotikitError } from "../../util/result.js";

export type FeedbackReceipt = {
  changeId: string;
  status: "applied" | "skipped" | "blocked";
  recordedAt: string;
  reason?: string;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaNodeType?: string;
  figmaNodeName?: string;
  screenshotReviewed?: true;
};

export function feedbackReceiptProgress(value: unknown): {
  changeIds: string[];
  pendingChangeIds: string[];
  blockedChangeIds: string[];
  appliedCount: number;
  skippedCount: number;
} {
  const feedback = recordFrom(value);
  const handoff = recordFrom(feedback.handoff);
  const changeIds = stringArray(handoff.changeIds);
  const receipts = receiptArray(feedback.receipts);
  const receiptById = new Map(receipts.map((receipt) => [receipt.changeId, receipt]));
  return {
    changeIds,
    pendingChangeIds: changeIds.filter((id) => !receiptById.has(id)),
    blockedChangeIds: changeIds.filter((id) => receiptById.get(id)?.status === "blocked"),
    appliedCount: changeIds.filter((id) => receiptById.get(id)?.status === "applied").length,
    skippedCount: changeIds.filter((id) => receiptById.get(id)?.status === "skipped").length,
  };
}

export function compactFeedbackReceipts(value: unknown): FeedbackReceipt[] {
  return receiptArray(recordFrom(value).receipts);
}

export function recordFeedbackReceipt(
  value: unknown,
  receipt: FeedbackReceipt
): Record<string, unknown> {
  const feedback = recordFrom(value);
  const progress = feedbackReceiptProgress(feedback);
  if (recordFrom(feedback.handoff).status !== "approved-for-agent-apply") {
    throw new KotikitError(
      "This review run has no approved feedback changes to record.",
      "Approve the revision plan before recording an applied, skipped, or blocked change."
    );
  }
  if (!progress.changeIds.includes(receipt.changeId)) {
    throw new KotikitError(
      `Change ${receipt.changeId} is not in the approved revision plan.`,
      "Use a change id from this run's revision-plan artifact."
    );
  }
  const receipts = receiptArray(feedback.receipts);
  const previous = receipts.find((item) => item.changeId === receipt.changeId);
  if (previous?.status === "applied" || previous?.status === "skipped") {
    throw new KotikitError(
      `Change ${receipt.changeId} already has a final receipt.`,
      "Record each approved feedback change once."
    );
  }
  return {
    ...feedback,
    receipts: [...receipts.filter((item) => item.changeId !== receipt.changeId), receipt],
  };
}

export function assertFeedbackReceiptsComplete(value: unknown): void {
  const progress = feedbackReceiptProgress(value);
  if (
    progress.changeIds.length === 0 ||
    progress.pendingChangeIds.length > 0 ||
    progress.blockedChangeIds.length > 0
  ) {
    throw new KotikitError(
      "Approved feedback work is still unresolved.",
      "Apply or explicitly skip every approved change, record its receipt, then continue the run."
    );
  }
}

function receiptArray(value: unknown): FeedbackReceipt[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is FeedbackReceipt =>
          typeof item === "object" &&
          item !== null &&
          typeof item.changeId === "string" &&
          ["applied", "skipped", "blocked"].includes(item.status) &&
          (item.status !== "applied" ||
            (typeof item.figmaFileKey === "string" &&
              typeof item.figmaNodeId === "string" &&
              item.screenshotReviewed === true)) &&
          (item.status === "applied" || typeof item.reason === "string")
      )
    : [];
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}
