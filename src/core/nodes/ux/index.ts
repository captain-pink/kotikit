import { z } from "zod";
import { KotikitError } from "../../../util/result.js";
import { buildStateMatrix, buildUxEnvelope } from "../../domain/ux-envelope.js";
import { selectPatternPack } from "../../domain/ux-pattern-pack.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
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
      return {
        statePatch: {
          uxEnvelope: buildUxEnvelope({
            userIntent: state.userIntent ?? "Create a product screen.",
            screen: screenFrom(state.screen),
          }),
        },
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
      return {
        statePatch: {
          stateMatrix: buildStateMatrix({
            envelope: state.uxEnvelope,
            patternPack: selectPatternPack(state.uxEnvelope.screenArchetype),
          }),
        },
      } satisfies RuntimeNodeOutput;
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
