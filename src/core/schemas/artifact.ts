import { z } from "zod";

export const KOTIKIT_ARTIFACT_SCHEMA_ID =
  "https://kotikit.dev/schemas/kotikit-artifact.schema.json";

export const ArtifactTypeSchema = z.enum([
  "design-brief",
  "design-approach",
  "screen-model",
  "flow-model",
  "ux-envelope",
  "state-matrix",
  "design-system-fit-report",
  "design-system-reuse-plan",
  "design-system-usage-report",
  "figma-target",
  "ui-composition-contract",
  "layout-contract",
  "variable-binding-plan",
  "draft-component-plan",
  "draft-component-lifecycle",
  "draft-plan",
  "figma-apply-packet",
  "figma-apply-report",
  "canvas-plan",
  "figma-transaction-plan",
  "figma-node-ledger",
  "canvas-reconciliation-report",
  "ui-quality-gate-report",
  "comment-evidence-map",
  "revision-plan",
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactSchemaVersionByType = {
  "design-brief": "DesignBrief/v1",
  "design-approach": "DesignApproach/v1",
  "screen-model": "ScreenModel/v1",
  "flow-model": "FlowModel/v1",
  "ux-envelope": "UXEnvelope/v1",
  "state-matrix": "StateMatrix/v1",
  "design-system-fit-report": "DesignSystemFitReport/v1",
  "design-system-reuse-plan": "DesignSystemReusePlan/v1",
  "design-system-usage-report": "DesignSystemUsageReport/v1",
  "figma-target": "FigmaTarget/v1",
  "ui-composition-contract": "UICompositionContract/v1",
  "layout-contract": "LayoutContract/v1",
  "variable-binding-plan": "VariableBindingPlan/v1",
  "draft-component-plan": "DraftComponentPlan/v1",
  "draft-component-lifecycle": "DraftComponentLifecycle/v1",
  "draft-plan": "DraftPlan/v1",
  "figma-apply-packet": "FigmaApplyPacket/v1",
  "figma-apply-report": "FigmaApplyReport/v1",
  "canvas-plan": "CanvasPlan/v1",
  "figma-transaction-plan": "FigmaTransactionPlan/v1",
  "figma-node-ledger": "FigmaNodeLedger/v1",
  "canvas-reconciliation-report": "CanvasReconciliationReport/v1",
  "ui-quality-gate-report": "UIQualityGateReport/v1",
  "comment-evidence-map": "CommentEvidenceMap/v1",
  "revision-plan": "RevisionPlan/v1",
} as const satisfies Record<ArtifactType, string>;

const SourceNodeSchema = z.strictObject({
  key: z.string().min(1),
  version: z.string().min(1),
});

// Compact incremental Figma contracts: large raw Figma payloads belong in artifacts/files, not graph state.
const INCREMENTAL_TEXT_MAX = 512;
const INCREMENTAL_REF_MAX = 2_048;
const INCREMENTAL_ARRAY_MAX = 500;
const INCREMENTAL_COORDINATE_LIMIT = 1_000_000;
const INCREMENTAL_DIMENSION_MAX = 100_000;

const IncrementalTextSchema = z.string().min(1).max(INCREMENTAL_TEXT_MAX);
const IncrementalRefSchema = z.string().min(1).max(INCREMENTAL_REF_MAX);

export const BoundsSchema = z.strictObject({
  x: z.number().min(-INCREMENTAL_COORDINATE_LIMIT).max(INCREMENTAL_COORDINATE_LIMIT),
  y: z.number().min(-INCREMENTAL_COORDINATE_LIMIT).max(INCREMENTAL_COORDINATE_LIMIT),
  width: z.number().positive().max(INCREMENTAL_DIMENSION_MAX),
  height: z.number().positive().max(INCREMENTAL_DIMENSION_MAX),
});

const CanvasSectionRefSchema = z.strictObject({
  id: IncrementalRefSchema.optional(),
  name: IncrementalTextSchema,
});

const FigmaSectionStyleSchema = z.strictObject({
  background: z.strictObject({
    color: z
      .string()
      .regex(/^[0-9A-F]{6}$/)
      .default("AED0FF"),
    opacity: z.number().min(0).max(1).default(0.1),
  }),
});

const ScreenSizeSchema = z.strictObject({
  width: z.number().positive().max(INCREMENTAL_DIMENSION_MAX),
  height: z.number().positive().max(INCREMENTAL_DIMENSION_MAX),
});

const CanvasZoneSchema = z.strictObject({
  id: IncrementalRefSchema,
  kind: z.enum(["draft-components", "screen-states", "review-notes"]),
  label: IncrementalTextSchema,
  bounds: BoundsSchema,
});

const CanvasPlacementSchema = z.strictObject({
  id: IncrementalRefSchema,
  kind: z.enum(["screen-state", "draft-component", "annotation"]),
  stateId: IncrementalRefSchema.optional(),
  draftComponentId: IncrementalRefSchema.optional(),
  label: IncrementalTextSchema,
  bounds: BoundsSchema,
  parentZoneId: IncrementalRefSchema,
  transactionId: IncrementalRefSchema,
});

const CanvasPlanStrategySchema = z.strictObject({
  primaryFirst: z.boolean(),
  creationOrder: z.array(IncrementalRefSchema).max(INCREMENTAL_ARRAY_MAX),
  designerNotes: z.array(z.string().min(1).max(INCREMENTAL_REF_MAX)).max(INCREMENTAL_ARRAY_MAX),
});

export const CanvasPlanSchema = z
  .strictObject({
    schemaVersion: z.literal("CanvasPlan/v1"),
    section: CanvasSectionRefSchema,
    coordinateSpace: z.literal("section-relative"),
    screenSize: ScreenSizeSchema,
    minGap: z.number().nonnegative().max(INCREMENTAL_DIMENSION_MAX),
    sectionStyle: FigmaSectionStyleSchema.default({
      background: { color: "AED0FF", opacity: 0.1 },
    }),
    zones: z.array(CanvasZoneSchema).max(INCREMENTAL_ARRAY_MAX),
    placements: z.array(CanvasPlacementSchema).max(INCREMENTAL_ARRAY_MAX),
    strategy: CanvasPlanStrategySchema,
  })
  .superRefine((plan, ctx) => {
    const zoneIds = new Set<string>();
    const placementIds = new Set<string>();
    const transactionIds = new Set<string>();

    plan.zones.forEach((zone, index) => {
      if (zoneIds.has(zone.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["zones", index, "id"],
          message: `Duplicate zone id ${zone.id}.`,
        });
      }
      zoneIds.add(zone.id);
    });

    plan.placements.forEach((placement, index) => {
      if (!zoneIds.has(placement.parentZoneId)) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", index, "parentZoneId"],
          message: `Unknown parent zone ${placement.parentZoneId}.`,
        });
      }

      if (placementIds.has(placement.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", index, "id"],
          message: `Duplicate placement id ${placement.id}.`,
        });
      }
      placementIds.add(placement.id);

      if (transactionIds.has(placement.transactionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", index, "transactionId"],
          message: `Duplicate transaction id ${placement.transactionId}.`,
        });
      }
      transactionIds.add(placement.transactionId);

      if (placement.kind === "screen-state" && placement.stateId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", index, "stateId"],
          message: "Screen-state placements require stateId.",
        });
      }

      if (placement.kind === "draft-component" && placement.draftComponentId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", index, "draftComponentId"],
          message: "Draft-component placements require draftComponentId.",
        });
      }
    });

    const orderedPlacementIds = new Set<string>();
    plan.strategy.creationOrder.forEach((placementId, index) => {
      if (!placementIds.has(placementId)) {
        ctx.addIssue({
          code: "custom",
          path: ["strategy", "creationOrder", index],
          message: `Creation order references unknown placement ${placementId}.`,
        });
      }

      if (orderedPlacementIds.has(placementId)) {
        ctx.addIssue({
          code: "custom",
          path: ["strategy", "creationOrder", index],
          message: `Duplicate creation order placement ${placementId}.`,
        });
      }
      orderedPlacementIds.add(placementId);
    });

    placementIds.forEach((placementId) => {
      if (!orderedPlacementIds.has(placementId)) {
        ctx.addIssue({
          code: "custom",
          path: ["strategy", "creationOrder"],
          message: `Creation order omits placement ${placementId}.`,
        });
      }
    });
  });

