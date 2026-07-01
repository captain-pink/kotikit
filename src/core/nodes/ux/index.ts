import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildStateMatrix, buildUxEnvelope } from "../../domain/ux-envelope.js";
import { selectPatternPack } from "../../domain/ux-pattern-pack.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});

export const uxNodeDefinitions: NodeDefinition[] = [
  node({
    key: "ux.buildEnvelope",
    stateReads: ["userIntent", "screen"],
    stateWrites: ["uxEnvelope"],
    requiredCapabilities: ["ux.plan"],
    run: async (input) => {
      const state = graphState(input.state);
      const uxEnvelope = buildUxEnvelope({
        userIntent: state.userIntent ?? "Create a product screen.",
        screen: screenFrom(state.screen),
      });
      return {
        statePatch: { uxEnvelope },
        artifacts: [
          artifactFor({
            state,
            key: "ux.buildEnvelope",
            type: "ux-envelope",
            payload: uxEnvelope,
          }),
        ],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ux.planStateMatrix",
    stateReads: ["uxEnvelope"],
    stateWrites: ["stateMatrix"],
    requiredCapabilities: ["ux.plan"],
    run: async (input) => {
      const state = graphState(input.state);
      if (state.uxEnvelope === undefined) {
        throw new KotikitError(
          "The UX envelope has not been built yet.",
          "Run ux.buildEnvelope before planning screen states."
        );
      }
      const stateMatrix = buildStateMatrix({
        envelope: state.uxEnvelope,
        patternPack: selectPatternPack(state.uxEnvelope.screenArchetype),
      });
      return {
        statePatch: { stateMatrix },
        artifacts: [
          artifactFor({
            state,
            key: "ux.planStateMatrix",
            type: "state-matrix",
            payload: stateMatrix,
          }),
        ],
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function artifactFor(input: {
  state: KotikitGraphState;
  key: string;
  type: "ux-envelope" | "state-matrix";
  payload: Artifact["payload"];
}): Artifact {
  const now = nowIso();
  return {
    id: `${input.state.runId}-${input.type}`,
    runId: input.state.runId,
    type: input.type,
    schemaVersion: ArtifactSchemaVersionByType[input.type],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: input.key, version: "1.0.0" },
    payload: input.payload,
  };
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

function screenFrom(value: unknown): {
  title?: string;
  requiredUiParts?: string[];
  states?: string[];
} {
  const record = recordFrom(value);
  return {
    title: stringFrom(record.title),
    requiredUiParts: stringArray(record.requiredUiParts),
    states: stringArray(record.states),
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
