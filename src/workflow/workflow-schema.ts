import { z } from "zod";

export const WorkflowIntentSchema = z.enum([
  "setup",
  "sync-design-system",
  "create-spec",
  "create-design",
  "review-comments",
  "design-review",
]);
export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>;

export const WorkflowStatusSchema = z.enum([
  "active",
  "waiting-for-user",
  "blocked",
  "completed",
  "failed",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowPhaseSchema = z.enum([
  "setup",
  "figma-token",
  "design-system-config",
  "design-system-sync",
  "variables",
  "brainstorm",
  "spec-confirmation",
  "spec-save",
  "draft-target",
  "design-plan",
  "component-decisions",
  "component-review",
  "bridge",
  "plugin-apply",
  "review-comments",
  "design-quality-review",
  "done",
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowEventNameSchema = z.enum([
  "user-approved-literal-fallback",
  "user-approved-comment-posting",
  "user-selected-component-mode",
  "user-confirmed-component-review",
  "user-provided-target",
  "tool-completed",
  "tool-failed",
]);
export type WorkflowEventName = z.infer<typeof WorkflowEventNameSchema>;

const WorkflowLastEventSchema = z.object({
  event: WorkflowEventNameSchema,
  summary: z.string().min(1),
  recordedAt: z.string().min(1),
});
export type WorkflowLastEvent = z.infer<typeof WorkflowLastEventSchema>;

export const WorkflowSessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  intent: WorkflowIntentSchema,
  status: WorkflowStatusSchema,
  currentPhase: WorkflowPhaseSchema,
  scope: z.string().optional(),
  screen: z.string().nullable().optional(),
  idea: z.string().optional(),
  figmaUrl: z.string().optional(),
  brainstormSessionId: z.string().uuid().optional(),
  completedMilestones: z.array(z.string()).default([]),
  approvals: z
    .object({
      allowLiteralFallback: z.boolean().optional(),
      postFigmaComments: z.boolean().optional(),
      reusableComponentsReviewed: z.boolean().optional(),
    })
    .default({}),
  pendingDecision: z
    .object({
      kind: z.string().min(1),
      summary: z.string().min(1),
    })
    .optional(),
  lastEvent: WorkflowLastEventSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type WorkflowSession = z.infer<typeof WorkflowSessionSchema>;

export interface WorkflowDesignSystemSnapshot {
  configured: boolean;
  synced: boolean;
  hasVariables: boolean;
  variablesSkipped: boolean;
  hasSyncCheckpoint: boolean;
}

export interface WorkflowBridgeSnapshot {
  running: boolean;
  staleConfig: boolean;
}

export interface WorkflowApplyProgress {
  applied: number;
  total: number;
  complete: boolean;
}

export interface WorkflowTargetSnapshot {
  scope: string;
  screen: string | null;
  specExists: boolean;
  flowExists: boolean;
  hasDraftTarget: boolean;
  hasDesignPlan: boolean;
  unresolvedComponents: string[];
  componentCreationRequired: string[];
  inlineDraftRequired: string[];
  applyProgress: WorkflowApplyProgress;
}

export interface WorkflowSnapshot {
  initialized: boolean;
  isGitRepo: boolean;
  hasFigmaToken: boolean;
  figmaFilesCount: number;
  designSystem: WorkflowDesignSystemSnapshot;
  bridge: WorkflowBridgeSnapshot;
  activeTarget?: WorkflowTargetSnapshot;
}

export const WorkflowNextActionSchema = z.enum(["ask-user", "call-tool", "done"]);
export type WorkflowNextAction = z.infer<typeof WorkflowNextActionSchema>;

export interface WorkflowNextResult {
  workflowId: string;
  status: Exclude<WorkflowStatus, "active" | "failed">;
  phase: WorkflowPhase;
  nextAction: WorkflowNextAction;
  instruction: string;
  allowedTools: string[];
  forbiddenTools: string[];
  refs: Record<string, string>;
}
