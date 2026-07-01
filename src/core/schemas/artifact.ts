import { z } from "zod";

export const KOTIKIT_ARTIFACT_SCHEMA_ID =
  "https://kotikit.dev/schemas/kotikit-artifact.schema.json";

export const ArtifactTypeSchema = z.enum([
  "design-brief",
  "screen-model",
  "flow-model",
  "design-system-fit-report",
  "figma-target",
  "ui-composition-contract",
  "layout-contract",
  "variable-binding-plan",
  "draft-component-plan",
  "draft-plan",
  "figma-apply-packet",
  "figma-apply-report",
  "ui-quality-gate-report",
  "review-session",
  "revision-plan",
  "design-memory-candidate",
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactSchemaVersionByType = {
  "design-brief": "DesignBrief/v1",
  "screen-model": "ScreenModel/v1",
  "flow-model": "FlowModel/v1",
  "design-system-fit-report": "DesignSystemFitReport/v1",
  "figma-target": "FigmaTarget/v1",
  "ui-composition-contract": "UICompositionContract/v1",
  "layout-contract": "LayoutContract/v1",
  "variable-binding-plan": "VariableBindingPlan/v1",
  "draft-component-plan": "DraftComponentPlan/v1",
  "draft-plan": "DraftPlan/v1",
  "figma-apply-packet": "FigmaApplyPacket/v1",
  "figma-apply-report": "FigmaApplyReport/v1",
  "ui-quality-gate-report": "UIQualityGateReport/v1",
  "review-session": "ReviewSession/v1",
  "revision-plan": "RevisionPlan/v1",
  "design-memory-candidate": "DesignMemoryCandidate/v1",
} as const satisfies Record<ArtifactType, string>;

const SourceNodeSchema = z.strictObject({
  key: z.string().min(1),
  version: z.string().min(1),
});

const UICompositionPartSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  source: z.enum(["existing-component", "draft-component", "approved-primitive"]),
  componentKey: z.string().min(1).optional(),
  draftComponentId: z.string().min(1).optional(),
  primitiveReason: z.string().min(1).optional(),
});

export const UICompositionContractSchema = z.strictObject({
  schemaVersion: z.literal("UICompositionContract/v1"),
  parts: z.array(UICompositionPartSchema).min(1),
  notes: z.array(z.string()).optional(),
});

const LayoutFrameSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().min(1).optional(),
  mode: z.enum(["auto-layout", "grid"]),
  direction: z.enum(["vertical", "horizontal"]).optional(),
  sizing: z.enum(["fixed", "hug", "fill"]).optional(),
  spacingToken: z.string().min(1).optional(),
  children: z.array(z.string().min(1)).optional(),
});

export const LayoutContractSchema = z.strictObject({
  schemaVersion: z.literal("LayoutContract/v1"),
  strategy: z.enum(["auto-layout", "grid", "mixed"]),
  frames: z.array(LayoutFrameSchema),
});

const VariableBindingSchema = z.strictObject({
  targetId: z.string().min(1),
  property: z.enum(["fill", "text", "effect", "spacing", "radius", "stroke", "shadow"]),
  source: z.enum(["variable", "style", "draft-variable", "approved-literal"]),
  name: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  literalValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  approvalRef: z.string().min(1).optional(),
});

export const VariableBindingPlanSchema = z.strictObject({
  schemaVersion: z.literal("VariableBindingPlan/v1"),
  bindings: z.array(VariableBindingSchema),
});

const DraftComponentSpecSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  reason: z.string().min(1),
  states: z.array(z.string().min(1)).optional(),
  requiredParts: z.array(z.string().min(1)).optional(),
});

export const DraftComponentPlanSchema = z.strictObject({
  schemaVersion: z.literal("DraftComponentPlan/v1"),
  sectionName: z.literal("Kotikit Draft Components"),
  components: z.array(DraftComponentSpecSchema),
});

const UIQualityGateCheckSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["passed", "blocked"]),
  findings: z.array(z.string().min(1)).optional(),
});

export const UIQualityGateReportSchema = z.strictObject({
  schemaVersion: z.literal("UIQualityGateReport/v1"),
  status: z.enum(["passed", "blocked"]),
  checks: z.array(UIQualityGateCheckSchema),
});

const GenericArtifactPayloadDataSchema = z.record(z.string(), z.json());

function createGenericArtifactPayloadSchema<SchemaVersion extends string>(
  schemaVersion: SchemaVersion
) {
  return z.strictObject({
    schemaVersion: z.literal(schemaVersion),
    summary: z.string().min(1).optional(),
    refs: z.array(z.string().min(1)).optional(),
    data: GenericArtifactPayloadDataSchema.optional(),
  });
}

