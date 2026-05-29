import { z } from "zod";
import { KotikitError } from "../util/result.js";

// ─── Step kinds ──────────────────────────────────────────────────────────────

export const DesignPlanStepKindSchema = z.enum([
  "define-state-frame",
  "apply-auto-layout",
  "place-component",
  "bind-variable",
]);
export type DesignPlanStepKind = z.infer<typeof DesignPlanStepKindSchema>;

const StateFrameStepSchema = z.object({
  kind: z.literal("define-state-frame"),
  state: z.string(),
  width: z.number().int().positive().default(1440),
  height: z.union([z.number().int().positive(), z.literal("auto")]).default("auto"),
});

const AutoLayoutStepSchema = z.object({
  kind: z.literal("apply-auto-layout"),
  state: z.string(),
  direction: z.enum(["VERTICAL", "HORIZONTAL"]).default("VERTICAL"),
  padding: z.number().int().nonnegative().default(24),
  itemSpacing: z.number().int().nonnegative().default(16),
});

const PlaceComponentStepSchema = z.object({
  kind: z.literal("place-component"),
  state: z.string(),
  componentName: z.string(),
  dsKey: z.string().optional(),
  variant: z.record(z.string(), z.string()).optional(),
});

const BindVariableStepSchema = z.object({
  kind: z.literal("bind-variable"),
  state: z.string(),
  variableName: z.string(),
  property: z.enum(["fill", "text", "effect"]).default("fill"),
  nodeNameHint: z.string().optional(),
});

export const DesignPlanStepSchema = z.discriminatedUnion("kind", [
  StateFrameStepSchema,
  AutoLayoutStepSchema,
  PlaceComponentStepSchema,
  BindVariableStepSchema,
]);
export type DesignPlanStep = z.infer<typeof DesignPlanStepSchema>;

export const DesignPlanSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),
  pageName: z.string(),
  states: z.array(z.string()).min(1),
  steps: z.array(DesignPlanStepSchema).min(1),
  createdAt: z.string(),
});
export type DesignPlan = z.infer<typeof DesignPlanSchema>;

/** Parse helper that throws KotikitError on malformed input. */
export function parseDesignPlan(raw: unknown): DesignPlan {
  const result = DesignPlanSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map(i => i.path.join(".") || "root").join(", ");
    throw new KotikitError(
      "This design plan has an invalid format.",
      `Problem with: ${fields}. The file may have been edited manually and become malformed.`
    );
  }
  return result.data;
}
