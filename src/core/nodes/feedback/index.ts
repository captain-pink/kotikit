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
  source: "figma-comment" | "figma-comment-thread" | "chat-feedback";
  sourceId?: string;
  targetNodeId?: string;
  targetName?: string;
  stateId?: string;
  recommendation: string;
  needsHumanDecision: boolean;
};

type FeedbackHandoff =
  | {
      status: "approved-for-agent-apply";
      revisionPlanArtifactId?: string;
      changeIds: string[];
    }
  | { status: "skipped" };

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
      const snapshot = commentSnapshotFrom(feedback);
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
            ...recordArray(recordFrom(snapshot.nodeMap).nodes),
            ...recordArray(recordFrom(state.figmaNodeLedger).nodes),
            ...recordArray(recordFrom(state.applyReport).nodes),
            ...recordArray(recordFrom(feedback).nodes),
          ],
        },
        mappedAt: nowIso(),
        includeResolved:
          booleanField(feedback, "includeResolved") ?? booleanField(snapshot, "includeResolved"),
      });

      return {
        statePatch: {
          commentEvidenceMap,
          feedback: {
            ...feedback,
            commentSnapshot: snapshot,
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
      const commentChanges = changesFromCommentThreads(state);
      const changes = [
        ...(commentChanges.length > 0 ? commentChanges : changesFromComments(state)),
        ...changesFromChatFeedback(state.userIntent),
      ];
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
              "Approve this revision plan for the assistant to apply through Figma one change at a time?",
            choices: ["apply-feedback-changes", "skip-feedback-changes"],
          }),
        } satisfies RuntimeNodeOutput;
      }
      const handoff = feedbackHandoffFrom(answer, feedback, changes);
      return {
        statePatch: {
          feedback: {
            ...feedback,
            approval: answer,
            ...(handoff === undefined ? {} : { handoff }),
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
];

// Accepts both direct snapshot input and the persisted feedback wrapper.
function commentSnapshotFrom(feedback: Record<string, unknown>): Record<string, unknown> {
  const wrapped = recordFrom(feedback.commentSnapshot);
  if (Object.keys(wrapped).length > 0) return wrapped;
  return stringField(feedback, "schemaVersion") === "FigmaCommentSnapshot/v1" ? feedback : {};
}

// Turns the designer's explicit choice into the next assistant action.
function feedbackHandoffFrom(
  answer: string,
  feedback: Record<string, unknown>,
  changes: Record<string, unknown>[]
): FeedbackHandoff | undefined {
  if (answer === "skip-feedback-changes") return { status: "skipped" };
  if (answer !== "apply-feedback-changes") return undefined;
  const revisionPlanArtifactId = stringField(feedback, "revisionPlanArtifactId");
  return {
    status: "approved-for-agent-apply",
    ...(revisionPlanArtifactId === undefined ? {} : { revisionPlanArtifactId }),
    changeIds: changes.flatMap((change) => {
      const changeId = stringField(change, "id");
      return changeId === undefined ? [] : [changeId];
    }),
  };
}

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

// Prefers Figma thread structure so replies refine one change instead of
// becoming separate tasks.
function changesFromCommentThreads(state: KotikitGraphState): FeedbackChange[] {
  const snapshot = recordFrom(recordFrom(state.feedback).commentSnapshot);
  const threads = recordArray(snapshot.threads);
  if (threads.length === 0) return [];

  const commentsById = new Map(
    state.commentEvidenceMap?.comments.map((comment) => [comment.commentId, comment]) ?? []
  );

  return threads.map((thread) => {
    const messages = recordArray(thread.messages);
    const threadId =
      stringField(thread, "threadId") ?? stringField(thread, "rootCommentId") ?? "unknown-thread";
    const mappedComment =
      messages
        .map((message) => commentsById.get(stringField(message, "commentId") ?? ""))
        .find((comment) => comment?.mappedTarget !== undefined) ??
      state.commentEvidenceMap?.comments.find(
        (comment) => comment.rootCommentId === threadId && comment.mappedTarget !== undefined
      );
    const target = mappedComment?.mappedTarget;
    const targetNodeId = target?.partId ?? target?.nodeId;
    return {
      id: `thread-${threadId}`,
      source: "figma-comment-thread",
      sourceId: threadId,
      ...(targetNodeId === undefined ? {} : { targetNodeId }),
      ...(target?.nodeName === undefined ? {} : { targetName: target.nodeName }),
      ...(target?.stateId === undefined ? {} : { stateId: target.stateId }),
      recommendation: recommendationFromMessages(messages),
      needsHumanDecision:
        targetNodeId === undefined || stringField(thread, "status") === "needs-human",
    };
  });
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

// Preserves the ordered conversation as plain feedback text for the agent.
function recommendationFromMessages(messages: Record<string, unknown>[]): string {
  return messages
    .map((message) => {
      const text = stringField(message, "message") ?? "";
      const author = stringField(message, "author");
      return author === undefined ? text : `${author}: ${text}`;
    })
    .filter((message) => message.trim() !== "")
    .join("\n");
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