const FigmaTransactionKindSchema = z.enum([
  "create-draft-component",
  "create-screen-state",
  "create-region-state",
  "verify-created-node",
]);

const FigmaTransactionStatusSchema = z.enum(["pending", "active", "recorded", "failed"]);

const FigmaTransactionMetadataSchema = z.enum([
  "node-id",
  "bounds",
  "auto-layout",
  "component-refs",
  "component-source",
  "icon-refs",
  "variable-refs",
]);

const ActiveFigmaTransactionBaseSchema = z.strictObject({
  id: IncrementalRefSchema,
  order: z.number().int().positive(),
  kind: FigmaTransactionKindSchema,
  label: IncrementalTextSchema,
  placementId: IncrementalRefSchema,
  stateId: IncrementalRefSchema.optional(),
  draftComponentId: IncrementalRefSchema.optional(),
  requiredMetadata: z.array(FigmaTransactionMetadataSchema).min(1).max(INCREMENTAL_ARRAY_MAX),
});

function addFigmaTransactionExecutableRefIssues(
  transaction: z.infer<typeof ActiveFigmaTransactionBaseSchema>,
  ctx: {
    addIssue: (issue: { code: "custom"; path: Array<string | number>; message: string }) => void;
  },
  path: Array<string | number>
): void {
  if (
    (transaction.kind === "create-screen-state" || transaction.kind === "create-region-state") &&
    transaction.stateId === undefined
  ) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "stateId"],
      message: `${transaction.kind} transactions require stateId.`,
    });
  }

  if (transaction.kind === "create-draft-component" && transaction.draftComponentId === undefined) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "draftComponentId"],
      message: "create-draft-component transactions require draftComponentId.",
    });
  }
}

