import { feedbackReceiptProgress } from "../../core/domain/feedback-receipts.js";
import type { RuntimeRunResult } from "../../core/graph/runtime.js";
import { compactFeedbackHandoff } from "./feedback-handoff.js";

/** One compact instruction for the assistant; the graph remains the source of truth. */
export function nextActionForRun(
  result: RuntimeRunResult,
  phase: "normal" | "prepared-write" | "bound-target" = "normal"
): Record<string, unknown> {
  const { runId, state, status } = result;
  if (status === "waiting-for-user") {
    const question = state.pendingQuestion;
    if (question?.id === "provide-typed-blueprint") {
      return {
        kind: "provide-blueprint",
        tool: "kotikit_answer",
        runId,
        schemaUris: [
          "kotikit://schemas/screen-blueprint-input",
          "kotikit://schemas/flow-blueprint-input",
        ],
        instruction:
          "Build one validated typed blueprint from the original request and answer this run with it. For a multi-screen blueprint, choose the primary screen for this run.",
      };
    }
    return {
      kind: "answer-question",
      tool: "kotikit_answer",
      runId,
      ...(question === undefined ? {} : { questionId: question.id, prompt: question.prompt }),
    };
  }

  if (status === "waiting-for-figma") {
    if (state.flowId === "review-screen") {
      const handoff = compactFeedbackHandoff(state.feedback);
      if (handoff?.status !== "approved-for-agent-apply") {
        return {
          kind: "recover",
          runId,
          instruction: "Inspect the review handoff before continuing.",
        };
      }
      const { pendingChangeIds, blockedChangeIds } = feedbackReceiptProgress(state.feedback);
      if (pendingChangeIds.length === 0 && blockedChangeIds.length === 0) {
        return { kind: "continue", tool: "kotikit_continue", runId };
      }
      return {
        kind: "apply-feedback",
        tool: "kotikit_record_feedback_change",
        runId,
        revisionPlanArtifactId: handoff.revisionPlanArtifactId,
        pendingChangeIds,
        blockedChangeIds,
        instruction:
          "Apply each approved change through official Figma MCP, inspect the visible result, and record an applied, skipped, or blocked receipt for that change.",
      };
    }
    const active = state.activeFigmaTransaction;
    if (active === undefined) {
      return { kind: "recover", runId, instruction: "Inspect run errors before continuing." };
    }
    const recorded = recordFrom(state.applyMetadata).transactionId === active.id;
    if (recorded) return { kind: "continue", tool: "kotikit_continue", runId };
    if (phase !== "prepared-write") {
      return {
        kind: "prepare-figma-write",
        tool: "kotikit_prepare_figma_write",
        runId,
        transactionId: active.id,
      };
    }
    const packet = state.artifacts.findLast((artifact) => artifact.type === "figma-apply-packet");
    return {
      kind: "apply-and-record-figma-write",
      runId,
      transactionId: active.id,
      preflightId: state.figmaWritePreflight?.id,
      ...(packet === undefined ? {} : { applyPacketArtifactId: packet.id }),
      recordTool: "kotikit_record_figma_apply",
      instruction:
        "Apply only this transaction through official Figma MCP, inspect its visible result, then record evidence before continuing.",
    };
  }

  if (status === "blocked") {
    const error = state.errors.at(-1);
    if (error?.nodeId === "ensure-draft-target") {
      if (phase === "bound-target") {
        return { kind: "continue", tool: "kotikit_continue", runId };
      }
      return {
        kind: "bind-figma-target",
        tool: "kotikit_bind_figma_target",
        runId,
        instruction: "Bind the exact safe draft page URL, then call kotikit_continue.",
      };
    }
    return {
      kind: "recover",
      runId,
      ...(error === undefined
        ? {}
        : { code: error.code, nodeId: error.nodeId, message: error.message, hint: error.hint }),
      instruction:
        error?.code === "node-failed"
          ? "Keep this run ID and report the failure; do not retry a Figma write blindly."
          : (error?.hint ?? "Resolve the blocker, then call kotikit_continue."),
    };
  }

  if (status === "done") {
    const handoff = compactFeedbackHandoff(state.feedback);
    if (handoff?.status === "approved-for-agent-apply") {
      const { pendingChangeIds, blockedChangeIds } = feedbackReceiptProgress(state.feedback);
      if (pendingChangeIds.length === 0 && blockedChangeIds.length === 0) {
        return { kind: "finish", runId };
      }
      return {
        kind: "apply-feedback",
        tool: "kotikit_record_feedback_change",
        runId,
        revisionPlanArtifactId: handoff.revisionPlanArtifactId,
        changeIds: handoff.changeIds,
        pendingChangeIds,
        blockedChangeIds,
        instruction:
          "Apply the remaining approved changes through official Figma MCP and record a receipt for each one.",
      };
    }
    return { kind: "finish", runId };
  }

  return { kind: "continue", tool: "kotikit_continue", runId };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
