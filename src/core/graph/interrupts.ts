import type { KotikitGraphState } from "../schemas/graph-state.js";

export type RuntimeInterrupt = {
  status: Extract<KotikitGraphState["status"], "waiting-for-user" | "waiting-for-figma">;
  pendingQuestion?: NonNullable<KotikitGraphState["pendingQuestion"]>;
};

export function createUserInterrupt(
  pendingQuestion: NonNullable<KotikitGraphState["pendingQuestion"]>
): RuntimeInterrupt {
  return { status: "waiting-for-user", pendingQuestion };
}

export function isRuntimeInterrupt(value: unknown): value is RuntimeInterrupt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RuntimeInterrupt>;
  if (candidate.status === "waiting-for-user") {
    return isPendingQuestion(candidate.pendingQuestion);
  }
  return candidate.status === "waiting-for-figma";
}

function isPendingQuestion(
  value: RuntimeInterrupt["pendingQuestion"] | undefined
): value is NonNullable<RuntimeInterrupt["pendingQuestion"]> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.prompt === "string" &&
    value.prompt.length > 0
  );
}