export const ActiveFigmaTransactionSchema = ActiveFigmaTransactionBaseSchema.superRefine(
  (transaction, ctx) => {
    addFigmaTransactionExecutableRefIssues(transaction, ctx, []);
  }
);

const FigmaTransactionSchema = ActiveFigmaTransactionSchema.extend({
  status: FigmaTransactionStatusSchema,
});

export const FigmaTransactionPlanSchema = z
  .strictObject({
    schemaVersion: z.literal("FigmaTransactionPlan/v1"),
    mode: z.literal("incremental-official-figma-mcp"),
    transactions: z.array(FigmaTransactionSchema).max(INCREMENTAL_ARRAY_MAX),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    const orders = new Set<number>();

    plan.transactions.forEach((transaction, index) => {
      if (ids.has(transaction.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["transactions", index, "id"],
          message: `Duplicate transaction id ${transaction.id}.`,
        });
      }
      ids.add(transaction.id);

      if (orders.has(transaction.order)) {
        ctx.addIssue({
          code: "custom",
          path: ["transactions", index, "order"],
          message: `Duplicate transaction order ${transaction.order}.`,
        });
      }
      orders.add(transaction.order);
    });
  });

const FigmaNodeSemanticRoleSchema = z.enum([
  "screen-state",
  "draft-component",
  "component-instance",
  "layout-frame",
  "annotation",
]);

const FigmaNodeLedgerEntrySchema = z.strictObject({
  nodeId: IncrementalRefSchema,
  name: IncrementalTextSchema,
  kind: IncrementalTextSchema,
  semanticRole: FigmaNodeSemanticRoleSchema,
  transactionId: IncrementalRefSchema,
  placementId: IncrementalRefSchema,
  stateId: IncrementalRefSchema.optional(),
  representation: z
    .enum(["screen-frame", "region-state", "component-state", "flow-step"])
    .optional(),
  draftComponentId: IncrementalRefSchema.optional(),
  partId: IncrementalRefSchema.optional(),
  bounds: BoundsSchema,
  componentRefs: z.array(IncrementalRefSchema).max(INCREMENTAL_ARRAY_MAX),
  componentSource: z
    .enum(["existing-component", "draft-component", "screen-draft", "approved-primitive"])
    .optional(),
  variableRefs: z.array(IncrementalRefSchema).max(INCREMENTAL_ARRAY_MAX),
  iconRefs: z.array(IncrementalRefSchema).max(INCREMENTAL_ARRAY_MAX).optional(),
  iconKey: IncrementalRefSchema.optional(),
  iconPlaceholder: z.boolean().optional(),
  autoLayout: z.boolean(),
  recordedAt: IncrementalRefSchema,
});

export const FigmaNodeLedgerSchema = z
  .strictObject({
    schemaVersion: z.literal("FigmaNodeLedger/v1"),
    fileKey: IncrementalRefSchema,
    pageId: IncrementalRefSchema,
    sectionName: IncrementalTextSchema,
    nodes: z.array(FigmaNodeLedgerEntrySchema).max(INCREMENTAL_ARRAY_MAX),
    updatedAt: IncrementalRefSchema,
  })
  .superRefine((ledger, ctx) => {
    const nodeIds = new Set<string>();

    ledger.nodes.forEach((node, index) => {
      if (nodeIds.has(node.nodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "nodeId"],
          message: `Duplicate ledger node id ${node.nodeId}.`,
        });
      }
      nodeIds.add(node.nodeId);
    });
  });

