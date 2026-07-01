import { KotikitError } from "../../util/result.js";
import type { KotikitGraphState } from "../schemas/graph-state.js";

export type ContextBudgetReport = {
  schemaVersion: "ContextBudgetReport/v1";
  status: "passed" | "warning" | "blocked";
  serializedBytes: number;
  warningBytes: number;
  maxBytes: number;
  findings: string[];
};

export type ContextBudgetOptions = {
  warningBytes?: number;
  maxBytes?: number;
};

export const DEFAULT_CONTEXT_WARNING_BYTES = 128 * 1024;
export const DEFAULT_CONTEXT_MAX_BYTES = 256 * 1024;

export function buildContextBudgetReport(input: {
  state: KotikitGraphState;
  options?: ContextBudgetOptions;
}): ContextBudgetReport {
  const warningBytes = input.options?.warningBytes ?? DEFAULT_CONTEXT_WARNING_BYTES;
  const maxBytes = input.options?.maxBytes ?? DEFAULT_CONTEXT_MAX_BYTES;
  const serializedBytes = Buffer.byteLength(JSON.stringify(input.state), "utf8");
  const findings = [
    ...(serializedBytes > warningBytes
      ? [`Graph state is above warning budget: ${serializedBytes} bytes.`]
      : []),
    ...(serializedBytes > maxBytes
      ? [`Graph state is above hard budget: ${serializedBytes} bytes.`]
      : []),
  ];

  return {
    schemaVersion: "ContextBudgetReport/v1",
    status:
      serializedBytes > maxBytes
        ? "blocked"
        : serializedBytes > warningBytes
          ? "warning"
          : "passed",
    serializedBytes,
    warningBytes,
    maxBytes,
    findings,
  };
}

export function assertCompactGraphState(
  state: KotikitGraphState,
  options: ContextBudgetOptions = {}
): void {
  const report = buildContextBudgetReport({ state, options });
  if (report.status !== "blocked") return;
  throw new KotikitError(
    "This Kotikit run is carrying too much context to resume reliably.",
    "Persist raw Figma/comment data as artifacts and keep only compact contracts in graph state."
  );
}

export function pruneRawReviewPayloads(review: Record<string, unknown>): Record<string, unknown> {
  if (review.commentEvidenceMap === undefined) return review;
  const {
    commentEvidenceMap: _commentEvidenceMap,
    commentSnapshot: _commentSnapshot,
    nodeMap: _nodeMap,
    sourceSnapshot: _sourceSnapshot,
    ...rest
  } = review;
  return {
    ...rest,
    commentSnapshotRef: "comment-evidence-map",
  };
}
