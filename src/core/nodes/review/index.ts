import { type JSONType, z } from "zod";
import {
  type DesignAuditFindingCategory,
  type DesignAuditFindingInput,
  openDesignReviewDb,
} from "../../../db/design-review-db.js";
import { nowIso, slugify } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { ensureDraftTarget } from "../../adapters/figma/target.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: ReturnType<typeof createUserInterrupt>;
  artifacts?: Artifact[];
};

type ReviewSeverity = "critical" | "high" | "medium" | "polish";

type ReviewFinding = {
  theme: string;
  severity: ReviewSeverity;
  confidence?: "observed" | "inferred" | "needs-decision";
  title: string;
  observation?: string;
  rationale?: string;
  recommendation: string;
  nodeId?: string;
  partName?: string;
  componentKey?: string;
  draftComponentId?: string;
  variableBindings?: Record<string, unknown>[];
  suggestedComment?: string;
};

type ReviewRevision = {
  nodeId: string;
  partName: string;
  operation: "preserve-instance-update" | "create-draft-component-and-update";
  theme?: string;
  recommendation?: string;
  componentKey?: string;
  draftComponentId?: string;
  variableBindings?: Record<string, unknown>[];
  layoutFrame?: Record<string, unknown>;
};

type ReviewRevisionPlan = {
  schemaVersion: "RevisionPlan/v1";
  target: Record<string, unknown>;
  revisions: ReviewRevision[];
  approvalRequired: true;
  sessionId?: string;
};

const EmptyParamsSchema = z.strictObject({});
const CollectParamsSchema = z.strictObject({
  source: z.enum(["figma", "comments"]).optional(),
  maxRegions: z.number().int().positive().optional(),
});
const ApprovalParamsSchema = z.strictObject({
  requiresRevisionApproval: z.boolean().optional(),
  requiresCommentApproval: z.boolean().optional(),
  requiresMemoryApproval: z.boolean().optional(),
});
const DEFAULT_MAX_REGIONS = 8;