const CanvasReconciliationNodeSchema = z.strictObject({
  nodeId: IncrementalRefSchema,
  ledgerStatus: z.enum(["matched", "moved", "renamed", "missing", "untracked"]),
  previousName: IncrementalTextSchema.optional(),
  currentName: IncrementalTextSchema.optional(),
  previousBounds: BoundsSchema.optional(),
  currentBounds: BoundsSchema.optional(),
  transactionId: IncrementalRefSchema.optional(),
  placementId: IncrementalRefSchema.optional(),
  stateId: IncrementalRefSchema.optional(),
});

export const CanvasReconciliationReportSchema = z.strictObject({
  schemaVersion: z.literal("CanvasReconciliationReport/v1"),
  fileKey: IncrementalRefSchema,
  pageId: IncrementalRefSchema,
  reconciledAt: IncrementalRefSchema,
  nodes: z.array(CanvasReconciliationNodeSchema).max(INCREMENTAL_ARRAY_MAX),
  unmappedCommentsRisk: z.enum(["none", "low", "needs-human"]),
});

const IconAffordanceSchema = z.strictObject({
  id: z.string().min(1),
  semantic: z.string().min(1),
  source: z.enum(["local-design-system", "approved-external"]),
  iconKey: z.string().min(1).optional(),
  iconName: z.string().min(1).optional(),
  required: z.boolean().optional(),
  reason: z.string().min(1).optional(),
});

const UICompositionPartSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  placement: z
    .enum([
      "left-sidebar",
      "top-bar",
      "top-right-action",
      "main-content",
      "table-body",
      "center-region",
      "right-rail",
      "footer",
      "modal",
      "unknown",
    ])
    .optional(),
  source: z.enum(["existing-component", "draft-component", "screen-draft", "approved-primitive"]),
  componentKey: z.string().min(1).optional(),
  draftComponentId: z.string().min(1).optional(),
  extractionCandidate: z.boolean().optional(),
  primitiveReason: z.string().min(1).optional(),
  iconAffordances: z.array(IconAffordanceSchema).optional(),
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
  key: z.string().min(1).optional(),
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

const DesignApproachAlternativeSchema = z.strictObject({
  name: z.string().min(1),
  tradeoff: z.string().min(1),
});

export const DesignApproachSchema = z.strictObject({
  schemaVersion: z.literal("DesignApproach/v1"),
  goal: z.string().min(1),
  userWorkflow: z.string().min(1),
  recommendedApproach: z.string().min(1),
  alternativesConsidered: z.array(DesignApproachAlternativeSchema).min(2).max(3),
  stateStrategy: z.string().min(1),
  layoutStrategy: z.string().min(1),
  designSystemStrategy: z.string().min(1),
  iconStrategy: z.string().min(1),
  assumptions: z.array(z.string().min(1)).max(8),
  risks: z.array(z.string().min(1)).max(8),
  openQuestion: z.string().min(1).optional(),
  decision: z.enum(["proceed", "ask-designer"]),
});

export const UXEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("UXEnvelope/v1"),
  screenArchetype: z.enum([
    "admin-data-table",
    "dashboard",
    "settings-form",
    "detail-page",
    "creation-flow",
    "review-workflow",
    "unknown",
  ]),
  confidence: z.enum(["observed", "inferred", "low"]),
  actor: z.string().min(1),
  primaryGoal: z.string().min(1),
  primaryTask: z.string().min(1),
  secondaryTasks: z.array(z.string().min(1)),
  dataModel: z.strictObject({
    primaryEntity: z.string().min(1),
    expectedVolume: z.enum(["zero", "one", "few", "many", "unknown"]),
    fields: z.array(z.string().min(1)),
  }),
  permissions: z.array(z.string().min(1)),
  edgeCases: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().url()),
});

const StateMatrixStateSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "filled",
    "loading",
    "empty",
    "no-results",
    "error",
    "permission",
    "success",
    "custom",
  ]),
  scope: z.enum(["page", "region", "component", "flow"]),
  affectedRegion: z.string().min(1).optional(),
  persistentRegions: z.array(z.string().min(1)),
  replacementBehavior: z.enum([
    "same-frame-variant",
    "replace-whole-page",
    "replace-region-content",
    "replace-table-body",
    "inline-feedback",
    "blocking-dialog",
  ]),
  requiredComponents: z.array(z.string().min(1)),
  copy: z
    .strictObject({
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
    })
    .optional(),
  primaryAction: z.string().min(1).optional(),
  secondaryAction: z.string().min(1).optional(),
  sourceRefs: z.array(z.string().url()),
});

