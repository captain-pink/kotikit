import { type JSONType, z } from "zod";
import { type DesignAdjustmentCategory, openDesignReviewDb } from "../../../db/design-review-db.js";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
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

export const memoryNodeDefinitions: NodeDefinition[] = [
  node({
    key: "memory.detectPreferenceCandidate",
    stateReads: ["review"],
    stateWrites: ["review"],
    sideEffects: "sqlite",
    requiredCapabilities: ["memory.write"],
    run: async (input) => detectPreferenceCandidate(graphState(input.state)),
  }),
  node({
    key: "memory.askPromotionApproval",
    kind: "interrupt",
    stateReads: ["review", "answers"],
    stateWrites: ["review", "pendingQuestion"],
    requiredCapabilities: ["memory.write"],
    run: async (input) => askPromotionApproval(graphState(input.state)),
  }),
  node({
    key: "memory.promotePreference",
    stateReads: ["review", "answers"],
    stateWrites: ["review"],
    sideEffects: "sqlite",
    requiredCapabilities: ["memory.write"],
    run: async (input) => promotePreference(graphState(input.state)),
  }),
];

function detectPreferenceCandidate(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const revisions = recordArray(recordFrom(review.revisionPlan).revisions);
  if (revisions.length === 0) {
    return { statePatch: { review: { ...review, memoryCandidate: null } } };
  }

  const target = recordFrom(recordFrom(review.revisionPlan).target);
  const store = openDesignReviewDb(state.project.root);
  const currentCandidateKeys = revisions
    .map(
      (revision) =>
        store.recordDesignAdjustment({
          sessionId: stringField(recordFrom(review.revisionPlan), "sessionId"),
          scope: stringField(target, "scope"),
          screen: stringField(target, "screen"),
          fileKey: stringField(target, "fileKey"),
          nodeId: stringField(revision, "nodeId"),
          category: adjustmentCategory(stringField(revision, "theme")),
          summary:
            stringField(revision, "recommendation") ??
            `Prefer ${String(revision.partName ?? revision.nodeId ?? "this design adjustment")}.`,
        }).preferenceKey
    )
    .filter((key): key is string => key !== null);

  const candidate = store
    .listPreferenceCandidates({ status: "candidate", limit: 100 })
    .find((item) => currentCandidateKeys.includes(item.key));
  if (candidate === undefined) {
    return { statePatch: { review: { ...review, memoryCandidate: null } } };
  }

  const now = nowIso();
  const artifact: Artifact = {
    id: `${state.runId}-design-memory-candidate`,
    runId: state.runId,
    type: "design-memory-candidate",
    schemaVersion: ArtifactSchemaVersionByType["design-memory-candidate"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "memory.detectPreferenceCandidate", version: "1.0.0" },
    payload: {
      schemaVersion: ArtifactSchemaVersionByType["design-memory-candidate"],
      summary: candidate.rule,
      data: toJson(candidate) as Record<string, JSONType>,
    },
  };

  return {
    statePatch: {
      review: {
        ...review,
        memoryCandidate: {
          key: candidate.key,
          category: candidate.category,
          rule: candidate.rule,
          summary: candidate.summary,
          confidence: candidate.confidence,
          status: candidate.status,
          scope: stringField(target, "scope"),
        },
      },
    },
    artifacts: [artifact],
  };
}

function askPromotionApproval(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const candidate = recordFrom(review.memoryCandidate);
  if (Object.keys(candidate).length === 0) {
    return { statePatch: { review } };
  }
  const approvals = {
    ...recordFrom(review.approvals),
    ...(state.answers?.["approve-memory-promotion"] !== undefined
      ? { memory: state.answers["approve-memory-promotion"] }
      : {}),
  };
  if (approvals.memory !== undefined) {
    return { statePatch: { review: { ...review, approvals } } };
  }

  const pendingQuestion = {
    id: "approve-memory-promotion",
    prompt: `Promote "${String(candidate.rule ?? candidate.key)}" into kotikit design memory?`,
    choices: ["promote-memory", "skip-memory"],
  };
  return {
    statePatch: { review: { ...review, approvals } },
    interrupt: createUserInterrupt(pendingQuestion),
  };
}

function promotePreference(state: KotikitGraphState): RuntimeNodeOutput {
  const review = recordFrom(state.review);
  const candidate = recordFrom(review.memoryCandidate);
  if (Object.keys(candidate).length === 0) {
    return { statePatch: { review } };
  }
  if (state.answers?.["approve-memory-promotion"] !== "promote-memory") {
    return {
      statePatch: {
        review: {
          ...review,
          promotedMemory: null,
        },
      },
    };
  }

  const key = stringField(candidate, "key");
  if (key === undefined) {
    throw new KotikitError(
      "The design memory candidate is missing a key.",
      "Detect a preference candidate before promoting it."
    );
  }
  const preference = openDesignReviewDb(state.project.root).promotePreferenceCandidate({
    key,
    scope: stringField(candidate, "scope"),
    rule: stringField(candidate, "rule"),
  });

  return {
    statePatch: {
      review: {
        ...review,
        promotedMemory: preference,
      },
    },
  };
}

function adjustmentCategory(value: string | undefined): DesignAdjustmentCategory {
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
  ]);
  return allowed.has(value ?? "") ? (value as DesignAdjustmentCategory) : "other";
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

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function toJson(value: unknown): JSONType {
  return JSON.parse(JSON.stringify(value));
}
