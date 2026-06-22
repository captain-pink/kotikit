import { z } from "zod";
import { KotikitError } from "../util/result.js";
import {
  COMPONENT_ROLES,
  EMPTY_LAYOUT_CONTRACT,
  LAYOUT_ZONE_IDS,
} from "./layout-contract.js";
import { FigmaDraftTargetSchema } from "../figma/draft-target.js";

// ─── Step kinds ──────────────────────────────────────────────────────────────

export const DESIGN_PLAN_STEP_KINDS = [
  "define-state-frame",
  "apply-auto-layout",
  "define-layout-zone",
  "place-component",
  "bind-variable",
] as const;

export const DesignPlanStepKindSchema = z.enum(DESIGN_PLAN_STEP_KINDS);
export type DesignPlanStepKind = z.infer<typeof DesignPlanStepKindSchema>;

export const ComponentRoleSchema = z.enum(COMPONENT_ROLES);
export type ComponentRole = z.infer<typeof ComponentRoleSchema>;

export const LayoutZoneIdSchema = z.enum(LAYOUT_ZONE_IDS);
export type LayoutZoneId = z.infer<typeof LayoutZoneIdSchema>;

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

const LayoutZoneStepSchema = z.object({
  kind: z.literal("define-layout-zone"),
  state: z.string(),
  zone: LayoutZoneIdSchema,
  parentZone: LayoutZoneIdSchema.default("root"),
  direction: z.enum(["VERTICAL", "HORIZONTAL"]).default("VERTICAL"),
  padding: z.number().int().nonnegative().default(0),
  itemSpacing: z.number().int().nonnegative().default(16),
  minTargetSize: z.number().int().positive().default(44),
});

const PlaceComponentStepSchema = z.object({
  kind: z.literal("place-component"),
  state: z.string(),
  componentName: z.string(),
  dsKey: z.string().optional(),
  variant: z.record(z.string(), z.string()).optional(),
  role: ComponentRoleSchema.optional(),
  zone: LayoutZoneIdSchema.optional(),
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
  LayoutZoneStepSchema,
  PlaceComponentStepSchema,
  BindVariableStepSchema,
]);
export type DesignPlanStep = z.infer<typeof DesignPlanStepSchema>;

const LayoutContractSchema = z.object({
  version: z.literal(1),
  strategy: z.literal("semantic-zones"),
  zones: z.array(z.object({
    id: LayoutZoneIdSchema,
    parent: LayoutZoneIdSchema,
    direction: z.enum(["VERTICAL", "HORIZONTAL"]),
    padding: z.number().int().nonnegative(),
    itemSpacing: z.number().int().nonnegative(),
    minTargetSize: z.number().int().positive(),
  })),
  placements: z.array(z.object({
    componentName: z.string(),
    role: ComponentRoleSchema,
    zone: LayoutZoneIdSchema,
  })),
});
export type DesignLayoutContract = z.infer<typeof LayoutContractSchema>;

export const DesignPlanSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),
  pageName: z.string(),
  target: FigmaDraftTargetSchema.optional(),
  states: z.array(z.string()).min(1),
  layout: LayoutContractSchema.default(EMPTY_LAYOUT_CONTRACT),
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
