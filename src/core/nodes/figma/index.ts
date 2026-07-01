import { type JSONType, z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { ensureDraftTarget } from "../../adapters/figma/target.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: { status: "waiting-for-figma" };
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

function verifyAgainstApplyPacket(
  packet: Record<string, unknown>,
  report: Record<string, unknown>
): void {
  if (Object.keys(packet).length === 0) return;
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
