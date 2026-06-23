import type { FigmaNode } from "../sync/figma-types.js";
import { KotikitError } from "../util/result.js";
import {
  assertDraftPageName,
  buildKotikitSectionName,
  type FigmaDraftTarget,
  FigmaDraftTargetSchema,
  parseFigmaDesignUrl,
} from "./draft-target.js";

export interface FigmaDraftTargetClient {
  getNodes(fileKey: string, ids: string[]): Promise<Record<string, FigmaNode>>;
}

export interface ResolveFigmaDraftTargetInput {
  client: FigmaDraftTargetClient;
  pageUrl: string;
  scope: string;
  screen: string | null;
  now?: () => string;
}

const documentFor = (
  nodes: Record<string, FigmaNode>,
  nodeId: string
): NonNullable<FigmaNode["document"]> => {
  const document = nodes[nodeId]?.document;
  if (document === undefined) {
    throw new KotikitError(
      "I couldn't resolve that Figma page.",
      "Make sure the link points to an existing page in a file your token can read."
    );
  }
  return document;
};

const dateFromIso = (iso: string): string => iso.slice(0, 10);

export async function resolveFigmaDraftTargetFromUrl(
  input: ResolveFigmaDraftTargetInput
): Promise<FigmaDraftTarget> {
  const parsed = parseFigmaDesignUrl(input.pageUrl);
  const nodes = await input.client.getNodes(parsed.fileKey, [parsed.nodeId]);
  const document = documentFor(nodes, parsed.nodeId);

  if (document.type !== "CANVAS") {
    throw new KotikitError(
      "That Figma link points to a node inside a page, not to the page itself.",
      "Copy the link to the exact draft page, or use the kotikit plugin current-page binding flow."
    );
  }

  const pageName = document.name ?? "";
  assertDraftPageName(pageName);
  const boundAt = input.now?.() ?? new Date().toISOString();

  return FigmaDraftTargetSchema.parse({
    fileKey: parsed.fileKey,
    pageId: document.id ?? parsed.nodeId,
    pageName,
    pageUrl: parsed.pageUrl,
    boundAt,
    source: "user-url",
    section: {
      name: buildKotikitSectionName({
        scope: input.scope,
        screen: input.screen,
        date: dateFromIso(boundAt),
      }),
    },
  });
}
