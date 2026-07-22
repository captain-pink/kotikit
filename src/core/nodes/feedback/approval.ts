export const REVISION_APPROVAL_CHOICES = [
  "apply-feedback-changes",
  "skip-feedback-changes",
] as const;

export const REVISION_APPROVAL_PROMPT =
  "Approve this revision plan for the assistant to apply through Figma one change at a time?";

type RevisionApprovalAnswer = (typeof REVISION_APPROVAL_CHOICES)[number];

type FeedbackHandoff =
  | {
      status: "approved-for-agent-apply";
      revisionPlanArtifactId: string;
      changeIds: string[];
    }
  | { status: "skipped" };

/** Narrows graph answers to the two decisions advertised by the review prompt. */
export function isRevisionApprovalAnswer(value: unknown): value is RevisionApprovalAnswer {
  return REVISION_APPROVAL_CHOICES.some((choice) => choice === value);
}

/** Converts a validated designer decision into a compact assistant handoff. */
export function feedbackHandoffFrom(
  answer: RevisionApprovalAnswer,
  feedback: Record<string, unknown>,
  changes: Record<string, unknown>[]
): FeedbackHandoff | undefined {
  if (answer === "skip-feedback-changes") return { status: "skipped" };
  const revisionPlanArtifactId = stringField(feedback, "revisionPlanArtifactId");
  const changeIds = changes.flatMap((change) => {
    const changeId = stringField(change, "id");
    return changeId === undefined ? [] : [changeId];
  });
  return revisionPlanArtifactId === undefined || changeIds.length === 0
    ? undefined
    : { status: "approved-for-agent-apply", revisionPlanArtifactId, changeIds };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
