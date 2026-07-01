import { createArtifactStore } from "../../core/runs/artifact-store.js";
import type { Artifact } from "../../core/schemas/artifact.js";

export type ReviewArtifactMatchInput = {
  sessionId?: string;
  fileKey?: string;
  nodeId?: string;
  scope?: string;
  screen?: string;
};

export type GraphReviewArtifactDetail = {
  graphFacade: {
    preferredTool: "kotikit_get_artifact";
    artifactId: string;
    runId: string;
  };
  artifact: Artifact;
};

const GRAPH_REVIEW_ARTIFACT_TYPES = new Set(["review-session", "revision-plan"]);

export async function findMatchingGraphReviewArtifact(
  root: string,
  input: ReviewArtifactMatchInput
): Promise<Artifact | null> {
  const artifacts = await createArtifactStore(root).listArtifacts();
  return (
    artifacts
      .filter((artifact) => GRAPH_REVIEW_ARTIFACT_TYPES.has(artifact.type))
      .filter((artifact) => artifactMatches(artifact, input))
      .at(-1) ?? null
  );
}

export function graphReviewArtifactDetail(artifact: Artifact): GraphReviewArtifactDetail {
  return {
    graphFacade: {
      preferredTool: "kotikit_get_artifact",
      artifactId: artifact.id,
      runId: artifact.runId,
    },
    artifact,
  };
}

function artifactMatches(artifact: Artifact, input: ReviewArtifactMatchInput): boolean {
  const data = artifactData(artifact);
  if (data === null) return false;
  return (
    matchesField(data, "sessionId", input.sessionId) &&
    matchesField(data, "fileKey", input.fileKey) &&
    matchesField(data, "nodeId", input.nodeId) &&
    matchesField(data, "scope", input.scope) &&
    matchesField(data, "screen", input.screen)
  );
}

function matchesField(
  data: Record<string, unknown>,
  key: keyof ReviewArtifactMatchInput,
  expected: string | undefined
): boolean {
  if (expected === undefined) return true;
  return data[key] === expected || recordFrom(data.target)[key] === expected;
}

function artifactData(artifact: Artifact): Record<string, unknown> | null {
  const payload = artifact.payload;
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return null;
  return recordFrom(payload.data);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
