import type { KotikitGraphState } from "../schemas/graph-state.js";

export type RuntimeInterrupt = {
  status: Extract<KotikitGraphState["status"], "waiting-for-user" | "waiting-for-figma">;
  pendingQuestion?: NonNullable<KotikitGraphState["pendingQuestion"]>;
  resume?: "same-node" | "next-node";
};

export function createUserInterrupt(
  pendingQuestion: NonNullable<KotikitGraphState["pendingQuestion"]>
): RuntimeInterrupt {
  return { status: "waiting-for-user", pendingQuestion };
}

export function isRuntimeInterrupt(value: unknown): value is RuntimeInterrupt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as {
    status?: unknown;
    pendingQuestion?: unknown;
    resume?: unknown;
  };
  if (!isRuntimeResume(candidate.resume)) return false;
  if (candidate.status === "waiting-for-user") {
    return isPendingQuestion(candidate.pendingQuestion);
  }
  return candidate.status === "waiting-for-figma";
}

function isRuntimeResume(value: unknown): value is RuntimeInterrupt["resume"] {
  return value === undefined || value === "same-node" || value === "next-node";
}

function isPendingQuestion(
  value: unknown
): value is NonNullable<RuntimeInterrupt["pendingQuestion"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { id?: unknown; prompt?: unknown };
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.prompt === "string" &&
    candidate.prompt.length > 0
  );
}
