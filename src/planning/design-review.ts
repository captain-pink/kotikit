import { KotikitError } from "../util/result.js";
import type { FigmaNode } from "../sync/figma-types.js";
import type {
  DesignAuditTargetInput,
  DesignAuditTargetKind,
  ReviewTargetCacheInput,
} from "../db/design-review-db.js";

export interface ReviewGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewNodeSummary {
  nodeId: string;
  name: string;
  type: string;
  kind: DesignAuditTargetKind;
  bounds?: ReviewGeometry;
  childCount: number;
  regions: ReviewRegionSummary[];
}

export interface ReviewRegionSummary {
  nodeId: string;
  name: string;
  type: string;
  bounds?: ReviewGeometry;
}

export interface ParsedFigmaReviewUrl {
  fileKey: string;
  nodeId: string;
  figmaUrl: string;
}

export interface DesignReviewEvidenceBundle {
  target: DesignAuditTargetInput;
  evidence: {
    collectedAt: string;
    cache: {
      schemaVersion: number;
      sourceFingerprint: string;
      expiresAt: string;
    };
    tokenBudget: {
      maxRegions: number;
      returnedRegions: number;
      truncatedRegions: number;
    };
    targetSummary: Omit<ReviewNodeSummary, "regions">;
    regions: ReviewRegionSummary[];
    image?: {
      nodeId: string;
      url: string;
      expires: "figma-temporary-url";
    };
    notes: string[];
  };
}

export interface DesignReviewEvidenceClient {
  getNodes(fileKey: string, ids: string[]): Promise<Record<string, FigmaNode>>;
  getImageUrls?(
    fileKey: string,
    ids: string[],
    opts?: { format?: "png" | "jpg" | "svg"; scale?: number }
  ): Promise<Record<string, string>>;
}

export interface DesignReviewEvidenceStore {
  upsertReviewTargetCache(input: ReviewTargetCacheInput): unknown;
}

export interface CollectDesignReviewEvidenceInput {
  client: DesignReviewEvidenceClient;
  target: ParsedFigmaReviewUrl & {
    scope?: string;
    screen?: string;
  };
  store?: DesignReviewEvidenceStore;
  maxRegions?: number;
  now?: string;
  cacheTtlMs?: number;
}

const DEFAULT_MAX_REGIONS = 8;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const REVIEW_CACHE_SCHEMA_VERSION = 1;

const normalizeNodeId = (nodeId: string): string =>
  decodeURIComponent(nodeId).replace("-", ":");

const urlNodeId = (nodeId: string): string =>
  nodeId.replace(":", "-");

const fileKeyFromPath = (segments: string[]): string | null => {
  const designIndex = segments.indexOf("design");
  if (designIndex === -1) return null;
  const fileKey = segments[designIndex + 1];
  const maybeBranchMarker = segments[designIndex + 2];
  const maybeBranchKey = segments[designIndex + 3];
  if (maybeBranchMarker === "branch" && maybeBranchKey !== undefined) return maybeBranchKey;
  return fileKey ?? null;
};

