import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildCommentEvidenceMap } from "../../domain/comment-evidence-map.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
};

const EmptyParamsSchema = z.strictObject({});

export const commentNodeDefinitions: NodeDefinition[] = [
  node({
    key: "comments.buildEvidenceMap",
    stateReads: ["review", "applyReport"],
    stateWrites: ["commentEvidenceMap", "review"],
    requiredCapabilities: ["comments.read"],
    run: async (input) => {
      const state = graphState(input.state);
      const review = recordFrom(state.review);
      const snapshot = recordFrom(review.commentSnapshot);
      const comments = recordArray(snapshot.comments).map(normalizeComment);
      const applyReport = recordFrom(state.applyReport);
      const fileKey = stringField(snapshot, "fileKey") ?? stringField(applyReport, "fileKey");
      if (fileKey === undefined) {
        throw new KotikitError(
          "Kotikit could not find a Figma file key for comment review.",
          "Start the comment review from a Figma file URL or provide a seeded comment snapshot."
        );
      }
      const commentEvidenceMap = buildCommentEvidenceMap({
        fileKey,
        comments,
        nodeMap: {
          fileKey,
          nodes: [
            ...nodeTargetsFromNodeMap(recordFrom(snapshot.nodeMap)),
            ...nodeTargetsFromNodeMap(recordFrom(review.nodeMap)),
            ...nodeTargetsFromNodeMap(applyReport),
          ],
        },
        mappedAt: nowIso(),
      });
      return {
        statePatch: {
          commentEvidenceMap,
          review: { ...review, commentEvidenceMap },
        },
        artifacts: [commentEvidenceArtifact(state, commentEvidenceMap)],
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
    sourceNode: { key: "comments.buildEvidenceMap", version: "1.0.0" },
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

function normalizeComment(comment: Record<string, unknown>): Record<string, unknown> {
  const nodeId = stringField(comment, "nodeId");
  if (nodeId === undefined || comment.client_meta !== undefined) return comment;
  return {
    ...comment,
    client_meta: { node_id: nodeId },
  };
}

function nodeTargetsFromNodeMap(nodeMap: Record<string, unknown>): Record<string, unknown>[] {
  return recordArray(nodeMap.nodes).flatMap((node) => {
    const nodeId = stringField(node, "nodeId") ?? stringField(node, "id");
    if (nodeId === undefined) return [];
    const partId = stringField(node, "partId");
    const base = {
      nodeId,
      nodeName:
        stringField(node, "nodeName") ??
        stringField(node, "name") ??
        stringField(node, "componentName"),
      partId,
      stateId: stringField(node, "stateId"),
      componentKey: stringField(node, "componentKey"),
      draftComponentId: stringField(node, "draftComponentId"),
    };
    return partId !== undefined && partId !== nodeId ? [base, { ...base, nodeId: partId }] : [base];
  });
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
  return typeof record[key] === "string" ? record[key] : undefined;
}
