import { z } from "zod";
import { KotikitError } from "../util/result.js";
import { ComponentVariablePolicySchema } from "../spec/schema.js";

export const ComponentPlanModeSchema = z.enum(["create-draft-components", "inline-draft"]);
export type ComponentPlanMode = z.infer<typeof ComponentPlanModeSchema>;

const ComponentTokenRefSchema = z.object({
  intent: z.enum(["surface", "text", "border", "spacing", "radius"]),
  kind: z.enum(["color", "text", "effect", "number", "spacing"]),
  name: z.string(),
  source: z.enum(["variable", "style"]),
  id: z.string().optional(),
  key: z.string().optional(),
});
export type ComponentTokenRef = z.infer<typeof ComponentTokenRefSchema>;

const BaseComponentPlanStepSchema = z.object({
  componentName: z.string(),
  usage: z.string().optional(),
  componentSpecRef: z.string().optional(),
  variablePolicy: ComponentVariablePolicySchema,
  tokenRefs: z.array(ComponentTokenRefSchema).default([]),
});

export const ComponentPlanStepSchema = z.discriminatedUnion("kind", [
  BaseComponentPlanStepSchema.extend({
    kind: z.literal("create-draft-component"),
  }),
  BaseComponentPlanStepSchema.extend({
    kind: z.literal("create-inline-draft"),
  }),
]);
export type ComponentPlanStep = z.infer<typeof ComponentPlanStepSchema>;

export const ComponentPlanSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),
  mode: ComponentPlanModeSchema,
  literalFallbackAllowed: z.boolean().default(false),
  requiresHumanReview: z.boolean().default(true),
  steps: z.array(ComponentPlanStepSchema).min(1),
  createdAt: z.string(),
});
export type ComponentPlan = z.infer<typeof ComponentPlanSchema>;

export function parseComponentPlan(raw: unknown): ComponentPlan {
  const result = ComponentPlanSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ");
    throw new KotikitError(
      "This component plan has an invalid format.",
      `Problem with: ${fields}. Delete it and create the component plan again.`
    );
  }
  return result.data;
}