export const DesignBriefPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-brief"]
);
export const ScreenModelPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["screen-model"]
);
export const FlowModelPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["flow-model"]
);
export const DesignSystemFitReportPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-system-fit-report"]
);
export const FigmaTargetPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["figma-target"]
);
export const DraftPlanPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["draft-plan"]
);
export const FigmaApplyPacketPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["figma-apply-packet"]
);
export const FigmaApplyReportPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["figma-apply-report"]
);
export const ReviewSessionPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["review-session"]
);
export const RevisionPlanPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["revision-plan"]
);
export const DesignMemoryCandidatePayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-memory-candidate"]
);

export const ArtifactPayloadSchema = z.union([
  DesignBriefPayloadSchema,
  ScreenModelPayloadSchema,
  FlowModelPayloadSchema,
  DesignSystemFitReportPayloadSchema,
  FigmaTargetPayloadSchema,
  UICompositionContractSchema,
  LayoutContractSchema,
  VariableBindingPlanSchema,
  DraftComponentPlanSchema,
  DraftPlanPayloadSchema,
  FigmaApplyPacketPayloadSchema,
  FigmaApplyReportPayloadSchema,
  UIQualityGateReportSchema,
  ReviewSessionPayloadSchema,
  RevisionPlanPayloadSchema,
  DesignMemoryCandidatePayloadSchema,
]);

export const ArtifactEnvelopeSchema = z.strictObject({
  id: z.string().min(1),
  runId: z.string().min(1),
  type: ArtifactTypeSchema,
  schemaVersion: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sourceNode: SourceNodeSchema,
  payload: ArtifactPayloadSchema,
  filesystemPath: z.string().min(1).optional(),
});

function createArtifactVariantSchema<Type extends ArtifactType>(
  type: Type,
  payloadSchema: z.ZodType
) {
  return ArtifactEnvelopeSchema.extend({
    type: z.literal(type),
    schemaVersion: z.literal(ArtifactSchemaVersionByType[type]),
    payload: payloadSchema,
  });
}

export const ArtifactVariantSchema = z.union([
  createArtifactVariantSchema("design-brief", DesignBriefPayloadSchema),
  createArtifactVariantSchema("screen-model", ScreenModelPayloadSchema),
  createArtifactVariantSchema("flow-model", FlowModelPayloadSchema),
  createArtifactVariantSchema("design-system-fit-report", DesignSystemFitReportPayloadSchema),
  createArtifactVariantSchema("figma-target", FigmaTargetPayloadSchema),
  createArtifactVariantSchema("ui-composition-contract", UICompositionContractSchema),
  createArtifactVariantSchema("layout-contract", LayoutContractSchema),
  createArtifactVariantSchema("variable-binding-plan", VariableBindingPlanSchema),
  createArtifactVariantSchema("draft-component-plan", DraftComponentPlanSchema),
  createArtifactVariantSchema("draft-plan", DraftPlanPayloadSchema),
  createArtifactVariantSchema("figma-apply-packet", FigmaApplyPacketPayloadSchema),
  createArtifactVariantSchema("figma-apply-report", FigmaApplyReportPayloadSchema),
  createArtifactVariantSchema("ui-quality-gate-report", UIQualityGateReportSchema),
  createArtifactVariantSchema("review-session", ReviewSessionPayloadSchema),
  createArtifactVariantSchema("revision-plan", RevisionPlanPayloadSchema),
  createArtifactVariantSchema("design-memory-candidate", DesignMemoryCandidatePayloadSchema),
]);

export const ArtifactSchema = ArtifactEnvelopeSchema.superRefine((artifact, ctx) => {
  const expectedSchemaVersion = schemaVersionForArtifactType(artifact.type);

  if (artifact.schemaVersion !== expectedSchemaVersion) {
    ctx.addIssue({
      code: "custom",
      path: ["schemaVersion"],
      message: `Expected ${expectedSchemaVersion} for ${artifact.type}.`,
    });
  }

  if (
    typeof artifact.payload === "object" &&
    artifact.payload !== null &&
    "schemaVersion" in artifact.payload &&
    artifact.payload.schemaVersion !== expectedSchemaVersion
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["payload", "schemaVersion"],
      message: `Expected payload schema ${expectedSchemaVersion} for ${artifact.type}.`,
    });
  }
});

function schemaVersionForArtifactType(type: ArtifactType): string {
  return ArtifactSchemaVersionByType[type];
}

export type Artifact = z.infer<typeof ArtifactSchema>;
export type UICompositionContract = z.infer<typeof UICompositionContractSchema>;
export type LayoutContract = z.infer<typeof LayoutContractSchema>;
export type VariableBindingPlan = z.infer<typeof VariableBindingPlanSchema>;
export type DraftComponentPlan = z.infer<typeof DraftComponentPlanSchema>;
export type UIQualityGateReport = z.infer<typeof UIQualityGateReportSchema>;
