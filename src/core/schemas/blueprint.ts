import { z } from "zod";
import { BoundsSchema } from "./artifact.js";

const IncrementalTextSchema = z.string().min(1).max(512);
const IncrementalRefSchema = z.string().min(1).max(2_048);
const MAX_BLUEPRINT_ITEMS = 200;

const BlueprintPatternKindSchema = z.enum([
  "table",
  "list",
  "timeline",
  "chart",
  "form",
  "detail-panel",
  "custom",
]);

const BlueprintStateScopeKindSchema = z.enum(["page", "region", "component", "flow"]);
const BlueprintRepeatedPatternKindSchema = z.enum(["rows", "cards", "events", "steps", "custom"]);

const BlueprintTraitRefSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema,
  kind: BlueprintPatternKindSchema,
});

const BlueprintStateScopeRefSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema,
  kind: BlueprintStateScopeKindSchema,
});

const BlueprintRepeatedPatternRefSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema,
  kind: BlueprintRepeatedPatternKindSchema,
});

export const BlueprintTraitsSchema = z.strictObject({
  regions: z.array(BlueprintTraitRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
  stateScopes: z.array(BlueprintStateScopeRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
  repeatedPatterns: z.array(BlueprintRepeatedPatternRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
  patternPackIds: z.array(IncrementalRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
});

const VariableRoleRequirementInputSchema = z.strictObject({
  property: z.enum(["fill", "text", "effect", "spacing", "radius", "stroke", "shadow"]),
  semanticRole: IncrementalTextSchema,
  optional: z.boolean().optional(),
});

const BlueprintUiPartInputSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema,
  role: IncrementalTextSchema.optional(),
  regionId: IncrementalRefSchema.optional(),
  variableRoles: z.array(VariableRoleRequirementInputSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
});

const BlueprintRepeatedPatternInputSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema,
  kind: BlueprintRepeatedPatternKindSchema.optional(),
  regionId: IncrementalRefSchema.optional(),
});

const BlueprintStateInputSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema.optional(),
  kind: IncrementalTextSchema,
});

export const ScreenBlueprintInputSchema = z
  .strictObject({
    schemaVersion: z.literal("ScreenBlueprintInput/v1"),
    id: IncrementalRefSchema.optional(),
    title: IncrementalTextSchema,
    productDomain: IncrementalTextSchema.optional(),
    description: z.string().min(1).max(8_192).optional(),
    confidence: z.enum(["explicit", "inferred", "low"]).optional(),
    requiredUiParts: z.array(BlueprintUiPartInputSchema).min(1).max(MAX_BLUEPRINT_ITEMS),
    regions: z.array(BlueprintTraitRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
    traits: BlueprintTraitsSchema.optional(),
    repeatedPatterns: z
      .array(BlueprintRepeatedPatternInputSchema)
      .max(MAX_BLUEPRINT_ITEMS)
      .optional(),
    states: z.array(BlueprintStateInputSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
    designSystemHints: z.array(IncrementalTextSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
  })
  .superRefine((blueprint, ctx) => {
    const ids = new Set<string>();
    blueprint.requiredUiParts.forEach((part, index) => {
      if (part.id === undefined) return;
      if (ids.has(part.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["requiredUiParts", index, "id"],
          message: `Duplicate blueprint UI part id ${part.id}.`,
        });
      }
      ids.add(part.id);
    });
  });

export const FlowBlueprintInputSchema = z
  .strictObject({
    schemaVersion: z.literal("FlowBlueprintInput/v1"),
    id: IncrementalRefSchema.optional(),
    title: IncrementalTextSchema,
    productDomain: IncrementalTextSchema.optional(),
    description: z.string().min(1).max(8_192).optional(),
    primaryScreenId: IncrementalRefSchema.optional(),
    entryScreenId: IncrementalRefSchema.optional(),
    screens: z.array(ScreenBlueprintInputSchema).min(1).max(MAX_BLUEPRINT_ITEMS),
    traits: BlueprintTraitsSchema.optional(),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    flow.screens.forEach((screen, index) => {
      if (screen.id === undefined) return;
      if (ids.has(screen.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["screens", index, "id"],
          message: `Duplicate flow screen id ${screen.id}.`,
        });
      }
      ids.add(screen.id);
    });

    for (const key of ["primaryScreenId", "entryScreenId"] as const) {
      const screenId = flow[key];
      if (screenId !== undefined && !ids.has(screenId)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must reference a screen id in the flow blueprint.`,
        });
      }
    }
  });

const CanvasTargetFrameInputSchema = z.strictObject({
  nodeId: IncrementalRefSchema,
  screenId: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema.optional(),
  bounds: BoundsSchema.optional(),
});

export const CanvasIntentInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("create-new-section"),
    sectionId: IncrementalRefSchema.optional(),
    sectionName: IncrementalTextSchema.optional(),
  }),
  z.strictObject({
    mode: z.literal("replace-existing-frame"),
    targetFrame: CanvasTargetFrameInputSchema,
  }),
  z.strictObject({
    mode: z.literal("refine-existing-targets"),
    scope: z.enum(["selected-frame", "selected-frames", "page"]),
    targets: z.array(CanvasTargetFrameInputSchema).max(MAX_BLUEPRINT_ITEMS),
  }),
]);

export const ExistingDesignInventoryInputSchema = z.strictObject({
  schemaVersion: z.literal("ExistingDesignInventoryInput/v1"),
  source: z.enum(["figma-scan", "plugin-selection", "assistant-observed"]),
  fileKey: IncrementalRefSchema.optional(),
  pageId: IncrementalRefSchema.optional(),
  pageName: IncrementalTextSchema.optional(),
  capturedAt: IncrementalTextSchema.optional(),
  targets: z
    .array(
      z.strictObject({
        nodeId: IncrementalRefSchema,
        name: IncrementalTextSchema,
        kind: z.enum(["frame", "section", "component", "instance", "group", "unknown"]),
        bounds: BoundsSchema.optional(),
        screenId: IncrementalRefSchema.optional(),
        role: IncrementalTextSchema.optional(),
        detectedTraits: BlueprintTraitsSchema.optional(),
        componentRefs: z.array(IncrementalRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
        variableRefs: z.array(IncrementalRefSchema).max(MAX_BLUEPRINT_ITEMS).optional(),
      })
    )
    .min(1)
    .max(MAX_BLUEPRINT_ITEMS),
});

export type ScreenBlueprintInput = z.infer<typeof ScreenBlueprintInputSchema>;
export type FlowBlueprintInput = z.infer<typeof FlowBlueprintInputSchema>;
export type CanvasIntentInput = z.infer<typeof CanvasIntentInputSchema>;
export type ExistingDesignInventoryInput = z.infer<typeof ExistingDesignInventoryInputSchema>;

export function primaryScreenFromFlowBlueprint(flow: FlowBlueprintInput): ScreenBlueprintInput {
  const preferredId = flow.primaryScreenId ?? flow.entryScreenId;
  if (preferredId !== undefined) {
    const screen = flow.screens.find((candidate) => candidate.id === preferredId);
    if (screen !== undefined) return screen;
  }
  return flow.screens[0];
}