export const StateMatrixSchema = z.strictObject({
  schemaVersion: z.literal("StateMatrix/v1"),
  states: z.array(StateMatrixStateSchema),
});

const CommentEvidenceTargetSchema = z.strictObject({
  nodeId: z.string().min(1),
  nodeName: z.string().min(1).optional(),
  partId: z.string().min(1).optional(),
  stateId: z.string().min(1).optional(),
  componentKey: z.string().min(1).optional(),
  draftComponentId: z.string().min(1).optional(),
  bounds: BoundsSchema.optional(),
});

const CommentEvidenceItemSchema = z.strictObject({
  commentId: z.string().min(1),
  rootCommentId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  orderId: z.number().optional(),
  message: z.string(),
  author: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  resolvedAt: z.string().min(1).optional(),
  clientMeta: z.unknown().optional(),
  mappedTarget: CommentEvidenceTargetSchema.optional(),
  mappingConfidence: z.enum(["exact", "high", "medium", "low", "none"]),
  mappingStrategy: z.enum([
    "node-id",
    "parent-thread",
    "frame-offset",
    "region-overlap",
    "nearest-known-target",
    "unmapped",
  ]),
  intent: z.enum([
    "question",
    "bug-usability",
    "visual-polish",
    "copy-content",
    "design-system-mismatch",
    "implementation-handoff",
    "preference",
    "out-of-scope",
    "needs-human-clarification",
  ]),
  status: z.enum(["actionable", "needs-human", "non-actionable", "resolved"]),
});

export const CommentEvidenceMapSchema = z.strictObject({
  schemaVersion: z.literal("CommentEvidenceMap/v1"),
  fileKey: z.string().min(1),
  mappedAt: z.string().min(1),
  comments: z.array(CommentEvidenceItemSchema),
  unmappedCount: z.number().int().nonnegative(),
});

const DraftComponentLifecycleInstanceSchema = z.strictObject({
  nodeId: z.string().min(1),
  stateId: z.string().min(1).optional(),
});

const DraftComponentLifecyclePlacementSchema = z.strictObject({
  pageId: z.string().min(1).optional(),
  sectionName: z.string().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

const DraftComponentLifecycleItemSchema = z.strictObject({
  draftComponentId: z.string().min(1),
  name: z.string().min(1),
  reason: z.string().min(1),
  componentKey: z.string().min(1).optional(),
  componentNodeId: z.string().min(1).optional(),
  placement: DraftComponentLifecyclePlacementSchema,
  requiredInstances: z.number().int().nonnegative(),
  actualInstances: z.array(DraftComponentLifecycleInstanceSchema),
  status: z.enum([
    "planned",
    "created",
    "used",
    "unused-approved",
    "orphan-blocked",
    "overlap-blocked",
  ]),
  promotionNote: z.string().min(1).optional(),
});

export const DraftComponentLifecycleSchema = z.strictObject({
  schemaVersion: z.literal("DraftComponentLifecycle/v1"),
  sectionName: z.literal("Kotikit Draft Components"),
  components: z.array(DraftComponentLifecycleItemSchema),
});

const UIQualityGateCheckSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["passed", "blocked"]),
  findings: z.array(z.string().min(1)).optional(),
  recommendedAction: z.string().min(1).optional(),
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

const DesignBriefPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-brief"]
);
const ScreenModelPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["screen-model"]
);
const FlowModelPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["flow-model"]
);
const DesignSystemFitReportPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-system-fit-report"]
);
const DesignSystemReusePlanPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-system-reuse-plan"]
);
const DesignSystemUsageReportPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["design-system-usage-report"]
);
const FigmaTargetPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["figma-target"]
);
const DraftPlanPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["draft-plan"]
);
const FigmaApplyPacketPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["figma-apply-packet"]
);
const FigmaApplyReportPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["figma-apply-report"]
);
const RevisionPlanPayloadSchema = createGenericArtifactPayloadSchema(
  ArtifactSchemaVersionByType["revision-plan"]
);

