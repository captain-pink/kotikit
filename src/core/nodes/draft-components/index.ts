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
    stateReads: [
      "figmaTarget",
      "draftComponentPlan",
      "draftPlan",
      "canvasPlan",
      "activeFigmaTransaction",
      "applyMetadata",
    ],
    stateWrites: ["draftPlan", "activeFigmaTransaction", "applyMetadata"],
    sideEffects: "figma-write",
    requiredCapabilities: ["draftComponents.write"],
    run: async (input) => {
      const state = graphState(input.state);
      const target = ensureDraftTarget(state.figmaTarget);
      const plan = state.draftComponentPlan;
      if (plan === undefined) return {} satisfies RuntimeNodeOutput;
      if (state.activeFigmaTransaction?.kind === "create-draft-component") {
        const metadata = recordFrom(state.applyMetadata);
        if (Object.keys(metadata).length === 0) {
          return {
            interrupt: { status: "waiting-for-figma", resume: "same-node" },
          } satisfies RuntimeNodeOutput;
        }
        const created = recordDraftComponentMetadata({
          state,
          target,
          plan,
          metadata,
          draftComponentId: state.activeFigmaTransaction.draftComponentId,
        });
        const nextTransaction = nextDraftComponentTransaction({
          state,
          plan,
          createdDraftComponents: created,
        });

        return {
          statePatch: {
            draftPlan: {
              ...recordFrom(state.draftPlan),
              createdDraftComponents: created,
            },
            activeFigmaTransaction: nextTransaction,
            applyMetadata: undefined,
          },
          ...(nextTransaction === undefined
            ? {}
            : { interrupt: { status: "waiting-for-figma", resume: "same-node" as const } }),
        } satisfies RuntimeNodeOutput;
      }

      const nextTransaction = nextDraftComponentTransaction({
        state,
        plan,
        createdDraftComponents: createdDraftComponentsFrom(state),
      });
      if (nextTransaction === undefined) return {} satisfies RuntimeNodeOutput;

      return {
        statePatch: {
          activeFigmaTransaction: nextTransaction,
        },
        interrupt: { status: "waiting-for-figma", resume: "same-node" },
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
        return (
          typeof match?.componentKey !== "string" ||
          match.componentKey.length === 0 ||
          match.componentKey.startsWith("draft:")
        );
      });
      if (missing !== undefined) {
        throw new KotikitError(
          `Draft component "${missing.name}" is missing a real Figma component key.`,
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
        placements: recordArray(recordFrom(state.applyReport).draftComponentPlacements),
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

function recordDraftComponentMetadata(input: {
  state: KotikitGraphState;
  target: ReturnType<typeof ensureDraftTarget>;
  plan: NonNullable<KotikitGraphState["draftComponentPlan"]>;
  metadata: Record<string, unknown>;
  draftComponentId?: string;
}): Record<string, unknown>[] {
  if (input.draftComponentId === undefined) {
    throw new KotikitError(
      "The active draft component transaction is missing a draft component id.",
      "Restart the draft component creation transaction."
    );
  }
  if (input.metadata.transactionId !== input.state.activeFigmaTransaction?.id) {
    throw new KotikitError(
      "The Figma draft component metadata belongs to a different transaction.",
      "Record metadata for the active draft component transaction before continuing."
    );
  }
  if (input.metadata.fileKey !== input.target.fileKey) {
    throw new KotikitError(
      "The Figma draft component metadata came from a different file.",
      "Apply the draft component transaction in the bound Figma draft file."
    );
  }
  if (input.metadata.pageId !== input.target.pageId) {
    throw new KotikitError(
      "The Figma draft component metadata came from a different page.",
      "Apply the draft component transaction in the bound Figma draft page."
    );
  }
  if (input.metadata.sectionName !== input.target.section?.name) {
    throw new KotikitError(
      "The Figma draft component metadata came from outside the kotikit section.",
      "Keep draft component creation inside the section recorded by kotikit."
    );
  }
  if (input.metadata.figmaNodeKind !== "COMPONENT") {
    throw new KotikitError(
      "The draft component transaction did not create a Figma component.",
      "Create a real component before composing screens from it."
    );
  }

  const componentKey = realComponentKeyFrom(input.metadata);
  const component = input.plan.components.find((item) => item.id === input.draftComponentId);
  if (component === undefined) {
    throw new KotikitError(
      `The Figma draft component metadata references unknown component ${input.draftComponentId}.`,
      "Regenerate the draft component plan before recording metadata."
    );
  }

  return upsertCreatedDraftComponent(createdDraftComponentsFrom(input.state), {
    id: component.id,
    name: component.name,
    componentKey,
    componentNodeId: stringField(input.metadata, "figmaNodeId"),
    sectionName: input.plan.sectionName,
  });
}

function nextDraftComponentTransaction(input: {
  state: KotikitGraphState;
  plan: NonNullable<KotikitGraphState["draftComponentPlan"]>;
  createdDraftComponents: Record<string, unknown>[];
}): NonNullable<KotikitGraphState["activeFigmaTransaction"]> | undefined {
  const nextComponent = input.plan.components.find(
    (component) => !hasRealCreatedDraftComponent(input.createdDraftComponents, component.id)
  );
  if (nextComponent === undefined) return undefined;
  const placement = input.state.canvasPlan?.placements.find(
    (candidate) => candidate.draftComponentId === nextComponent.id
  );
  return {
    id: placement?.transactionId ?? `txn-draft-${nextComponent.id}`,
    order: Math.max(1, input.createdDraftComponents.length + 1),
    kind: "create-draft-component",
    label: nextComponent.name,
    placementId: placement?.id ?? `draft-${nextComponent.id}`,
    draftComponentId: nextComponent.id,
    requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
  };
}

function createdDraftComponentsFrom(state: KotikitGraphState): Record<string, unknown>[] {
  return recordArray(recordFrom(state.draftPlan).createdDraftComponents);
}

function hasRealCreatedDraftComponent(
  createdDraftComponents: Record<string, unknown>[],
  draftComponentId: string
): boolean {
  const match = createdDraftComponents.find((item) => item.id === draftComponentId);
  return typeof match?.componentKey === "string" && !match.componentKey.startsWith("draft:");
}

function upsertCreatedDraftComponent(
  current: Record<string, unknown>[],
  next: Record<string, unknown>
): Record<string, unknown>[] {
  const withoutCurrent = current.filter((item) => item.id !== next.id);
  return [...withoutCurrent, next];
}

function realComponentKeyFrom(metadata: Record<string, unknown>): string {
  const componentKey = stringArray(metadata.componentRefs).find((ref) => !ref.startsWith("draft:"));
  if (componentKey === undefined) {
    throw new KotikitError(
      "Draft component creation must return a real Figma component key.",
      "Use Figma component metadata from the created component, not a synthetic draft:* key."
    );
  }
  return componentKey;
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
