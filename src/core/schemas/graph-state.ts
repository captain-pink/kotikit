import { z } from "zod";
import {
  ActiveFigmaTransactionSchema,
  ArtifactTypeSchema,
  CanvasPlanSchema,
  CanvasReconciliationReportSchema,
  CommentEvidenceMapSchema,
  DesignApproachSchema,
  DraftComponentLifecycleSchema,
  DraftComponentPlanSchema,
  FigmaNodeLedgerSchema,
  FigmaTransactionPlanSchema,
  LayoutContractSchema,
  StateMatrixSchema,
  UICompositionContractSchema,
  UIQualityGateReportSchema,
  UXEnvelopeSchema,
  VariableBindingPlanSchema,
} from "./artifact.js";
import {
  CanvasIntentInputSchema,
  ExistingDesignInventoryInputSchema,
  FlowBlueprintInputSchema,
  ScreenBlueprintInputSchema,
} from "./blueprint.js";
import { FigmaWritePreflightSchema } from "./figma-write-preflight.js";

export const KOTIKIT_GRAPH_STATE_SCHEMA_ID =
  "https://kotikit.dev/schemas/kotikit-graph-state.schema.json";
export const KOTIKIT_GRAPH_STATE_SCHEMA_VERSION = "KotikitGraphState/v1";

const ProjectRefSchema = z.strictObject({
  root: z.string().min(1),
  name: z.string().min(1).optional(),
});

const ArtifactRefSchema = z.strictObject({
  id: z.string().min(1),
  type: ArtifactTypeSchema,
  schemaVersion: z.string().min(1),
});

const WorkflowErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  hint: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
  count: z.number().int().positive().optional(),
  diagnostic: z
    .strictObject({
      expected: z.array(z.string().min(1)),
      found: z.array(z.string().min(1)),
      acceptedActions: z.array(z.string().min(1)),
    })
    .optional(),
});

const UserQuestionSchema = z.strictObject({
  id: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).optional(),
});

const ApprovalRequestSchema = z.strictObject({
  id: z.string().min(1),
  summary: z.string().min(1),
  artifactIds: z.array(z.string().min(1)).optional(),
});

const FigmaDefaultsSchema = z.strictObject({
  section: z.strictObject({
    background: z.strictObject({
      color: z
        .string()
        .regex(/^[0-9A-F]{6}$/)
        .default("AED0FF"),
      opacity: z.number().min(0).max(1).default(0.1),
    }),
  }),
});

export const KotikitGraphStateSchema = z.strictObject({
  schemaVersion: z.literal(KOTIKIT_GRAPH_STATE_SCHEMA_VERSION),
  runId: z.string().min(1),
  flowId: z.string().min(1),
  flowVersion: z.string().min(1),
  graphHash: z.string().min(1),
  status: z.enum(["running", "waiting-for-user", "waiting-for-figma", "blocked", "done"]),
  project: ProjectRefSchema,
  userIntent: z.string().min(1).optional(),
  screenBlueprint: ScreenBlueprintInputSchema.optional(),
  flowBlueprint: FlowBlueprintInputSchema.optional(),
  canvasIntent: CanvasIntentInputSchema.optional(),
  existingDesignInventory: ExistingDesignInventoryInputSchema.optional(),
  answers: z.record(z.string(), z.string().min(1)).optional(),
  brief: z.unknown().optional(),
  screen: z.unknown().optional(),
  flowModel: z.unknown().optional(),
  designSystem: z.unknown().optional(),
  fitReport: z.unknown().optional(),
  figmaTarget: z.unknown().optional(),
  figmaDefaults: FigmaDefaultsSchema.optional(),
  applyMetadata: z.unknown().optional(),
  figmaWritePreflight: FigmaWritePreflightSchema.optional(),
  figmaEvidenceSnapshots: z.array(z.unknown()).optional(),
  designApproach: DesignApproachSchema.optional(),
  uxEnvelope: UXEnvelopeSchema.optional(),
  stateMatrix: StateMatrixSchema.optional(),
  feedback: z.unknown().optional(),
  commentEvidenceMap: CommentEvidenceMapSchema.optional(),
  uiComposition: UICompositionContractSchema.optional(),
  stateRepresentation: z.unknown().optional(),
  layoutContract: LayoutContractSchema.optional(),
  variableBindingPlan: VariableBindingPlanSchema.optional(),
  draftComponentPlan: DraftComponentPlanSchema.optional(),
  draftComponentLifecycle: DraftComponentLifecycleSchema.optional(),
  draftPlan: z.unknown().optional(),
  applyReport: z.unknown().optional(),
  canvasPlan: CanvasPlanSchema.optional(),
  figmaTransactionPlan: FigmaTransactionPlanSchema.optional(),
  activeFigmaTransaction: ActiveFigmaTransactionSchema.optional(),
  figmaNodeLedger: FigmaNodeLedgerSchema.optional(),
  canvasReconciliation: CanvasReconciliationReportSchema.optional(),
  uiQualityGate: UIQualityGateReportSchema.optional(),
  pendingQuestion: UserQuestionSchema.optional(),
  pendingApproval: ApprovalRequestSchema.optional(),
  artifacts: z.array(ArtifactRefSchema),
  errors: z.array(WorkflowErrorSchema),
});

export type KotikitGraphState = z.infer<typeof KotikitGraphStateSchema>;