export const reviewNodeDefinitions: NodeDefinition[] = [
  node({
    key: "review.collectEvidence",
    paramsSchema: CollectParamsSchema,
    stateReads: ["figmaTarget", "review"],
    stateWrites: ["review", "screen"],
    requiredCapabilities: ["figma.read.remote"],
    run: async (input) => {
      const params = CollectParamsSchema.parse(input.params);
      const state = graphState(input.state);
      const review = recordFrom(state.review);
      return params.source === "comments"
        ? collectCommentEvidence(state, review, params.maxRegions ?? DEFAULT_MAX_REGIONS)
        : collectFigmaEvidence(state, review, params.maxRegions ?? DEFAULT_MAX_REGIONS);
    },
  }),
  node({
    key: "review.compareToDesignSystem",
    stateReads: ["review", "designSystem"],
    stateWrites: ["review", "screen", "fitReport"],
    requiredCapabilities: ["designSystem.search.local"],
    run: async (input) => compareToDesignSystem(graphState(input.state)),
  }),
  node({
    key: "review.groupFindings",
    stateReads: ["review"],
    stateWrites: ["review"],
    run: async (input) => {
      const state = graphState(input.state);
      const review = recordFrom(state.review);
      const groupedFindings = groupFindings(findingArray(review.findings));
      return {
        statePatch: { review: { ...review, groupedFindings } },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "review.createRevisionPlan",
    stateReads: ["review", "fitReport", "applyReport"],
    stateWrites: ["review"],
    sideEffects: "filesystem",
    requiredCapabilities: ["review.write"],
    run: async (input) => createRevisionPlan(graphState(input.state)),
  }),
  node({
    key: "review.askApproval",
    kind: "interrupt",
    paramsSchema: ApprovalParamsSchema,
    stateReads: ["review", "answers"],
    stateWrites: ["review", "pendingQuestion"],
    requiredCapabilities: ["review.write"],
    run: async (input) =>
      askApproval(graphState(input.state), ApprovalParamsSchema.parse(input.params)),
  }),
  node({
    key: "review.prepareApprovedComments",
    stateReads: ["review"],
    stateWrites: ["review"],
    sideEffects: "sqlite",
    requiredCapabilities: ["review.write"],
    run: async (input) => prepareApprovedComments(graphState(input.state)),
  }),
  node({
    key: "review.applyApprovedRevisions",
    stateReads: ["figmaTarget", "review", "answers"],
    stateWrites: ["applyReport"],
    sideEffects: "figma-write",
    requiredCapabilities: ["figma.write.remote"],
    run: async (input) => applyApprovedRevisions(graphState(input.state)),
  }),
  node({
    key: "review.saveSession",
    stateReads: ["review"],
    stateWrites: ["review", "artifacts"],
    sideEffects: "sqlite",
    requiredCapabilities: ["review.write"],
    run: async (input) => saveSession(graphState(input.state)),
  }),
];

function collectFigmaEvidence(
  state: KotikitGraphState,
  review: Record<string, unknown>,
  maxRegions: number
): RuntimeNodeOutput {
  const existingTarget = recordFrom(review.target);
  const existingEvidence = recordFrom(review.evidence);
  if (Object.keys(existingTarget).length > 0 && Object.keys(existingEvidence).length > 0) {
    return {
      statePatch: {
        screen: screenFromEvidence(existingEvidence, existingTarget),
        review: {
          ...review,
          source: "figma",
          target: existingTarget,
          evidence: existingEvidence,
        },
      },
    };
  }

  const draftTarget =
    state.figmaTarget === undefined ? undefined : ensureDraftTarget(state.figmaTarget);
  const sourceSnapshot = recordFrom(review.sourceSnapshot);
  const snapshotTarget = recordFrom(sourceSnapshot.target);
  if (Object.keys(snapshotTarget).length === 0 && !Array.isArray(sourceSnapshot.regions)) {
    throw new KotikitError(
      "This review flow needs pre-collected review evidence.",
      "Start from kotikit_review_figma_target or seed kotikit_start with review.target and review.evidence."
    );
  }
  const nodeId =
    stringField(snapshotTarget, "nodeId") ??
    stringField(existingTarget, "nodeId") ??
    (draftTarget === undefined ? undefined : nodeIdFromUrl(draftTarget.pageUrl));
  if (nodeId === undefined) {
    throw new KotikitError(
      "This review flow needs an exact Figma target node.",
      "Seed review.target.nodeId or bind a draft target before collecting review evidence."
    );
  }
  const fileKey =
    stringField(snapshotTarget, "fileKey") ??
    stringField(existingTarget, "fileKey") ??
    draftTarget?.fileKey;
  if (fileKey === undefined) {
    throw new KotikitError(
      "This review flow needs a Figma file key.",
      "Seed review.target.fileKey or bind a draft target before collecting review evidence."
    );
  }
  const targetName =
    stringField(snapshotTarget, "name") ??
    stringField(snapshotTarget, "targetName") ??
    stringField(existingTarget, "targetName") ??
    draftTarget?.pageName ??
    nodeId;
  const targetType = stringField(snapshotTarget, "type") ?? "CANVAS";
  const regions = recordArray(sourceSnapshot.regions)
    .map(regionSummary)
    .filter((region): region is Record<string, unknown> => region !== null)
    .slice(0, maxRegions);
  const childCount = numberField(snapshotTarget, "childCount") ?? regions.length;
  const reviewTarget = {
    source: "figma",
    fileKey,
    nodeId,
    targetKind: targetKindFor(targetType),
    targetName,
    figmaUrl:
      stringField(snapshotTarget, "figmaUrl") ??
      stringField(existingTarget, "figmaUrl") ??
      figmaUrlFor(draftTarget?.pageUrl ?? `https://www.figma.com/design/${fileKey}/review`, nodeId),
  };
  const evidence = {
    collectedAt: nowIso(),
    tokenBudget: {
      maxRegions,
      returnedRegions: regions.length,
      truncatedRegions: Math.max(0, childCount - regions.length),
    },
    targetSummary: {
      nodeId,
      name: targetName,
      type: targetType,
      kind: targetKindFor(targetType),
      childCount,
    },
    regions,
    notes: ["Evidence is bounded to the review target summary plus shallow child regions."],
  };

  return {
    statePatch: {
      screen: screenFromEvidence(evidence, reviewTarget),
      review: {
        ...review,
        source: "figma",
        target: reviewTarget,
        evidence,
      },
    },
  };
}

function collectCommentEvidence(
  state: KotikitGraphState,
  review: Record<string, unknown>,
  maxRegions: number
): RuntimeNodeOutput {
  const draftTarget = ensureDraftTarget(state.figmaTarget);
  const commentSource = recordFrom(review.commentSnapshot).comments ?? review.comments;
  if (!Array.isArray(commentSource)) {
    throw new KotikitError(
      "This review-comments flow needs a comment snapshot.",
      "Start the review-comments flow with review.commentSnapshot.comments from the graph input."
    );
  }
  const comments = recordArray(commentSource);
  const regions = comments
    .flatMap((comment) => {
      const nodeId = stringField(comment, "nodeId");
      if (nodeId === undefined) return [];
      return [{ nodeId, name: stringField(comment, "targetName") ?? nodeId, type: "COMMENT" }];
    })
    .slice(0, maxRegions);
  const targetNodeId = nodeIdFromUrl(draftTarget.pageUrl);
  const target = {
    source: "figma",
    fileKey: draftTarget.fileKey,
    nodeId: targetNodeId,
    targetKind: "page",
    targetName: draftTarget.pageName,
    figmaUrl: figmaUrlFor(draftTarget.pageUrl, targetNodeId),
  };
  const findings = comments.map(commentFinding);
  return {
    statePatch: {
      screen: {
        schemaVersion: "ScreenModel/v1",
        title: draftTarget.pageName,
        requiredUiParts: uniqueStrings(
          regions.map((region) => String(region.name ?? region.nodeId))
        ),
        states: stringArray(recordFrom(state.screen).states),
      },
      review: {
        ...review,
        source: "comments",
        target,
        evidence: {
          collectedAt: nowIso(),
          tokenBudget: {
            maxRegions,
            returnedRegions: regions.length,
            truncatedRegions: Math.max(0, comments.length - regions.length),
          },
          targetSummary: {
            nodeId: targetNodeId,
            name: draftTarget.pageName,
            type: "CANVAS",
            kind: "page",
            childCount: regions.length,
          },
          regions,
          notes: ["Evidence came from mapped Figma comments."],
        },
        findings,
      },
    },
  };
}

function compareToDesignSystem(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const evidence = recordFrom(review.evidence);
  const target = recordFrom(review.target);
  const targetSummary = recordFrom(evidence.targetSummary);
  const regions = recordArray(evidence.regions);
  const components = recordArray(recordFrom(state.designSystem).components);
  const parts = uniqueStrings(
    regions
      .map((region) => stringField(region, "name"))
      .filter((name): name is string => name !== undefined)
  );
  const matches = parts.flatMap((part) => {
    const component = components.find(
      (candidate) => normalize(stringField(candidate, "name")) === normalize(part)
    );
    if (component === undefined) return [];
    const key = stringField(component, "key") ?? stringField(component, "componentKey");
    if (key === undefined) return [];
    return [
      {
        requestedPart: part,
        componentName: stringField(component, "name") ?? part,
        componentKey: key,
      },
    ];
  });
  const missingComponents = parts
    .filter((part) => !matches.some((match) => normalize(match.requestedPart) === normalize(part)))
    .map((part) => ({ requestedPart: part }));
  const missingFindings: ReviewFinding[] = missingComponents.map((missing) => {
    const region = regions.find(
      (candidate) => normalize(stringField(candidate, "name")) === normalize(missing.requestedPart)
    );
    return {
      theme: "component",
      severity: "high",
      confidence: "observed",
      title: `Create or map ${missing.requestedPart}`,
      observation: `${missing.requestedPart} is present in the Figma target but not grounded in the local design-system index.`,
      rationale: "Kotikit should preserve or create components before composing polished UI.",
      recommendation: `Create or map a design-system component for ${missing.requestedPart}.`,
      nodeId: stringField(region ?? {}, "nodeId"),
      partName: missing.requestedPart,
    };
  });
  const screen = {
    schemaVersion: "ScreenModel/v1",
    title:
      stringField(targetSummary, "name") ?? stringField(target, "targetName") ?? "Review Target",
    requiredUiParts: parts,
    states: stringArray(recordFrom(state.screen).states),
  };
  const fitReport = {
    schemaVersion: "DesignSystemFitReport/v1",
    exactMatches: matches,
    substitutes: [],
    missingComponents,
  };

  return {
    statePatch: {
      screen,
      fitReport,
      review: {
        ...review,
        target,
        findings: [...findingArray(review.findings), ...missingFindings],
      },
    },
  };
}

function createRevisionPlan(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const revisions = findingArray(review.findings).map((finding) =>
    revisionFromFinding(finding, state)
  );
  const revisionPlan: ReviewRevisionPlan = {
    schemaVersion: "RevisionPlan/v1",
    target: recordFrom(review.target),
    revisions,
    approvalRequired: true,
    ...(stringField(review, "sessionId") !== undefined
      ? { sessionId: stringField(review, "sessionId") }
      : {}),
  };
  const now = nowIso();
  const artifact: Artifact = {
    id: `${state.runId}-revision-plan`,
    runId: state.runId,
    type: "revision-plan",
    schemaVersion: ArtifactSchemaVersionByType["revision-plan"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "review.createRevisionPlan", version: "1.0.0" },
    payload: {
      schemaVersion: ArtifactSchemaVersionByType["revision-plan"],
      summary: `${revisions.length} approved-revision candidate(s) for ${String(
        revisionPlan.target.targetName ?? revisionPlan.target.nodeId ?? "review target"
      )}.`,
      data: toJson({
        target: revisionPlan.target,
        revisions,
        approvalRequired: true,
        ...(revisionPlan.sessionId !== undefined ? { sessionId: revisionPlan.sessionId } : {}),
      }) as Record<string, JSONType>,
    },
  };

  return {
    statePatch: {
      review: {
        ...review,
        revisionPlan,
        revisionPlanArtifactId: artifact.id,
      },
    },
    artifacts: [artifact],
  };
}

function askApproval(
  state: KotikitGraphState,
  params: z.infer<typeof ApprovalParamsSchema>
): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const approvals = {
    ...recordFrom(review.approvals),
    ...(state.answers?.["approve-review-revisions"] !== undefined
      ? { revisions: state.answers["approve-review-revisions"] }
      : {}),
    ...(state.answers?.["approve-comment-posting"] !== undefined
      ? { comments: state.answers["approve-comment-posting"] }
      : {}),
    ...(state.answers?.["approve-memory-promotion"] !== undefined
      ? { memory: state.answers["approve-memory-promotion"] }
      : {}),
  };

  if (params.requiresRevisionApproval !== false && approvals.revisions === undefined) {
    const pendingQuestion = {
      id: "approve-review-revisions",
      prompt: "Apply the proposed design revisions to the bound Figma draft target?",
      choices: ["apply-approved-revisions"],
    };
    return {
      statePatch: { review: { ...review, approvals } },
      interrupt: createUserInterrupt(pendingQuestion),
    };
  }
  if (params.requiresCommentApproval === true && approvals.comments === undefined) {
    const pendingQuestion = {
      id: "approve-comment-posting",
      prompt: "Post approved review comments back to Figma?",
      choices: ["post-approved-comments", "skip-comment-posting"],
    };
    return {
      statePatch: { review: { ...review, approvals } },
      interrupt: createUserInterrupt(pendingQuestion),
    };
  }
  if (params.requiresMemoryApproval === true && approvals.memory === undefined) {
    const pendingQuestion = {
      id: "approve-memory-promotion",
      prompt: "Promote the detected design preference into kotikit memory?",
      choices: ["promote-memory", "skip-memory"],
    };
    return {
      statePatch: { review: { ...review, approvals } },
      interrupt: createUserInterrupt(pendingQuestion),
    };
  }

  return {
    statePatch: { review: { ...review, approvals } },
  };
}

function applyApprovedRevisions(state: KotikitGraphState): RuntimeNodeOutput {
  if (state.answers?.["approve-review-revisions"] !== "apply-approved-revisions") {
    throw new KotikitError(
      "The review revisions have not been approved.",
      "Approve the revision plan before applying it to the Figma draft target."
    );
  }
  if (state.figmaTarget === undefined) {
    return {
      interrupt: createUserInterrupt({
        id: "bind-review-draft-target",
        prompt: "Bind a safe Figma draft target before applying approved revisions.",
        choices: ["target-bound"],
      }),
    };
  }
  const draftTarget = ensureDraftTarget(state.figmaTarget);
  const revisionPlan = recordFrom(recordFrom(state.review).revisionPlan);
  const revisions = recordArray(revisionPlan.revisions);
  const now = nowIso();
  return {
    statePatch: {
      applyReport: {
        schemaVersion: "FigmaApplyReport/v1",
        status: "recorded",
        fileKey: draftTarget.fileKey,
        pageId: draftTarget.pageId,
        sectionName: draftTarget.section?.name,
        nodes: revisions.map((revision) => ({
          id: stringField(revision, "nodeId") ?? slugify(String(revision.partName ?? "revision")),
          partId: slugify(String(revision.partName ?? revision.nodeId ?? "revision")),
          operation: stringField(revision, "operation") ?? "preserve-instance-update",
          ...(stringField(revision, "componentKey") !== undefined
            ? { componentKey: stringField(revision, "componentKey") }
            : {}),
          ...(stringField(revision, "draftComponentId") !== undefined
            ? { draftComponentId: stringField(revision, "draftComponentId") }
            : {}),
        })),
        variableBindings: revisions.flatMap((revision) => recordArray(revision.variableBindings)),
        layoutFrames: revisions.flatMap((revision) => {
          const layoutFrame = recordFrom(revision.layoutFrame);
          return Object.keys(layoutFrame).length > 0 ? [layoutFrame] : [];
        }),
        repeatedItems: [],
        textTransforms: [],
        recordedAt: now,
      },
    },
  };
}

function prepareApprovedComments(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const approvals = recordFrom(review.approvals);
  if (approvals.comments !== "post-approved-comments") {
    return {
      statePatch: {
        review: {
          ...review,
          preparedComments: [],
          commentPostingStatus: "skipped",
        },
      },
    };
  }
  const sessionId = stringField(review, "sessionId");
  if (sessionId === undefined) {
    throw new KotikitError(
      "The review session has not been saved yet.",
      "Save the review session before preparing Figma comments."
    );
  }
  const comments = openDesignReviewDb(state.project.root).prepareDesignAuditComments({ sessionId });
  return {
    statePatch: {
      review: {
        ...review,
        preparedComments: comments,
        commentPostingStatus: "prepared",
      },
    },
  };
}

function saveSession(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const target = recordFrom(review.target);
  const evidence = recordFrom(review.evidence);
  if (Object.keys(target).length === 0 || Object.keys(evidence).length === 0) {
    throw new KotikitError(
      "The review session is missing target evidence.",
      "Collect review evidence before saving the review session."
    );
  }

  const store = openDesignReviewDb(state.project.root);
  const session = store.recordDesignAuditSession({
    target: {
      source: "figma",
      fileKey: String(target.fileKey),
      nodeId: String(target.nodeId),
      targetKind: auditTargetKind(String(target.targetKind ?? "unknown")),
      targetName: String(target.targetName ?? "Review Target"),
      figmaUrl: String(target.figmaUrl),
      ...(typeof target.scope === "string" ? { scope: target.scope } : {}),
      ...(typeof target.screen === "string" ? { screen: target.screen } : {}),
    },
    brief: {
      strictness: "standard",
      reviewGoal: stringField(recordFrom(state.brief), "intent") ?? state.userIntent,
    },
    evidence,
  });
  const dbFindings = store.recordDesignAuditFindings({
    sessionId: session.sessionId,
    findings: findingArray(review.findings).map(auditFindingFrom),
  });

  const now = nowIso();
  const artifact: Artifact = {
    id: `${state.runId}-review-session`,
    runId: state.runId,
    type: "review-session",
    schemaVersion: ArtifactSchemaVersionByType["review-session"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "review.saveSession", version: "1.0.0" },
    payload: {
      schemaVersion: ArtifactSchemaVersionByType["review-session"],
      summary: `Saved review session ${session.sessionId}.`,
      data: toJson({
        sessionId: session.sessionId,
        fileKey: target.fileKey,
        nodeId: target.nodeId,
        ...(typeof target.scope === "string" ? { scope: target.scope } : {}),
        ...(typeof target.screen === "string" ? { screen: target.screen } : {}),
      }) as Record<string, JSONType>,
    },
  };

  return {
    statePatch: {
      review: {
        ...review,
        sessionId: session.sessionId,
        dbFindings,
      },
    },
    artifacts: [artifact],
  };
}

function revisionFromFinding(finding: ReviewFinding, state: KotikitGraphState): ReviewRevision {
  const partName = finding.partName ?? finding.title;
  const nodeId = finding.nodeId ?? slugify(partName);
  const componentKey =
    finding.componentKey ?? componentKeyForPart(partName, recordFrom(state.fitReport));
  const draftComponentId = finding.draftComponentId;
  const variableBindings =
    finding.variableBindings ??
    recordArray(recordFrom(state.applyReport).variableBindings).filter(
      (binding) => stringField(binding, "targetId") === nodeId
    );
  return {
    nodeId,
    partName,
    operation:
      componentKey !== undefined || draftComponentId !== undefined
        ? "preserve-instance-update"
        : "create-draft-component-and-update",
    theme: finding.theme,
    recommendation: finding.recommendation,
    ...(componentKey !== undefined ? { componentKey } : {}),
    ...(draftComponentId !== undefined ? { draftComponentId } : {}),
    variableBindings,
    ...(recordFrom(finding).layoutFrame !== undefined
      ? { layoutFrame: recordFrom(recordFrom(finding).layoutFrame) }
      : {}),
  };
}

function groupFindings(findings: ReviewFinding[]): Record<string, unknown>[] {
  const groups = new Map<string, { theme: string; severity: string; count: number }>();
  findings.forEach((finding) => {
    const key = `${finding.theme}:${finding.severity}`;
    const existing = groups.get(key);
    groups.set(
      key,
      existing === undefined
        ? { theme: finding.theme, severity: finding.severity, count: 1 }
        : { ...existing, count: existing.count + 1 }
    );
  });
  return Array.from(groups.values());
}

function componentKeyForPart(
  partName: string,
  fitReport: Record<string, unknown>
): string | undefined {
  return [...recordArray(fitReport.exactMatches), ...recordArray(fitReport.substitutes)].find(
    (match) => normalize(stringField(match, "requestedPart")) === normalize(partName)
  )?.componentKey as string | undefined;
}

function screenFromEvidence(
  evidence: Record<string, unknown>,
  target: Record<string, unknown>
): Record<string, unknown> {
  const targetSummary = recordFrom(evidence.targetSummary);
  const regions = recordArray(evidence.regions);
  return {
    schemaVersion: "ScreenModel/v1",
    title:
      stringField(targetSummary, "name") ?? stringField(target, "targetName") ?? "Review Target",
    requiredUiParts: uniqueStrings(
      regions
        .map((region) => stringField(region, "name"))
        .filter((name): name is string => name !== undefined && name.length > 0)
    ),
    states: [],
  };
}

function commentFinding(comment: Record<string, unknown>): ReviewFinding {
  const message = stringField(comment, "message") ?? "Review comment needs a decision.";
  const nodeId = stringField(comment, "nodeId");
  const partName = stringField(comment, "targetName") ?? nodeId ?? "Comment target";
  return {
    theme: classifyTheme(message),
    severity: "medium",
    confidence: "observed",
    title: `Resolve comment for ${partName}`,
    observation: message,
    rationale: "Figma comments should become explicit design decisions or revisions.",
    recommendation: message,
    ...(nodeId !== undefined ? { nodeId } : {}),
    partName,
    suggestedComment: "Addressed in the kotikit revision plan.",
  };
}

function auditFindingFrom(finding: ReviewFinding): DesignAuditFindingInput {
  return {
    category: auditCategory(finding.theme),
    severity: finding.severity,
    confidence: finding.confidence ?? "inferred",
    title: finding.title,
    observation: finding.observation ?? finding.title,
    rationale: finding.rationale ?? "This finding was derived from kotikit review evidence.",
    recommendation: finding.recommendation,
    ...(finding.nodeId !== undefined ? { nodeId: finding.nodeId } : {}),
    commentable: finding.suggestedComment !== undefined,
    ...(finding.suggestedComment !== undefined
      ? { suggestedComment: finding.suggestedComment }
      : {}),
  };
}

function auditCategory(value: string): DesignAuditFindingCategory {
  const allowed = new Set([
    "spacing",
    "density",
    "typography",
    "hierarchy",
    "color",
    "component",
    "interaction",
    "copy",
    "responsive",
    "layout",
    "other",
    "accessibility",
    "content",
    "system",
    "visual",
  ]);
  return allowed.has(value) ? (value as DesignAuditFindingCategory) : "other";
}

function auditTargetKind(value: string): "page" | "section" | "frame" | "component" | "unknown" {
  if (["page", "section", "frame", "component"].includes(value)) {
    return value as "page" | "section" | "frame" | "component";
  }
  return "unknown";
}

function classifyTheme(message: string): string {
  const normalized = normalize(message);
  if (normalized.includes("space") || normalized.includes("padding")) return "spacing";
  if (normalized.includes("type") || normalized.includes("text")) return "typography";
  if (normalized.includes("color")) return "color";
  if (normalized.includes("layout")) return "layout";
  if (normalized.includes("button") || normalized.includes("component")) return "component";
  return "other";
}

function node(
  input: Partial<NodeDefinition> & Pick<NodeDefinition, "key" | "run">
): NodeDefinition {
  return {
    key: input.key,
    version: "1.0.0",
    kind: input.kind ?? "deterministic",
    paramsSchema: input.paramsSchema ?? EmptyParamsSchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: input.stateReads ?? [],
    stateWrites: input.stateWrites ?? [],
    sideEffects: input.sideEffects ?? "none",
    requiredCapabilities: input.requiredCapabilities ?? [],
    run: input.run,
  };
}

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function findingArray(value: unknown): ReviewFinding[] {
  return recordArray(value).map((finding) => {
    const variableBindings = recordArray(finding.variableBindings);
    return {
      theme: stringField(finding, "theme") ?? "other",
      severity: severityFrom(stringField(finding, "severity")),
      confidence: confidenceFrom(stringField(finding, "confidence")),
      title: stringField(finding, "title") ?? "Review finding",
      observation: stringField(finding, "observation"),
      rationale: stringField(finding, "rationale"),
      recommendation: stringField(finding, "recommendation") ?? "Revise this UI part.",
      nodeId: stringField(finding, "nodeId"),
      partName: stringField(finding, "partName"),
      componentKey: stringField(finding, "componentKey"),
      draftComponentId: stringField(finding, "draftComponentId"),
      ...(variableBindings.length > 0 ? { variableBindings } : {}),
      suggestedComment: stringField(finding, "suggestedComment"),
    };
  });
}

function severityFrom(value: string | undefined): ReviewSeverity {
  if (value === "critical" || value === "high" || value === "medium" || value === "polish") {
    return value;
  }
  return "medium";
}

function confidenceFrom(value: string | undefined): ReviewFinding["confidence"] {
  if (value === "observed" || value === "inferred" || value === "needs-decision") return value;
  return undefined;
}

function targetKindFor(type: string): "page" | "section" | "frame" | "component" | "unknown" {
  if (type === "CANVAS") return "page";
  if (type === "SECTION") return "section";
  if (type === "FRAME") return "frame";
  if (type === "COMPONENT" || type === "COMPONENT_SET") return "component";
  return "unknown";
}

function regionSummary(region: Record<string, unknown>): Record<string, unknown> | null {
  const nodeId = stringField(region, "nodeId");
  if (nodeId === undefined) return null;
  return {
    nodeId,
    name: stringField(region, "name") ?? "",
    type: stringField(region, "type") ?? "UNKNOWN",
  };
}

function figmaUrlFor(pageUrl: string, nodeId: string): string {
  const url = new URL(pageUrl);
  const encodedNodeId = nodeId.replace(":", "-");
  return `${url.origin}${url.pathname}?node-id=${encodedNodeId}`;
}

function nodeIdFromUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  return decodeURIComponent(url.searchParams.get("node-id") ?? "0:0").replace("-", ":");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function toJson(value: unknown): JSONType {
  return JSON.parse(JSON.stringify(value));
}
