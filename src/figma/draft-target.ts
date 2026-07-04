import { z } from "zod";
import { KotikitError } from "../util/result.js";

const FigmaDraftSectionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
});

const FigmaDraftSourceNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
});

const FigmaDraftTargetSafetySchema = z
  .object({
    requireDraftPageName: z.literal(true).default(true),
    allowPageCreation: z.literal(false).default(false),
    requireKotikitSection: z.literal(true).default(true),
  })
  .default({
    requireDraftPageName: true,
    allowPageCreation: false,
    requireKotikitSection: true,
  });

export const FigmaDraftTargetSchema = z.object({
  fileKey: z.string().min(1),
  pageId: z.string().min(1),
  pageName: z.string().min(1),
  pageUrl: z.string().url(),
  boundAt: z.string(),
  source: z.enum(["user-url", "plugin-current-page"]),
  section: FigmaDraftSectionSchema.optional(),
  sourceNode: FigmaDraftSourceNodeSchema.optional(),
  safety: FigmaDraftTargetSafetySchema,
});
export type FigmaDraftTarget = z.infer<typeof FigmaDraftTargetSchema>;

export interface ParsedFigmaDesignUrl {
  fileKey: string;
  nodeId: string;
  pageUrl: string;
}

const normalizeNodeId = (nodeId: string): string => decodeURIComponent(nodeId).replace("-", ":");

const urlNodeId = (nodeId: string): string => nodeId.replace(":", "-");

const fileKeyFromPath = (segments: string[]): string | null => {
  const designIndex = segments.indexOf("design");
  if (designIndex === -1) return null;
  const fileKey = segments[designIndex + 1];
  const maybeBranchMarker = segments[designIndex + 2];
  const maybeBranchKey = segments[designIndex + 3];
  if (maybeBranchMarker === "branch" && maybeBranchKey !== undefined) return maybeBranchKey;
  return fileKey ?? null;
};

export const parseFigmaDesignUrl = (value: string): ParsedFigmaDesignUrl => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KotikitError(
      "That doesn't look like a Figma design URL.",
      "Copy the link to the exact Figma draft page and try again."
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
      "Please send a Figma draft page URL, not only a file URL.",
      "The link must include node-id so kotikit can bind to one exact draft page."
    );
  }

  const nodeId = normalizeNodeId(rawNodeId);
  const pageUrl = `${url.origin}${url.pathname}?node-id=${urlNodeId(nodeId)}`;
  return { fileKey, nodeId, pageUrl };
};

export const isDraftPageName = (name: string): boolean => /\bdrafts?\b/i.test(name);

export const assertDraftPageName = (name: string): void => {
  if (isDraftPageName(name)) return;
  throw new KotikitError(
    `I can only write to Figma pages whose name contains "Draft" or "Drafts".`,
    `Rename the target page to something like "Draft - ${name}" or use a separate Kotikit Drafts file.`
  );
};

export const buildKotikitSectionName = (input: {
  scope: string;
  screen: string | null;
  date: string;
}): string =>
  ["kotikit", input.scope, ...(input.screen !== null ? [input.screen] : []), input.date].join(
    " / "
  );
