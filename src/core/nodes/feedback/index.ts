import { type JSONType, z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildCommentEvidenceMap } from "../../domain/comment-evidence-map.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: ReturnType<typeof createUserInterrupt>;
  artifacts?: Artifact[];
};

type FeedbackChange = {
  id: string;
  source: "figma-comment" | "chat-feedback";
  sourceId?: string;
  targetNodeId?: string;
  targetName?: string;
  stateId?: string;
  recommendation: string;
  needsHumanDecision: boolean;
};

const EmptyParamsSchema = z.strictObject({});

export const feedbackNodeDefinitions: NodeDefinition[] = [
  node({
    key: "feedback.buildEvidenceMap",
    stateReads: ["feedback", "figmaNodeLedger", "applyReport"],
    stateWrites: ["commentEvidenceMap", "feedback"],
    requiredCapabilities: ["comments.read"],
    run: async (input) => {
      const state = graphState(input.state);
      const feedback = recordFrom(state.feedback);
      const snapshot = recordFrom(feedback.commentSnapshot);
      const fileKey =
        stringField(snapshot, "fileKey") ??
        stringField(recordFrom(state.figmaNodeLedger), "fileKey") ??
        stringField(recordFrom(state.applyReport), "fileKey");
      if (fileKey === undefined) {
        throw new KotikitError(
          "Kotikit could not find a Figma file key for feedback review.",
          "Start review-screen with a Figma comment snapshot, or run kotikit_feedback_snapshot first."
        );
      }

      const commentEvidenceMap = buildCommentEvidenceMap({
        fileKey,
        comments: recordArray(snapshot.comments),
        nodeMap: {
          fileKey,
          nodes: [
            ...recordArray(recordFrom(state.figmaNodeLedger).nodes),
            ...recordArray(recordFrom(state.applyReport).nodes),
            ...recordArray(recordFrom(feedback).nodes),
          ],
        },
        mappedAt: nowIso(),
        includeResolved: booleanField(feedback, "includeResolved"),
      });

      return {
        statePatch: {
          commentEvidenceMap,
          feedback: {
            ...feedback,
            commentEvidenceMap,
          },
        },
        artifacts: [commentEvidenceArtifact(state, commentEvidenceMap)],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "feedback.createRevisionPlan",
    stateReads: ["feedback", "commentEvidenceMap", "userIntent"],
    stateWrites: ["feedback"],
    requiredCapabilities: ["feedback.plan"],
    run: async (input) => {
      const state = graphState(input.state);
      const feedback = recordFrom(state.feedback);
      const changes = [...changesFromComments(state), ...changesFromChatFeedback(state.userIntent)];
      const plan = {
        schemaVersion: "RevisionPlan/v1" as const,
        summary:
          changes.length === 0
            ? "No actionable feedback was found."
            : `${changes.length} feedback change(s) prepared.`,
        data: {
          mode: "lightweight-post-screen-feedback",
          changes: toJson(changes),
          requiresApproval: changes.length > 0,
          unresolvedCount: changes.filter((change) => change.needsHumanDecision).length,
        },
      };
      const artifact: Artifact = {
        id: `${state.runId}-revision-plan`,
        runId: state.runId,
        type: "revision-plan",
        schemaVersion: ArtifactSchemaVersionByType["revision-plan"],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        sourceNode: { key: "feedback.createRevisionPlan", version: "1.0.0" },
        payload: plan,
      };
      return {
        statePatch: {
          feedback: {
            ...feedback,
            revisionPlan: plan,
            revisionPlanArtifactId: artifact.id,
          },
        },
        artifacts: [artifact],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "feedback.askRevisionApproval",
    kind: "interrupt",
    stateReads: ["feedback", "answers"],
    stateWrites: ["feedback"],
    requiredCapabilities: ["feedback.plan"],
    run: async (input) => {
      const state = graphState(input.state);
      const feedback = recordFrom(state.feedback);
      const plan = recordFrom(feedback.revisionPlan);
      const changes = recordArray(recordFrom(plan.data).changes);
      if (changes.length === 0) {
        return {
          statePatch: {
            feedback: {
              ...feedback,
              approval: "no-actionable-feedback",
            },
          },
        } satisfies RuntimeNodeOutput;
      }
      const answer = state.answers?.["approve-feedback-revisions"];
      if (answer === undefined) {
        return {
          interrupt: createUserInterrupt({
            id: "approve-feedback-revisions",
            prompt:
              "Apply the prepared feedback changes to the Figma draft one region/comment at a time?",
            choices: ["apply-feedback-changes", "skip-feedback-changes"],
          }),
        } satisfies RuntimeNodeOutput;
      }
      return {
        statePatch: {
          feedback: {
            ...feedback,
            approval: answer,
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function commentEvidenceArtifact(state: KotikitGraphState, payload: Artifact["payload"]): Artifact {
  const now = nowIso();
  return {
    id: `${state.runId}-comment-evidence-map`,
    runId: state.runId,
    type: "comment-evidence-map",
    schemaVersion: ArtifactSchemaVersionByType["comment-evidence-map"],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: "feedback.buildEvidenceMap", version: "1.0.0" },
    payload,
  };
}

function changesFromComments(state: KotikitGraphState): FeedbackChange[] {
  return (
    state.commentEvidenceMap?.comments.map((comment) => {
      const target = comment.mappedTarget;
      const targetNodeId = target?.partId ?? target?.nodeId;
      return {
        id: `comment-${comment.commentId}`,
        source: "figma-comment",
        sourceId: comment.commentId,
        ...(targetNodeId === undefined ? {} : { targetNodeId }),
        ...(target?.nodeName === undefined ? {} : { targetName: target.nodeName }),
        ...(target?.stateId === undefined ? {} : { stateId: target.stateId }),
        recommendation: comment.message,
        needsHumanDecision: targetNodeId === undefined || comment.status === "needs-human",
      };
    }) ?? []
  );
}

function changesFromChatFeedback(userIntent: string | undefined): FeedbackChange[] {
  if (userIntent === undefined || userIntent.trim() === "") return [];
  return [
    {
      id: "chat-feedback",
      source: "chat-feedback",
      recommendation: userIntent,
      needsHumanDecision: true,
    },
  ];
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

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

function toJson(value: unknown): JSONType {
  return JSON.parse(JSON.stringify(value));
}
