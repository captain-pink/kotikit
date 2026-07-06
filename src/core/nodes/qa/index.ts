import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { runUiQualityGate } from "../../domain/ui-quality-gate.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import {
  type Artifact,
  ArtifactSchemaVersionByType,
  UIQualityGateReportSchema,
} from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});

export const qaNodeDefinitions: NodeDefinition[] = [
  node({
    key: "qa.runUiQualityGate",
    stateReads: ["applyReport", "canvasPlan", "draftPlan", "screen"],
    stateWrites: ["uiQualityGate"],
    requiredCapabilities: ["qa.run"],
    run: async (input) => {
      const state = graphState(input.state);
      const applyReport = recordFrom(state.applyReport);
      const nodes = recordArray(applyReport.nodes);
      if (nodes.length === 0) {
        throw new KotikitError(
          "Figma apply metadata has not been recorded yet.",
          "Record applied draft nodes with kotikit_record_figma_apply before running the UI quality gate."
        );
      }
      const applyPacket = recordFrom(recordFrom(state.draftPlan).applyPacket);
      const screen = recordFrom(state.screen);
      return {
        statePatch: {
          uiQualityGate: runUiQualityGate({
            nodes,
            canvasPlan: state.canvasPlan,
            expectedContent: recordArray(screen.expectedContent),
            evidenceSnapshots: recordArray(applyReport.evidenceSnapshots),
            iconRequirements: recordArray(applyPacket.iconRequirements),
            iconRefs: stringArray(applyReport.iconRefs),
          }),
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "qa.postDraftQa",
    stateReads: ["uiQualityGate"],
    stateWrites: ["artifacts"],
    sideEffects: "filesystem",
    requiredCapabilities: ["qa.run"],
    run: async (input) => {
      const state = graphState(input.state);
      if (state.uiQualityGate === undefined) {
        throw new KotikitError(
          "The UI quality gate has not run yet.",
          "Run qa.runUiQualityGate before saving post-draft QA."
        );
      }
      const report = UIQualityGateReportSchema.parse(state.uiQualityGate);
      const now = nowIso();
      const artifact: Artifact = {
        id: `${state.runId}-ui-quality-gate-report`,
        runId: state.runId,
        type: "ui-quality-gate-report",
        schemaVersion: ArtifactSchemaVersionByType["ui-quality-gate-report"],
        createdAt: now,
        updatedAt: now,
        sourceNode: { key: "qa.postDraftQa", version: "1.0.0" },
        payload: report,
      };
      return { artifacts: [artifact] } satisfies RuntimeNodeOutput;
    },
  }),
];

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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}
