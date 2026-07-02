import { type JSONType, z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { ensureDraftTarget } from "../../adapters/figma/target.js";
import { verifyFigmaEvidenceAgainstApplyPacket } from "../../domain/figma-evidence.js";
import {
  markTransactionActive,
  nextPendingTransaction,
  recordTransactionMetadata,
  transactionPlanComplete,
} from "../../domain/figma-transaction-plan.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import {
  ActiveFigmaTransactionSchema,
  type Artifact,
  ArtifactSchemaVersionByType,
  BoundsSchema,
  type FigmaNodeLedger,
  FigmaNodeLedgerSchema,
  type FigmaTransactionPlan,
  FigmaTransactionPlanSchema,
} from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: { status: "waiting-for-figma"; resume?: "same-node" | "next-node" };
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});

export const figmaNodeDefinitions: NodeDefinition[] = [
  node({
    key: "figma.ensureDraftTarget",
    stateReads: ["figmaTarget"],
    stateWrites: ["figmaTarget"],
    requiredCapabilities: ["figma.target"],
    run: async (input) => {
      const target = ensureDraftTarget(graphState(input.state).figmaTarget);
      return { statePatch: { figmaTarget: target } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "figma.waitForApplyMetadata",
    kind: "external-action",
    stateReads: ["draftPlan"],
    stateWrites: [],
    sideEffects: "figma-write",
    requiredCapabilities: ["figma.write.remote"],
    run: async () => ({ interrupt: { status: "waiting-for-figma" } }) satisfies RuntimeNodeOutput,
  }),
  node({
    key: "figma.applyTransactionQueue",
    kind: "external-action",
    stateReads: [
      "figmaTarget",
      "figmaTransactionPlan",
      "activeFigmaTransaction",
      "applyMetadata",
      "figmaEvidenceSnapshots",
      "figmaNodeLedger",
      "draftPlan",
    ],
    stateWrites: [
      "figmaTransactionPlan",
      "activeFigmaTransaction",
      "figmaEvidenceSnapshots",
      "figmaNodeLedger",
      "applyReport",
      "applyMetadata",
    ],
    sideEffects: "figma-write",
    requiredCapabilities: ["figma.write.remote"],
    run: async (input) => {
      const state = graphState(input.state);
      const target = ensureDraftTarget(state.figmaTarget);
      const plan = FigmaTransactionPlanSchema.parse(state.figmaTransactionPlan);
      const persistedActive =
        state.activeFigmaTransaction === undefined
          ? undefined
          : ActiveFigmaTransactionSchema.parse(state.activeFigmaTransaction);
      const queued = nextPendingTransaction(plan);
      const active =
        persistedActive ??
        (queued?.status === "active" ? activeTransactionFrom(queued) : undefined);

      if (
        persistedActive === undefined &&
        queued?.status === "active" &&
        state.applyMetadata === undefined
      ) {
        return {
          statePatch: { activeFigmaTransaction: activeTransactionFrom(queued) },
          interrupt: { status: "waiting-for-figma", resume: "same-node" },
        } satisfies RuntimeNodeOutput;
      }

      if (active === undefined) {
        if (queued === undefined || queued.status !== "pending") {
          const ledger = ledgerFrom(state.figmaNodeLedger, target);
          return {
            statePatch: { applyReport: applyReportFromLedger(ledger) },
          } satisfies RuntimeNodeOutput;
        }

        const activePlan = markTransactionActive(plan, queued.id);
        return {
          statePatch: {
            figmaTransactionPlan: activePlan,
            activeFigmaTransaction: activeTransactionFrom(queued),
          },
          interrupt: { status: "waiting-for-figma", resume: "same-node" },
        } satisfies RuntimeNodeOutput;
      }

      const metadata = requireTransactionMetadata(active.id, state.applyMetadata);
      validateApplyMetadata(target, metadata);
      const evidenceSnapshots = appendEvidenceSnapshot(
        recordArray(state.figmaEvidenceSnapshots),
        metadata.evidenceSnapshot
      );
      verifyTransactionEvidenceBeforeRecord({
        active,
        packet: recordFrom(recordFrom(state.draftPlan).applyPacket),
        evidenceSnapshots,
      });
      const ledger = appendLedgerNode(ledgerFrom(state.figmaNodeLedger, target), {
        active,
        metadata,
        target,
      });
      const recordedPlan = recordTransactionMetadata(plan, { transactionId: active.id });

      if (transactionPlanComplete(recordedPlan)) {
        return {
          statePatch: {
            figmaTransactionPlan: recordedPlan,
            figmaNodeLedger: ledger,
            figmaEvidenceSnapshots: evidenceSnapshots,
            activeFigmaTransaction: undefined,
            applyMetadata: undefined,
            applyReport: applyReportFromLedger(ledger, evidenceSnapshots),
          },
        } satisfies RuntimeNodeOutput;
      }

      const next = nextPendingTransaction(recordedPlan);
      if (next === undefined || next.status !== "pending") {
        return {
          statePatch: {
            figmaTransactionPlan: recordedPlan,
            figmaNodeLedger: ledger,
            figmaEvidenceSnapshots: evidenceSnapshots,
            activeFigmaTransaction: undefined,
            applyMetadata: undefined,
            applyReport: applyReportFromLedger(ledger, evidenceSnapshots),
          },
        } satisfies RuntimeNodeOutput;
      }
      const activePlan = markTransactionActive(recordedPlan, next.id);
      return {
        statePatch: {
          figmaTransactionPlan: activePlan,
          figmaNodeLedger: ledger,
          figmaEvidenceSnapshots: evidenceSnapshots,
          activeFigmaTransaction: activeTransactionFrom(next),
          applyMetadata: undefined,
        },
        interrupt: { status: "waiting-for-figma", resume: "same-node" },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "figma.recordApplyMetadata",
    stateReads: ["figmaTarget"],
    stateWrites: ["applyReport"],
    run: async (input) => {
      const state = graphState(input.state);
      const target = ensureDraftTarget(state.figmaTarget);
      const metadata = recordFrom(recordFrom(state).applyMetadata);
      validateApplyMetadata(target, metadata);
      return {
        statePatch: {
          applyMetadata: undefined,
          applyReport: {
            schemaVersion: "FigmaApplyReport/v1",
            status: "recorded",
            fileKey: metadata.fileKey,
            pageId: metadata.pageId,
            sectionName: metadata.sectionName,
            nodes: unknownArray(metadata.nodes),
            variableBindings: recordArray(metadata.variableBindings),
            layoutFrames: recordArray(metadata.layoutFrames),
            repeatedItems: recordArray(metadata.repeatedItems),
            textTransforms: recordArray(metadata.textTransforms),
            iconRefs: stringArray(metadata.iconRefs),
            evidenceSnapshots:
              metadata.evidenceSnapshot === undefined ? [] : [metadata.evidenceSnapshot],
            states: recordArray(metadata.states),
            draftComponentInstances: recordArray(metadata.draftComponentInstances),
            draftComponentPlacements: recordArray(metadata.draftComponentPlacements),
            recordedAt: nowIso(),
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "figma.verifyDraftInvariants",
    stateReads: ["figmaTarget", "draftPlan", "applyReport"],
    stateWrites: [],
    run: async (input) => {
      const state = graphState(input.state);
      const report = recordFrom(state.applyReport);
      validateApplyMetadata(ensureDraftTarget(state.figmaTarget), report);
      verifyAgainstApplyPacket(recordFrom(recordFrom(state.draftPlan).applyPacket), report);
      return {} satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "figma.saveApplyReport",
    stateReads: ["applyReport"],
    stateWrites: ["artifacts"],
    sideEffects: "filesystem",
    requiredCapabilities: ["figma.write.remote"],
    run: async (input) => {
      const state = graphState(input.state);
      const report = recordFrom(state.applyReport);
      const now = nowIso();
      const artifact: Artifact = {
        id: `${state.runId}-figma-apply-report`,
        runId: state.runId,
        type: "figma-apply-report",
        schemaVersion: ArtifactSchemaVersionByType["figma-apply-report"],
        createdAt: now,
        updatedAt: now,
        sourceNode: { key: "figma.saveApplyReport", version: "1.0.0" },
        payload: {
          schemaVersion: ArtifactSchemaVersionByType["figma-apply-report"],
          summary: String(report.status ?? "recorded"),
          data: {
            status: String(report.status ?? "recorded"),
            ...(typeof report.fileKey === "string" ? { fileKey: report.fileKey } : {}),
            ...(typeof report.pageId === "string" ? { pageId: report.pageId } : {}),
            ...(typeof report.sectionName === "string" ? { sectionName: report.sectionName } : {}),
            nodes: toJson(recordArray(report.nodes)),
            variableBindings: toJson(recordArray(report.variableBindings)),
            layoutFrames: toJson(recordArray(report.layoutFrames)),
            repeatedItems: toJson(recordArray(report.repeatedItems)),
            textTransforms: toJson(recordArray(report.textTransforms)),
            evidenceSnapshots: toJson(recordArray(report.evidenceSnapshots)),
            states: toJson(recordArray(report.states)),
            draftComponentInstances: toJson(recordArray(report.draftComponentInstances)),
            draftComponentPlacements: toJson(recordArray(report.draftComponentPlacements)),
          },
        },
      };
      return { artifacts: [artifact] } satisfies RuntimeNodeOutput;
    },
  }),
];

function requireTransactionMetadata(
  transactionId: string,
  value: unknown
): Record<string, unknown> {
  const metadata = recordFrom(value);
  if (Object.keys(metadata).length === 0) {
    throw new KotikitError(
      `Record Figma apply metadata for transaction ${transactionId} before continuing.`,
      "Use kotikit_record_figma_apply after the official Figma MCP write finishes, then continue the same run."
    );
  }
  if (metadata.transactionId !== transactionId) {
    throw new KotikitError(
      `The recorded Figma apply metadata does not match the active Figma transaction ${transactionId}.`,
      "Record metadata for the currently active transaction before continuing the graph."
    );
  }
  return metadata;
}

function ledgerFrom(value: unknown, target: ReturnType<typeof ensureDraftTarget>): FigmaNodeLedger {
  if (value !== undefined) return FigmaNodeLedgerSchema.parse(value);
  return FigmaNodeLedgerSchema.parse({
    schemaVersion: "FigmaNodeLedger/v1",
    fileKey: target.fileKey,
    pageId: target.pageId,
    sectionName: draftSectionName(target),
    nodes: [],
    updatedAt: nowIso(),
  });
}

function appendLedgerNode(
  ledger: FigmaNodeLedger,
  input: {
    active: NonNullable<KotikitGraphState["activeFigmaTransaction"]>;
    metadata: Record<string, unknown>;
    target: ReturnType<typeof ensureDraftTarget>;
  }
): FigmaNodeLedger {
  const nodeMetadata = recordArray(input.metadata.nodes)[0] ?? {};
  const nodeId = stringField(input.metadata, "figmaNodeId") ?? stringField(nodeMetadata, "id");
  if (nodeId === undefined) {
    throw new KotikitError(
      `Figma apply metadata for transaction ${input.active.id} is missing the Figma node id.`,
      "Record figmaNodeId for the top-level node created or updated by this transaction."
    );
  }

  const bounds = parseLedgerBounds(input.active.id, input.metadata.bounds);
  const componentRefs = requiredStringArray(
    input.active.id,
    input.metadata.componentRefs,
    "componentRefs"
  );
  const variableRefs = requiredStringArray(
    input.active.id,
    input.metadata.variableRefs,
    "variableRefs"
  );
  const autoLayout = booleanField(input.metadata, "autoLayout");
  if (autoLayout === undefined) {
    throw new KotikitError(
      `Figma apply metadata for transaction ${input.active.id} is missing auto layout metadata.`,
      "Record autoLayout as true or false after applying the transaction in Figma."
    );
  }
  if (requiresAutoLayout(input.active, input.metadata) && autoLayout !== true) {
    throw new KotikitError(
      `Figma apply metadata for transaction ${input.active.id} must confirm auto layout.`,
      "Use Figma auto layout for screen, region, draft component, and layout-frame transactions."
    );
  }
  const representation = stateRepresentationForTransaction(input.active, input.metadata);
  const recordedAt = nowIso();
  const evidenceSummary = recordFrom(recordFrom(input.metadata.evidenceSnapshot).summary);
  const directVisibleChildCount =
    numberField(input.metadata, "directVisibleChildCount") ??
    numberField(evidenceSummary, "directVisibleChildCount");
  const autoLayoutContainerCount =
    numberField(input.metadata, "autoLayoutContainerCount") ??
    numberField(evidenceSummary, "autoLayoutContainerCount");

  const node = {
    nodeId,
    name:
      stringField(input.metadata, "figmaNodeName") ??
      stringField(nodeMetadata, "name") ??
      input.active.label,
    kind:
      stringField(input.metadata, "figmaNodeKind") ?? stringField(nodeMetadata, "kind") ?? "FRAME",
    semanticRole: semanticRoleForTransaction(input.active, input.metadata),
    transactionId: input.active.id,
    placementId: input.active.placementId,
    ...(input.active.stateId === undefined ? {} : { stateId: input.active.stateId }),
    ...(representation === undefined ? {} : { representation }),
    ...(input.active.draftComponentId === undefined
      ? {}
      : { draftComponentId: input.active.draftComponentId }),
    ...(stringField(input.metadata, "partId") !== undefined
      ? { partId: stringField(input.metadata, "partId") }
      : {}),
    bounds,
    componentRefs,
    ...(componentSourceField(input.metadata) === undefined
      ? {}
      : { componentSource: componentSourceField(input.metadata) }),
    variableRefs,
    ...(optionalStringArray(input.active.id, input.metadata.iconRefs, "iconRefs").length === 0
      ? {}
      : { iconRefs: optionalStringArray(input.active.id, input.metadata.iconRefs, "iconRefs") }),
    ...(stringField(input.metadata, "iconKey") === undefined
      ? {}
      : { iconKey: stringField(input.metadata, "iconKey") }),
    ...(booleanField(input.metadata, "iconPlaceholder") === undefined
      ? {}
      : { iconPlaceholder: booleanField(input.metadata, "iconPlaceholder") }),
    autoLayout,
    ...(directVisibleChildCount === undefined ? {} : { directVisibleChildCount }),
    ...(autoLayoutContainerCount === undefined ? {} : { autoLayoutContainerCount }),
    ...(booleanField(input.metadata, "screenshotReviewed") === undefined
      ? {}
      : { screenshotReviewed: booleanField(input.metadata, "screenshotReviewed") }),
    ...(optionalStringArray(
      input.active.id,
      input.metadata.screenshotFindings,
      "screenshotFindings"
    ).length === 0
      ? {}
      : {
          screenshotFindings: optionalStringArray(
            input.active.id,
            input.metadata.screenshotFindings,
            "screenshotFindings"
          ),
        }),
    recordedAt,
  };
  const childNodes = childLedgerNodesFromMetadata(input, {
    parentNodeId: nodeId,
    recordedAt,
  });
  const updatedAt = nowIso();

  return FigmaNodeLedgerSchema.parse({
    schemaVersion: "FigmaNodeLedger/v1",
    fileKey: stringField(input.metadata, "fileKey") ?? ledger.fileKey ?? input.target.fileKey,
    pageId: stringField(input.metadata, "pageId") ?? ledger.pageId ?? input.target.pageId,
    sectionName:
      stringField(input.metadata, "sectionName") ??
      ledger.sectionName ??
      draftSectionName(input.target),
    nodes: [...ledger.nodes, node, ...childNodes],
    updatedAt,
  });
}

function verifyTransactionEvidenceBeforeRecord(input: {
  active: NonNullable<KotikitGraphState["activeFigmaTransaction"]>;
  packet: Record<string, unknown>;
  evidenceSnapshots: Record<string, unknown>[];
}): void {
  if (input.active.kind !== "create-screen-state" && input.active.kind !== "create-region-state") {
    return;
  }
  if (Object.keys(input.packet).length === 0 || input.evidenceSnapshots.length === 0) return;
  verifyFigmaEvidenceAgainstApplyPacket({
    packet: input.packet,
    evidenceSnapshots: input.evidenceSnapshots,
  });
}

function childLedgerNodesFromMetadata(
  input: {
    active: NonNullable<KotikitGraphState["activeFigmaTransaction"]>;
    metadata: Record<string, unknown>;
  },
  parent: { parentNodeId: string; recordedAt: string }
): FigmaNodeLedger["nodes"] {
  if (input.active.kind !== "create-screen-state" && input.active.kind !== "create-region-state") {
    return [];
  }

  return recordArray(input.metadata.nodes).flatMap((nodeMetadata) => {
    const nodeId = stringField(nodeMetadata, "id");
    if (nodeId === undefined || nodeId === parent.parentNodeId) return [];

    const semanticRole = childSemanticRoleFrom(nodeMetadata);
    if (semanticRole === undefined) return [];

    const draftComponentId = stringField(nodeMetadata, "draftComponentId");
    const partId = stringField(nodeMetadata, "partId");
    const componentRefs = uniqueStrings([
      ...optionalStringArray(input.active.id, nodeMetadata.componentRefs, "componentRefs"),
      stringField(nodeMetadata, "componentKey"),
      draftComponentId,
    ]);
    return [
      {
        nodeId,
        name:
          stringField(nodeMetadata, "name") ??
          partId ??
          draftComponentId ??
          `${input.active.label} child`,
        kind:
          stringField(nodeMetadata, "kind") ??
          (semanticRole === "component-instance" ? "INSTANCE" : "FRAME"),
        semanticRole,
        transactionId: input.active.id,
        placementId: input.active.placementId,
        ...(input.active.stateId === undefined ? {} : { stateId: input.active.stateId }),
        ...(draftComponentId === undefined ? {} : { draftComponentId }),
        ...(partId === undefined ? {} : { partId }),
        bounds: parseLedgerBounds(input.active.id, nodeMetadata.bounds),
        componentRefs,
        ...(componentSourceField(nodeMetadata) === undefined
          ? {}
          : { componentSource: componentSourceField(nodeMetadata) }),
        variableRefs: optionalStringArray(
          input.active.id,
          nodeMetadata.variableRefs,
          "variableRefs"
        ),
        ...(optionalStringArray(input.active.id, nodeMetadata.iconRefs, "iconRefs").length === 0
          ? {}
          : { iconRefs: optionalStringArray(input.active.id, nodeMetadata.iconRefs, "iconRefs") }),
        ...(stringField(nodeMetadata, "iconKey") === undefined
          ? {}
          : { iconKey: stringField(nodeMetadata, "iconKey") }),
        ...(booleanField(nodeMetadata, "iconPlaceholder") === undefined
          ? {}
          : { iconPlaceholder: booleanField(nodeMetadata, "iconPlaceholder") }),
        autoLayout: booleanField(nodeMetadata, "autoLayout") ?? false,
        ...(booleanField(nodeMetadata, "screenshotReviewed") === undefined
          ? {}
          : { screenshotReviewed: booleanField(nodeMetadata, "screenshotReviewed") }),
        ...(optionalStringArray(
          input.active.id,
          nodeMetadata.screenshotFindings,
          "screenshotFindings"
        ).length === 0
          ? {}
          : {
              screenshotFindings: optionalStringArray(
                input.active.id,
                nodeMetadata.screenshotFindings,
                "screenshotFindings"
              ),
            }),
        recordedAt: parent.recordedAt,
      },
    ];
  });
}

function childSemanticRoleFrom(
  nodeMetadata: Record<string, unknown>
): FigmaNodeLedger["nodes"][number]["semanticRole"] | undefined {
  const semanticRole = stringField(nodeMetadata, "semanticRole");
  if (
    semanticRole === "component-instance" ||
    semanticRole === "layout-frame" ||
    semanticRole === "annotation"
  ) {
    return semanticRole;
  }
  if (
    stringField(nodeMetadata, "draftComponentId") !== undefined ||
    stringField(nodeMetadata, "partId") !== undefined ||
    stringField(nodeMetadata, "componentKey") !== undefined
  ) {
    return "component-instance";
  }
  return undefined;
}

function activeTransactionFrom(
  transaction: FigmaTransactionPlan["transactions"][number]
): NonNullable<KotikitGraphState["activeFigmaTransaction"]> {
  return ActiveFigmaTransactionSchema.parse({
    id: transaction.id,
    order: transaction.order,
    kind: transaction.kind,
    label: transaction.label,
    placementId: transaction.placementId,
    ...(transaction.stateId === undefined ? {} : { stateId: transaction.stateId }),
    ...(transaction.draftComponentId === undefined
      ? {}
      : { draftComponentId: transaction.draftComponentId }),
    requiredMetadata: transaction.requiredMetadata,
  });
}

function parseLedgerBounds(
  transactionId: string,
  value: unknown
): FigmaNodeLedger["nodes"][number]["bounds"] {
  const bounds = recordFrom(value);
  if (
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number" ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new KotikitError(
      `Figma apply metadata for transaction ${transactionId} must include positive bounds width and height.`,
      "Record bounds as { x, y, width, height } for the created or updated node."
    );
  }
  return BoundsSchema.parse(bounds);
}

function requiredStringArray(transactionId: string, value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new KotikitError(
      `Figma apply metadata for transaction ${transactionId} must include ${field} as a string array.`,
      `Record ${field} as an array of compact Figma component or variable references.`
    );
  }
  return value;
}

function optionalStringArray(transactionId: string, value: unknown, field: string): string[] {
  if (value === undefined) return [];
  return requiredStringArray(transactionId, value, field);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function requiresAutoLayout(
  active: NonNullable<KotikitGraphState["activeFigmaTransaction"]>,
  metadata: Record<string, unknown>
): boolean {
  return (
    active.kind === "create-screen-state" ||
    active.kind === "create-region-state" ||
    active.kind === "create-draft-component" ||
    stringField(metadata, "semanticRole") === "layout-frame"
  );
}

function semanticRoleForTransaction(
  active: NonNullable<KotikitGraphState["activeFigmaTransaction"]>,
  metadata: Record<string, unknown>
): FigmaNodeLedger["nodes"][number]["semanticRole"] {
  if (stringField(metadata, "semanticRole") === "layout-frame") return "layout-frame";
  if (active.kind === "create-draft-component") return "draft-component";
  if (active.kind === "create-screen-state" || active.kind === "create-region-state") {
    return "screen-state";
  }
  return "component-instance";
}

function stateRepresentationForTransaction(
  active: NonNullable<KotikitGraphState["activeFigmaTransaction"]>,
  metadata: Record<string, unknown>
): FigmaNodeLedger["nodes"][number]["representation"] {
  const representation = stringField(metadata, "representation");
  if (
    representation === "screen-frame" ||
    representation === "region-state" ||
    representation === "component-state" ||
    representation === "flow-step"
  ) {
    return representation;
  }
  if (active.kind === "create-screen-state") return "screen-frame";
  if (active.kind === "create-region-state") return "region-state";
  return undefined;
}

function appendEvidenceSnapshot(
  existing: Record<string, unknown>[],
  value: unknown
): Record<string, unknown>[] {
  const snapshot = recordFrom(value);
  if (Object.keys(snapshot).length === 0) return existing;
  return [...existing, snapshot];
}

function applyReportFromLedger(
  ledger: FigmaNodeLedger,
  evidenceSnapshots: Record<string, unknown>[] = []
): Record<string, unknown> {
  const nodes = ledger.nodes.map((node) => compactReportNode(node));
  return {
    schemaVersion: "FigmaApplyReport/v1",
    status: "recorded",
    fileKey: ledger.fileKey,
    pageId: ledger.pageId,
    sectionName: ledger.sectionName,
    nodes,
    variableBindings: ledger.nodes.flatMap((node) =>
      node.variableRefs.map((variableRef) => ({
        targetId: node.nodeId,
        variableRef,
        transactionId: node.transactionId,
      }))
    ),
    layoutFrames: nodes
      .filter((node) => node.autoLayout === true)
      .map((node) => ({
        id: node.id,
        name: node.name,
        transactionId: node.transactionId,
        bounds: node.bounds,
        autoLayout: node.autoLayout,
      })),
    repeatedItems: [],
    textTransforms: [],
    evidenceSnapshots,
    states: ledger.nodes
      .filter((node) => node.stateId !== undefined)
      .map((node) => ({
        stateId: node.stateId,
        ...(node.representation === undefined ? {} : { representation: node.representation }),
        nodeId: node.nodeId,
        transactionId: node.transactionId,
      })),
    draftComponentInstances: ledger.nodes
      .filter(
        (node) => node.draftComponentId !== undefined && node.semanticRole !== "draft-component"
      )
      .map((node) => ({
        draftComponentId: node.draftComponentId,
        nodeId: node.nodeId,
        transactionId: node.transactionId,
      })),
    draftComponentPlacements: ledger.nodes
      .filter((node) => node.draftComponentId !== undefined)
      .map((node) => ({
        draftComponentId: node.draftComponentId,
        nodeId: node.nodeId,
        sectionName: ledger.sectionName,
        bounds: node.bounds,
      })),
    iconRefs: uniqueStrings([
      ...ledger.nodes.flatMap((node) => node.iconRefs ?? []),
      ...ledger.nodes.map((node) => node.iconKey),
    ]),
    recordedAt: ledger.updatedAt,
  };
}

function compactReportNode(node: FigmaNodeLedger["nodes"][number]): Record<string, unknown> {
  return {
    id: node.nodeId,
    name: node.name,
    kind: node.kind,
    semanticRole: node.semanticRole,
    transactionId: node.transactionId,
    placementId: node.placementId,
    ...(node.stateId === undefined ? {} : { stateId: node.stateId }),
    ...(node.representation === undefined ? {} : { representation: node.representation }),
    ...(node.draftComponentId === undefined ? {} : { draftComponentId: node.draftComponentId }),
    ...(node.partId === undefined ? {} : { partId: node.partId }),
    bounds: node.bounds,
    componentRefs: node.componentRefs,
    ...(node.componentSource === undefined ? {} : { componentSource: node.componentSource }),
    variableRefs: node.variableRefs,
    ...(node.iconRefs === undefined ? {} : { iconRefs: node.iconRefs }),
    ...(node.iconKey === undefined ? {} : { iconKey: node.iconKey }),
    ...(node.iconPlaceholder === undefined ? {} : { iconPlaceholder: node.iconPlaceholder }),
    autoLayout: node.autoLayout,
    ...(node.directVisibleChildCount === undefined
      ? {}
      : { directVisibleChildCount: node.directVisibleChildCount }),
    ...(node.autoLayoutContainerCount === undefined
      ? {}
      : { autoLayoutContainerCount: node.autoLayoutContainerCount }),
    ...(node.screenshotReviewed === undefined
      ? {}
      : { screenshotReviewed: node.screenshotReviewed }),
    ...(node.screenshotFindings === undefined
      ? {}
      : { screenshotFindings: node.screenshotFindings }),
  };
}

function validateApplyMetadata(
  target: ReturnType<typeof ensureDraftTarget>,
  metadata: Record<string, unknown>
): void {
  if (metadata.fileKey !== target.fileKey) {
    throw new KotikitError(
      "This applied Figma node belongs to a different Figma file than the bound draft target.",
      "Open the bound draft file before applying the design."
    );
  }
  if (metadata.pageId !== target.pageId) {
    throw new KotikitError(
      "This applied Figma node is outside the bound draft page.",
      "Open the exact bound draft page before applying the design."
    );
  }
  if (target.section?.name !== undefined && metadata.sectionName !== target.section.name) {
    throw new KotikitError(
      "This applied Figma node is outside the kotikit-owned draft section.",
      "Apply the design inside the Section recorded in the design plan."
    );
  }
}

function draftSectionName(target: ReturnType<typeof ensureDraftTarget>): string {
  if (target.section?.name !== undefined) return target.section.name;
  throw new KotikitError(
    "The Figma draft page target is missing a kotikit-owned Section.",
    "Keep generated work inside the section recorded by kotikit."
  );
}

function verifyAgainstApplyPacket(
  packet: Record<string, unknown>,
  report: Record<string, unknown>
): void {
  if (Object.keys(packet).length === 0) return;
  if (recordFrom(packet.metadata).incrementalTransactions === true) {
    verifyIncrementalApplyPacket(packet, report);
    return;
  }
  verifyComponentRefs(
    recordArray(recordFrom(packet.uiComposition).parts),
    recordArray(report.nodes)
  );
  verifyVariableBindings(
    recordArray(recordFrom(packet.variableBindingPlan).bindings),
    recordArray(report.variableBindings)
  );
  verifyLayoutFrames(
    recordArray(recordFrom(packet.layoutContract).frames),
    recordArray(report.layoutFrames)
  );
  verifyExactJson(
    "repeated item structure",
    recordArray(packet.repeatedItems),
    recordArray(report.repeatedItems)
  );
  verifyExactJson(
    "text transforms",
    recordArray(packet.textTransforms),
    recordArray(report.textTransforms)
  );
}

function verifyIncrementalApplyPacket(
  packet: Record<string, unknown>,
  report: Record<string, unknown>
): void {
  const nodes = recordArray(report.nodes);
  verifyFigmaEvidenceAgainstApplyPacket({
    packet,
    evidenceSnapshots: recordArray(report.evidenceSnapshots),
  });
  const componentRefs = stringSetFromArrays(nodes.map((node) => node.componentRefs));
  stringSetFromArrays(nodes.map((node) => node.componentKey)).forEach((componentRef) => {
    componentRefs.add(componentRef);
  });
  const variableRefs = stringSetFromArrays([
    ...nodes.map((node) => node.variableRefs),
    recordArray(report.variableBindings).map((binding) => binding.variableRef),
  ]);
  const iconRefs = stringSetFromArrays([
    report.iconRefs,
    ...nodes.map((node) => node.iconRefs),
    ...nodes.map((node) => node.iconKey),
  ]);

  verifyIncrementalComponentRefs(recordArray(recordFrom(packet.uiComposition).parts), {
    componentRefs,
    nodes,
  });
  verifyIncrementalActualComponentInstances(
    recordArray(recordFrom(packet.uiComposition).parts),
    nodes
  );
  verifyIncrementalVariableRefs(
    recordArray(recordFrom(packet.variableBindingPlan).bindings),
    variableRefs
  );
  verifyIncrementalAutoLayout(recordArray(recordFrom(packet.layoutContract).frames), report);
  verifyIncrementalIconRefs(recordArray(packet.iconRequirements), nodes, iconRefs);

  if (recordArray(report.repeatedItems).length > 0) {
    verifyExactJson(
      "repeated item structure",
      recordArray(packet.repeatedItems),
      recordArray(report.repeatedItems)
    );
  }
  if (recordArray(report.textTransforms).length > 0) {
    verifyExactJson(
      "text transforms",
      recordArray(packet.textTransforms),
      recordArray(report.textTransforms)
    );
  }
}

function verifyIncrementalActualComponentInstances(
  parts: Record<string, unknown>[],
  nodes: Record<string, unknown>[]
): void {
  parts
    .filter((part) => part.source === "existing-component" && stringField(part, "componentKey"))
    .forEach((part) => {
      const componentKey = stringField(part, "componentKey");
      const applied = nodes.find(
        (node) =>
          node.componentSource === "existing-component" &&
          node.partId === part.id &&
          componentKey !== undefined &&
          nodeHasComponentRef(node, componentKey)
      );
      if (applied === undefined) {
        throw new KotikitError(
          `The incremental Figma apply report is missing an actual design-system instance for "${String(part.name ?? part.id)}".`,
          "Record componentSource: existing-component for every placed design-system component, not a copied or draft layer."
        );
      }
    });
}

function verifyIncrementalIconRefs(
  iconRequirements: Record<string, unknown>[],
  nodes: Record<string, unknown>[],
  iconRefs: Set<string>
): void {
  if (iconRequirements.length === 0) return;
  const missing = iconRequirements.filter(
    (requirement) => !iconRequirementSatisfied(requirement, nodes, iconRefs)
  );
  if (missing.length === 0) return;
  throw new KotikitError(
    "The incremental Figma apply report is missing icon ref proof.",
    "Record iconRefs for every required icon affordance placed from the local design-system icon index."
  );
}

function iconRequirementSatisfied(
  requirement: Record<string, unknown>,
  nodes: Record<string, unknown>[],
  globalIconRefs: Set<string>
): boolean {
  const expectedIconRef =
    stringField(requirement, "iconKey") ?? stringField(requirement, "iconName");
  const partId = stringField(requirement, "partId");
  if (partId === undefined) {
    if (expectedIconRef !== undefined) return globalIconRefs.has(expectedIconRef);
    return globalIconRefs.size > 0;
  }
  return nodes
    .filter((node) => node.partId === partId && node.iconPlaceholder !== true)
    .some((node) => {
      const refs = nodeIconRefs(node);
      if (expectedIconRef !== undefined) return refs.has(expectedIconRef);
      return refs.size > 0;
    });
}

function nodeHasComponentRef(node: Record<string, unknown>, componentKey: string): boolean {
  return (
    node.componentKey === componentKey || stringArray(node.componentRefs).includes(componentKey)
  );
}

function nodeIconRefs(node: Record<string, unknown>): Set<string> {
  return new Set([
    ...stringArray(node.iconRefs),
    ...(stringField(node, "iconKey") === undefined ? [] : [String(node.iconKey)]),
  ]);
}

function verifyIncrementalComponentRefs(
  parts: Record<string, unknown>[],
  input: { componentRefs: Set<string>; nodes: Record<string, unknown>[] }
): void {
  parts.forEach((part) => {
    const componentKey = stringField(part, "componentKey");
    if (componentKey !== undefined && !input.componentRefs.has(componentKey)) {
      throw new KotikitError(
        `The incremental Figma apply report is missing component ref "${componentKey}".`,
        "Record compact componentRefs for every design-system or draft component used by the transaction."
      );
    }

    const draftComponentId = stringField(part, "draftComponentId");
    if (
      draftComponentId !== undefined &&
      !input.nodes.some((node) => node.draftComponentId === draftComponentId)
    ) {
      throw new KotikitError(
        `The incremental Figma apply report is missing draft component origin "${draftComponentId}".`,
        "Record draftComponentId on compact report nodes created from kotikit draft components."
      );
    }
  });
}

function verifyIncrementalVariableRefs(
  expectedBindings: Record<string, unknown>[],
  variableRefs: Set<string>
): void {
  expectedBindings.forEach((expected) => {
    if (!requiresIncrementalVariableRef(expected)) return;
    const expectedRefs = variableBindingRefs(expected);
    if (expectedRefs.length === 0 || expectedRefs.some((ref) => variableRefs.has(ref))) return;
    throw new KotikitError(
      `The incremental Figma apply report is missing variable/style ref "${expectedRefs[0]}".`,
      "Record compact variableRefs for variables and styles used by the transaction."
    );
  });
}

function variableBindingRefs(binding: Record<string, unknown>): string[] {
  return [
    stringField(binding, "id"),
    stringField(binding, "key"),
    stringField(binding, "name"),
  ].filter((ref): ref is string => ref !== undefined);
}

function verifyIncrementalAutoLayout(
  expectedFrames: Record<string, unknown>[],
  report: Record<string, unknown>
): void {
  if (expectedFrames.length === 0) return;
  const nodes = recordArray(report.nodes);
  const layoutFrames = recordArray(report.layoutFrames);
  const hasAutoLayout =
    nodes.some((node) => node.autoLayout === true) ||
    layoutFrames.some((frame) => frame.autoLayout === true);
  if (hasAutoLayout) return;
  throw new KotikitError(
    "The incremental Figma apply report is missing auto-layout proof.",
    "Record autoLayout: true for created screen, region, draft component, or layout-frame nodes."
  );
}

function requiresIncrementalVariableRef(binding: Record<string, unknown>): boolean {
  return (
    binding.source === "variable" ||
    binding.source === "style" ||
    binding.source === "draft-variable"
  );
}

function stringSetFromArrays(values: unknown[]): Set<string> {
  return new Set(
    values.flatMap((value) =>
      typeof value === "string" && value.length > 0
        ? [value]
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
          : []
    )
  );
}

function verifyComponentRefs(
  parts: Record<string, unknown>[],
  nodes: Record<string, unknown>[]
): void {
  parts.forEach((part) => {
    const applied = nodes.find((node) => nodeMatchesPart(node, part));
    if (applied === undefined) {
      throw new KotikitError(
        `The applied draft is missing metadata for component part "${String(part.name ?? part.id)}".`,
        "Record partId and component metadata for each meaningful UI part after official Figma MCP writes."
      );
    }
    if (typeof part.componentKey === "string" && applied.componentKey !== part.componentKey) {
      throw new KotikitError(
        `The applied draft has the wrong component key for "${String(part.name ?? part.id)}".`,
        "Use the design-system component key from the apply packet instead of hardcoded layers."
      );
    }
    if (
      typeof part.draftComponentId === "string" &&
      applied.draftComponentId !== part.draftComponentId
    ) {
      throw new KotikitError(
        `The applied draft has the wrong draft component origin for "${String(part.name ?? part.id)}".`,
        "Create and use the kotikit draft component recorded in the apply packet."
      );
    }
  });
}

function verifyVariableBindings(
  expectedBindings: Record<string, unknown>[],
  appliedBindings: Record<string, unknown>[]
): void {
  expectedBindings.forEach((expected) => {
    const applied = appliedBindings.find(
      (binding) => binding.targetId === expected.targetId && binding.property === expected.property
    );
    if (applied === undefined) {
      throw new KotikitError(
        `The applied draft is missing a variable/style binding for ${String(expected.targetId)} ${String(expected.property)}.`,
        "Bind variables or styles from the apply packet, or record the approved literal fallback."
      );
    }
    ["source", "name", "id", "literalValue", "approvalRef"].forEach((key) => {
      if (expected[key] !== undefined && applied[key] !== expected[key]) {
        throw new KotikitError(
          `The applied draft has a mismatched variable/style binding for ${String(expected.targetId)} ${String(expected.property)}.`,
          "Use the exact variable, style, or approved literal fallback from the apply packet."
        );
      }
    });
  });
}

function verifyLayoutFrames(
  expectedFrames: Record<string, unknown>[],
  appliedFrames: Record<string, unknown>[]
): void {
  expectedFrames.forEach((expected) => {
    const applied = appliedFrames.find((frame) => frame.id === expected.id);
    if (applied === undefined) {
      throw new KotikitError(
        `The applied draft is missing layout metadata for frame "${String(expected.id)}".`,
        "Record auto-layout or grid metadata for each structural frame."
      );
    }
    ["mode", "direction", "sizing", "spacingToken"].forEach((key) => {
      if (expected[key] !== undefined && applied[key] !== expected[key]) {
        throw new KotikitError(
          `The applied draft has mismatched layout metadata for frame "${String(expected.id)}".`,
          "Use the auto-layout or grid settings from the layout contract."
        );
      }
    });
  });
}

function verifyExactJson(
  label: string,
  expected: Record<string, unknown>[],
  applied: Record<string, unknown>[]
): void {
  if (expected.length === 0) return;
  if (JSON.stringify(toJson(expected)) !== JSON.stringify(toJson(applied))) {
    throw new KotikitError(
      `The applied draft has mismatched ${label}.`,
      "Record and preserve the repeated structure and text-transform metadata from the apply packet."
    );
  }
}

function nodeMatchesPart(node: Record<string, unknown>, part: Record<string, unknown>): boolean {
  return (
    node.partId === part.id ||
    normalize(node.name) === normalize(part.name) ||
    normalize(node.componentName) === normalize(part.name)
  );
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

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | undefined {
  const candidate = value[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function componentSourceField(
  value: Record<string, unknown>
): "existing-component" | "draft-component" | "screen-draft" | "approved-primitive" | undefined {
  const candidate = value.componentSource;
  return candidate === "existing-component" ||
    candidate === "draft-component" ||
    candidate === "screen-draft" ||
    candidate === "approved-primitive"
    ? candidate
    : undefined;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}

function toJson(value: unknown): JSONType {
  return JSON.parse(JSON.stringify(value));
}
