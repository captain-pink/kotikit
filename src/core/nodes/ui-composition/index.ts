import { z } from "zod";
import { KotikitError } from "../../../util/result.js";
import { buildAutoLayoutContract } from "../../domain/layout-contract.js";
import {
  buildStateRepresentationContract,
  type StateRepresentationContract,
  verifyStateRepresentationMetadata,
} from "../../domain/state-representation.js";
import {
  assertNoHardcodedImitation,
  buildUiCompositionContract,
} from "../../domain/ui-composition-contract.js";
import { buildVariableBindingPlan } from "../../domain/variable-binding-plan.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import type { UICompositionContract } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: ReturnType<typeof createUserInterrupt>;
};

const EmptyParamsSchema = z.strictObject({});

export const uiCompositionNodeDefinitions: NodeDefinition[] = [
  node({
    key: "ui.buildCompositionContract",
    stateReads: ["screen", "fitReport", "draftComponentPlan"],
    stateWrites: ["uiComposition"],
    run: async (input) => {
      const state = graphState(input.state);
      const screen = recordFrom(state.screen);
      const contract = buildUiCompositionContract({
        requiredUiParts: stringArray(screen.requiredUiParts),
        neededStates: stringArray(screen.states),
        fitReport: recordFrom(state.fitReport),
        draftComponentPlan: state.draftComponentPlan,
        createdDraftComponents: recordArray(recordFrom(state.draftPlan).createdDraftComponents),
        approvedPrimitiveExceptions: stringArray(
          recordFrom(state.fitReport).approvedPrimitiveExceptions
        ),
      });
      return { statePatch: { uiComposition: contract } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ui.buildLayoutContract",
    stateReads: ["uiComposition"],
    stateWrites: ["layoutContract"],
    run: async (input) => {
      const state = graphState(input.state);
      const uiComposition = requireUiComposition(state.uiComposition);
      return {
        statePatch: { layoutContract: buildAutoLayoutContract({ uiComposition }) },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ui.buildStateRepresentationContract",
    stateReads: ["stateMatrix"],
    stateWrites: ["stateRepresentation"],
    run: async (input) => {
      const state = graphState(input.state);
      if (state.stateMatrix === undefined) {
        throw new KotikitError(
          "The state matrix has not been planned yet.",
          "Plan UX states before composing high-fidelity screens."
        );
      }
      return {
        statePatch: {
          stateRepresentation: buildStateRepresentationContract({
            stateMatrix: state.stateMatrix,
          }),
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ui.buildVariableBindingPlan",
    kind: "interrupt",
    stateReads: ["uiComposition", "designSystem"],
    stateWrites: ["variableBindingPlan", "pendingQuestion"],
    run: async (input) => {
      const state = graphState(input.state);
      const uiComposition = requireUiComposition(state.uiComposition);
      const designSystem = recordFrom(state.designSystem);
      const result = buildVariableBindingPlan({
        uiComposition,
        variables: recordArray(designSystem.variables),
        literalFallbackApproved:
          recordFrom(state.variableBindingPlan).literalFallbackApproved === true ||
          state.answers?.["approve-literal-variable-fallback"] === "approve-draft-only-literals",
      });
      if (result === "needs-literal-approval") {
        const pendingQuestion = {
          id: "approve-literal-variable-fallback",
          prompt:
            "No usable design variables were found. Approve draft-only literal fallbacks or sync variables first?",
          choices: ["sync-variables", "approve-draft-only-literals"],
        };
        return {
          statePatch: { pendingQuestion },
          interrupt: createUserInterrupt(pendingQuestion),
        } satisfies RuntimeNodeOutput;
      }
      return { statePatch: { variableBindingPlan: result } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ui.verifyStateRepresentation",
    stateReads: ["stateRepresentation", "applyReport"],
    stateWrites: [],
    run: async (input) => {
      const state = graphState(input.state);
      verifyStateRepresentationMetadata({
        contract: requireStateRepresentation(state.stateRepresentation),
        appliedStates: recordArray(recordFrom(state.applyReport).states),
      });
      return {} satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ui.validateNoHardcodedImitation",
    stateReads: ["draftPlan", "uiComposition"],
    stateWrites: [],
    run: async (input) => {
      assertNoHardcodedImitation({ draftPlan: graphState(input.state).draftPlan });
      return {} satisfies RuntimeNodeOutput;
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

function requireUiComposition(value: unknown): UICompositionContract {
  if (value === undefined) {
    throw new KotikitError(
      "The UI composition contract has not been built yet.",
      "Build the composition contract before layout, variables, or draft planning."
    );
  }
  return value as UICompositionContract;
}

function requireStateRepresentation(value: unknown): StateRepresentationContract {
  if (value === undefined) {
    throw new KotikitError(
      "The state representation contract has not been built yet.",
      "Build the state representation contract before verifying applied Figma state metadata."
    );
  }
  return value as StateRepresentationContract;
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
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
