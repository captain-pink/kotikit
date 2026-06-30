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

export const ArtifactPayloadSchema = z.union([
  UICompositionContractSchema,
  LayoutContractSchema,
  VariableBindingPlanSchema,
  DraftComponentPlanSchema,
  UIQualityGateReportSchema,
]);

export const ArtifactSchema = z.strictObject({
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

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type UICompositionContract = z.infer<typeof UICompositionContractSchema>;
export type LayoutContract = z.infer<typeof LayoutContractSchema>;
export type VariableBindingPlan = z.infer<typeof VariableBindingPlanSchema>;
export type DraftComponentPlan = z.infer<typeof DraftComponentPlanSchema>;
export type UIQualityGateReport = z.infer<typeof UIQualityGateReportSchema>;