export const ArtifactPayloadSchema = z.union([
  DesignBriefPayloadSchema,
  DesignApproachSchema,
  ScreenModelPayloadSchema,
  FlowModelPayloadSchema,
  UXEnvelopeSchema,
  StateMatrixSchema,
  DesignSystemFitReportPayloadSchema,
  DesignSystemReusePlanPayloadSchema,
  DesignSystemUsageReportPayloadSchema,
  FigmaTargetPayloadSchema,
  UICompositionContractSchema,
  LayoutContractSchema,
  VariableBindingPlanSchema,
  DraftComponentPlanSchema,
  DraftComponentLifecycleSchema,
  DraftPlanPayloadSchema,
  FigmaApplyPacketPayloadSchema,
  FigmaApplyReportPayloadSchema,
  CanvasPlanSchema,
  FigmaTransactionPlanSchema,
  FigmaNodeLedgerSchema,
  CanvasReconciliationReportSchema,
  UIQualityGateReportSchema,
  CommentEvidenceMapSchema,
  RevisionPlanPayloadSchema,
]);

const ArtifactEnvelopeSchema = z.strictObject({
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
  createArtifactVariantSchema("design-approach", DesignApproachSchema),
  createArtifactVariantSchema("screen-model", ScreenModelPayloadSchema),
  createArtifactVariantSchema("flow-model", FlowModelPayloadSchema),
  createArtifactVariantSchema("ux-envelope", UXEnvelopeSchema),
  createArtifactVariantSchema("state-matrix", StateMatrixSchema),
  createArtifactVariantSchema("design-system-fit-report", DesignSystemFitReportPayloadSchema),
  createArtifactVariantSchema("design-system-reuse-plan", DesignSystemReusePlanPayloadSchema),
  createArtifactVariantSchema("design-system-usage-report", DesignSystemUsageReportPayloadSchema),
  createArtifactVariantSchema("figma-target", FigmaTargetPayloadSchema),
  createArtifactVariantSchema("ui-composition-contract", UICompositionContractSchema),
  createArtifactVariantSchema("layout-contract", LayoutContractSchema),
  createArtifactVariantSchema("variable-binding-plan", VariableBindingPlanSchema),
  createArtifactVariantSchema("draft-component-plan", DraftComponentPlanSchema),
  createArtifactVariantSchema("draft-component-lifecycle", DraftComponentLifecycleSchema),
  createArtifactVariantSchema("draft-plan", DraftPlanPayloadSchema),
  createArtifactVariantSchema("figma-apply-packet", FigmaApplyPacketPayloadSchema),
  createArtifactVariantSchema("figma-apply-report", FigmaApplyReportPayloadSchema),
  createArtifactVariantSchema("canvas-plan", CanvasPlanSchema),
  createArtifactVariantSchema("figma-transaction-plan", FigmaTransactionPlanSchema),
  createArtifactVariantSchema("figma-node-ledger", FigmaNodeLedgerSchema),
  createArtifactVariantSchema("canvas-reconciliation-report", CanvasReconciliationReportSchema),
  createArtifactVariantSchema("ui-quality-gate-report", UIQualityGateReportSchema),
  createArtifactVariantSchema("comment-evidence-map", CommentEvidenceMapSchema),
  createArtifactVariantSchema("revision-plan", RevisionPlanPayloadSchema),
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
export type DesignApproach = z.infer<typeof DesignApproachSchema>;
export type UXEnvelope = z.infer<typeof UXEnvelopeSchema>;
export type StateMatrix = z.infer<typeof StateMatrixSchema>;
export type UICompositionContract = z.infer<typeof UICompositionContractSchema>;
export type LayoutContract = z.infer<typeof LayoutContractSchema>;
export type VariableBindingPlan = z.infer<typeof VariableBindingPlanSchema>;
export type DraftComponentPlan = z.infer<typeof DraftComponentPlanSchema>;
export type DraftComponentLifecycle = z.infer<typeof DraftComponentLifecycleSchema>;
export type Bounds = z.infer<typeof BoundsSchema>;
export type CanvasPlan = z.infer<typeof CanvasPlanSchema>;
export type FigmaTransactionPlan = z.infer<typeof FigmaTransactionPlanSchema>;
export type FigmaNodeLedger = z.infer<typeof FigmaNodeLedgerSchema>;
export type CanvasReconciliationReport = z.infer<typeof CanvasReconciliationReportSchema>;
export type CommentEvidenceMap = z.infer<typeof CommentEvidenceMapSchema>;
export type UIQualityGateReport = z.infer<typeof UIQualityGateReportSchema>;
