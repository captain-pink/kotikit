/** Exposes only the stable feedback handoff fields from open graph state. */
export function compactFeedbackHandoff(value: unknown): Record<string, unknown> | undefined {
  const handoff = recordFrom(recordFrom(value).handoff);
  const status = stringField(handoff, "status");
  if (status === "skipped") return { status };
  if (status !== "approved-for-agent-apply") return undefined;
  const revisionPlanArtifactId = stringField(handoff, "revisionPlanArtifactId");
  const changeIds = stringArray(handoff.changeIds);
  if (revisionPlanArtifactId === undefined || changeIds === undefined || changeIds.length === 0) {
    return undefined;
  }
  return {
    status,
    revisionPlanArtifactId,
    changeIds,
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? value
    : undefined;
}