export const parseFigmaReviewUrl = (value: string): ParsedFigmaReviewUrl => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KotikitError(
      "That doesn't look like a Figma design URL.",
      "Copy a link to the exact page, section, frame, or component you want reviewed."
    );
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const fileKey = fileKeyFromPath(segments);
  if (!host.endsWith("figma.com") || fileKey === null) {
    throw new KotikitError(
      "Please send a Figma design URL.",
      "It should look like https://www.figma.com/design/<fileKey>/...?node-id=..."
    );
  }

  const rawNodeId = url.searchParams.get("node-id");
  if (rawNodeId === null || rawNodeId.trim() === "") {
    throw new KotikitError(
      "Please send a Figma URL with node-id.",
      "The review target must be an exact page, section, frame, or component link."
    );
  }

  const nodeId = normalizeNodeId(rawNodeId);
  return {
    fileKey,
    nodeId,
    figmaUrl: `${url.origin}/design/${fileKey}/review?node-id=${urlNodeId(nodeId)}`,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const numberProp = (value: unknown, key: string): number | undefined =>
  isRecord(value) && typeof value[key] === "number" ? value[key] : undefined;

const geometryFrom = (value: unknown): ReviewGeometry | undefined => {
  const x = numberProp(value, "x");
  const y = numberProp(value, "y");
  const width = numberProp(value, "width");
  const height = numberProp(value, "height");
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
};

const childrenFrom = (document: NonNullable<FigmaNode["document"]>): Record<string, unknown>[] => {
  const children = (document as Record<string, unknown>).children;
  return Array.isArray(children) ? children.filter(isRecord) : [];
};

const regionFromChild = (child: Record<string, unknown>): ReviewRegionSummary | null => {
  const id = typeof child.id === "string" ? child.id : undefined;
  if (id === undefined) return null;
  return {
    nodeId: id,
    name: typeof child.name === "string" ? child.name : "",
    type: typeof child.type === "string" ? child.type : "UNKNOWN",
    ...(geometryFrom(child.absoluteBoundingBox) !== undefined
      ? { bounds: geometryFrom(child.absoluteBoundingBox) }
      : {}),
  };
};

const targetKindFor = (type: string): DesignAuditTargetKind => {
  if (type === "CANVAS") return "page";
  if (type === "SECTION") return "section";
  if (type === "COMPONENT" || type === "COMPONENT_SET") return "component";
  if (type === "FRAME") return "frame";
  return "unknown";
};

const summarizeNode = (
  nodeId: string,
  node: FigmaNode,
  maxRegions: number
): ReviewNodeSummary => {
  const document = node.document;
  if (document === undefined) {
    throw new KotikitError(
      "I couldn't read that Figma review target.",
      "Make sure the link points to an existing node in a file your token can read."
    );
  }
  const rawDocument = document as Record<string, unknown>;
  const type = document.type ?? "UNKNOWN";
  const regions = childrenFrom(document)
    .map(regionFromChild)
    .filter((region): region is ReviewRegionSummary => region !== null)
    .slice(0, maxRegions);

  return {
    nodeId: document.id ?? nodeId,
    name: document.name ?? "",
    type,
    kind: targetKindFor(type),
    ...(geometryFrom(rawDocument.absoluteBoundingBox) !== undefined
      ? { bounds: geometryFrom(rawDocument.absoluteBoundingBox) }
      : {}),
    childCount: childrenFrom(document).length,
    regions,
  };
};

const fingerprintSummary = (summary: ReviewNodeSummary): string =>
  JSON.stringify({
    nodeId: summary.nodeId,
    name: summary.name,
    type: summary.type,
    bounds: summary.bounds,
    childCount: summary.childCount,
    regions: summary.regions.map((region) => ({
      nodeId: region.nodeId,
      name: region.name,
      type: region.type,
      bounds: region.bounds,
    })),
  });

const imageForTarget = async (
  input: Pick<CollectDesignReviewEvidenceInput, "client" | "target">
): Promise<DesignReviewEvidenceBundle["evidence"]["image"] | undefined> => {
  if (input.client.getImageUrls === undefined) return undefined;
  try {
    const urls = await input.client.getImageUrls(input.target.fileKey, [input.target.nodeId], {
      format: "png",
      scale: 1,
    });
    const url = urls[input.target.nodeId];
    return url === undefined
      ? undefined
      : { nodeId: input.target.nodeId, url, expires: "figma-temporary-url" };
  } catch {
    return undefined;
  }
};

export const collectDesignReviewEvidence = async (
  input: CollectDesignReviewEvidenceInput
): Promise<DesignReviewEvidenceBundle> => {
  const maxRegions = input.maxRegions ?? DEFAULT_MAX_REGIONS;
  const collectedAt = input.now ?? new Date().toISOString();
  const cacheTtlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const nodes = await input.client.getNodes(input.target.fileKey, [input.target.nodeId]);
  const summary = summarizeNode(input.target.nodeId, nodes[input.target.nodeId] ?? {}, maxRegions);
  const sourceFingerprint = fingerprintSummary(summary);
  const expiresAt = new Date(Date.parse(collectedAt) + cacheTtlMs).toISOString();
  const image = await imageForTarget(input);
  const truncatedRegions = Math.max(0, summary.childCount - summary.regions.length);
  const target = {
    source: "figma" as const,
    fileKey: input.target.fileKey,
    nodeId: summary.nodeId,
    targetKind: summary.kind,
    targetName: summary.name,
    figmaUrl: input.target.figmaUrl,
    ...(input.target.scope !== undefined ? { scope: input.target.scope } : {}),
    ...(input.target.screen !== undefined ? { screen: input.target.screen } : {}),
  };
  const evidence: DesignReviewEvidenceBundle["evidence"] = {
    collectedAt,
    cache: {
      schemaVersion: REVIEW_CACHE_SCHEMA_VERSION,
      sourceFingerprint,
      expiresAt,
    },
    tokenBudget: {
      maxRegions,
      returnedRegions: summary.regions.length,
      truncatedRegions,
    },
    targetSummary: {
      nodeId: summary.nodeId,
      name: summary.name,
      type: summary.type,
      kind: summary.kind,
      ...(summary.bounds !== undefined ? { bounds: summary.bounds } : {}),
      childCount: summary.childCount,
    },
    regions: summary.regions,
    ...(image !== undefined ? { image } : {}),
    notes: [
      "Evidence is shallow by default: screenshot URL plus depth-1 region summaries.",
      ...(truncatedRegions > 0
        ? [`${truncatedRegions} child region(s) were omitted to keep review context bounded.`]
        : []),
    ],
  };

  input.store?.upsertReviewTargetCache({
    fileKey: input.target.fileKey,
    nodeId: input.target.nodeId,
    depth: 1,
    sourceFingerprint,
    summary: evidence,
    createdAt: collectedAt,
    expiresAt,
  });

  return { target, evidence };
};
