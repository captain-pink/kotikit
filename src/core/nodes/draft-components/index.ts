import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { ensureDraftTarget } from "../../adapters/figma/target.js";
import {
  buildDraftComponentLifecycle,
  verifyDraftComponentLifecycle,
} from "../../domain/draft-component-lifecycle.js";
import { buildDraftComponentPlan } from "../../domain/draft-component-plan.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: ReturnType<typeof createUserInterrupt>;
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});

export const draftComponentNodeDefinitions: NodeDefinition[] = [
  node({
    key: "draftComponents.planMissing",
    kind: "interrupt",
    stateReads: ["fitReport"],
    stateWrites: ["draftComponentPlan", "pendingQuestion"],
    run: async (input) => {
      const state = graphState(input.state);
      const missingParts = missingComponents(state);
      if (missingParts.length === 0) return {} satisfies RuntimeNodeOutput;
      const approvedPrimitiveExceptions = approvedPrimitiveExceptionsFrom(state);
      const unresolvedParts = missingParts.filter(
        (part) =>
          !approvedPrimitiveExceptions.some((approved) => normalize(approved) === normalize(part))
      );
      if (unresolvedParts.length === 0) return {} satisfies RuntimeNodeOutput;
      const strategy =
        answerFor(state, "missing-components") ??
        answerFor(state, "missing-component-strategy") ??
        stringField(recordFrom(state), "draftComponentStrategy");
      if (strategy === "approve-primitive-exceptions") {
        return {} satisfies RuntimeNodeOutput;
      }
      if (strategy !== "create-draft-components") {
        const pendingQuestion = {
          id: "missing-components",
          prompt: "How should kotikit resolve missing design-system components?",
          choices: ["create-draft-components", "approve-primitive-exceptions"],
        };
        return {
          statePatch: { pendingQuestion },
          interrupt: createUserInterrupt(pendingQuestion),
        } satisfies RuntimeNodeOutput;
      }
      return {
        statePatch: { draftComponentPlan: buildDraftComponentPlan(unresolvedParts) },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "draftComponents.createOnDraftPage",
    stateReads: ["figmaTarget", "draftComponentPlan", "draftPlan"],
    stateWrites: ["draftPlan"],
    sideEffects: "figma-write",
    requiredCapabilities: ["draftComponents.write"],
    run: async (input) => {
      const state = graphState(input.state);
      ensureDraftTarget(state.figmaTarget);
      const plan = state.draftComponentPlan;
      if (plan === undefined) return {} satisfies RuntimeNodeOutput;
      return {
        statePatch: {
          draftPlan: {
            ...recordFrom(state.draftPlan),
            createdDraftComponents: plan.components.map((component) => ({
              id: component.id,
              name: component.name,
              componentKey: `draft:${component.id}`,
              sectionName: plan.sectionName,
            })),
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "draftComponents.validateCreated",
    stateReads: ["draftComponentPlan", "draftPlan"],
    stateWrites: [],
    run: async (input) => {
      const state = graphState(input.state);
      const planned = state.draftComponentPlan?.components ?? [];
      const created = recordArray(recordFrom(state.draftPlan).createdDraftComponents);
      const missing = planned.find((component) => {
        const match = created.find((item) => item.id === component.id);
        return typeof match?.componentKey !== "string" || match.componentKey.length === 0;
      });
      if (missing !== undefined) {
        throw new KotikitError(
          `Draft component "${missing.name}" is missing a component key.`,
          "Create and validate draft components in the active draft page before composing the screen."
        );
      }
      return {} satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "draftComponents.buildLifecycle",
    stateReads: ["draftComponentPlan", "draftPlan", "applyReport"],
    stateWrites: ["draftComponentLifecycle"],
    run: async (input) => {
      const state = graphState(input.state);
      if (state.draftComponentPlan === undefined) return {} satisfies RuntimeNodeOutput;
      const draftComponentLifecycle = buildDraftComponentLifecycle({
        plan: state.draftComponentPlan,
        createdDraftComponents: recordArray(recordFrom(state.draftPlan).createdDraftComponents),
        appliedInstances: recordArray(recordFrom(state.applyReport).draftComponentInstances),
      });
      return {
        statePatch: { draftComponentLifecycle },
        artifacts: [draftComponentLifecycleArtifact(state, draftComponentLifecycle)],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "draftComponents.verifyLifecycle",
    stateReads: ["draftComponentLifecycle"],
    stateWrites: [],
    run: async (input) => {
      const lifecycle = graphState(input.state).draftComponentLifecycle;
      if (lifecycle !== undefined) verifyDraftComponentLifecycle(lifecycle);
      return {} satisfies RuntimeNodeOutput;
    },
  }),
];

function draftComponentLifecycleArtifact(
  state: KotikitGraphState,
  payload: Artifact["payload"]
): Artifact {
  const now = nowIso();
  return {
    id: `${state.runId}-draft-component-lifecycle`,
    runId: state.runId,
    type: "draft-component-lifecycle",
    schemaVersion: ArtifactSchemaVersionByType["draft-component-lifecycle"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "draftComponents.buildLifecycle", version: "1.0.0" },
    payload,
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

function missingComponents(state: KotikitGraphState): string[] {
  return recordArray(recordFrom(state.fitReport).missingComponents)
    .map((item) => item.requestedPart)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

function approvedPrimitiveExceptionsFrom(state: KotikitGraphState): string[] {
  return stringArray(recordFrom(state.fitReport).approvedPrimitiveExceptions);
}

function answerFor(state: KotikitGraphState, questionId: string): string | undefined {
  return state.answers?.[questionId];
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

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
