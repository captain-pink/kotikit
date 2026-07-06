import type { FigmaFile, FigmaNode } from "../sync/figma-types.js";
import { KotikitError } from "../util/result.js";
import {
  assertDraftPageName,
  buildKotikitSectionName,
  type FigmaDraftTarget,
  FigmaDraftTargetSchema,
  parseFigmaDesignUrl,
} from "./draft-target.js";

interface FigmaDraftTargetClient {
  getNodes(fileKey: string, ids: string[]): Promise<Record<string, FigmaNode>>;
  getFile?(fileKey: string): Promise<FigmaFile>;
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

type ResolvedPage = {
  id: string;
  name: string;
  type?: string;
  children?: unknown[];
};

// Rewrites a copied node URL so the bound target points at the resolved page.
const pageUrlForNode = (nodeUrl: string, nodeId: string): string => {
  const url = new URL(nodeUrl);
  url.searchParams.set("node-id", nodeId.replace(":", "-"));
  return `${url.origin}${url.pathname}?node-id=${url.searchParams.get("node-id")}`;
};

/** Resolves a copied Figma URL into a safe draft page target for graph writes. */
export async function resolveFigmaDraftTargetFromUrl(
  input: ResolveFigmaDraftTargetInput
): Promise<FigmaDraftTarget> {
  const parsed = parseFigmaDesignUrl(input.pageUrl);
  const nodes = await input.client.getNodes(parsed.fileKey, [parsed.nodeId]);
  const document = documentFor(nodes, parsed.nodeId);

  const page =
    document.type === "CANVAS"
      ? {
          id: document.id ?? parsed.nodeId,
          name: document.name ?? "",
          type: document.type,
        }
      : await resolveContainingPage({
          client: input.client,
          fileKey: parsed.fileKey,
          nodeId: parsed.nodeId,
        });

  const pageName = page.name;
  assertDraftPageName(pageName);
  const boundAt = input.now?.() ?? new Date().toISOString();

  return FigmaDraftTargetSchema.parse({
    fileKey: parsed.fileKey,
    pageId: page.id,
    pageName,
    pageUrl: pageUrlForNode(parsed.pageUrl, page.id),
    boundAt,
    source: "user-url",
    section: {
      name: buildKotikitSectionName({
        scope: input.scope,
        screen: input.screen,
        date: dateFromIso(boundAt),
      }),
    },
    ...(document.type === "CANVAS"
      ? {}
      : {
          sourceNode: {
            id: document.id ?? parsed.nodeId,
            ...(document.name === undefined ? {} : { name: document.name }),
            ...(document.type === undefined ? {} : { type: document.type }),
          },
        }),
  });
}

// Resolves a copied frame/node link to the containing page using REST file data.
async function resolveContainingPage(input: {
  client: FigmaDraftTargetClient;
  fileKey: string;
  nodeId: string;
}): Promise<ResolvedPage> {
  if (input.client.getFile === undefined) {
    throw new KotikitError(
      "That Figma link points to a node inside a page, not to the page itself.",
      "Use a Figma token that can read the file so kotikit can resolve the containing draft page."
    );
  }

  const file = await input.client.getFile(input.fileKey);
  const page = findContainingPage(file, input.nodeId);
  if (page === undefined) {
    throw new KotikitError(
      "I couldn't resolve the Figma page containing that node.",
      "Make sure the link points to an existing node in a file your token can read."
    );
  }
  return page;
}

// Finds the first page whose REST tree contains the copied node id.
function findContainingPage(file: FigmaFile, nodeId: string): ResolvedPage | undefined {
  const pages = file.document?.children ?? [];
  return pages
    .map((page) => pageFromTree(page))
    .find((page): page is ResolvedPage => page !== undefined && treeContainsId(page, nodeId));
}

// Converts loosely typed Figma tree objects into the page shape needed here.
function pageFromTree(value: unknown): ResolvedPage | undefined {
  const record = recordFrom(value);
  const id = stringField(record, "id");
  const name = stringField(record, "name");
  if (id === undefined || name === undefined) return undefined;
  return {
    id,
    name,
    ...(stringField(record, "type") === undefined ? {} : { type: stringField(record, "type") }),
    ...(Array.isArray(record.children) ? { children: record.children } : {}),
  };
}

// Recursively checks a page subtree for a node id without relying on page names.
function treeContainsId(value: unknown, nodeId: string): boolean {
  const record = recordFrom(value);
  if (record.id === nodeId) return true;
  return Array.isArray(record.children)
    ? record.children.some((child) => treeContainsId(child, nodeId))
    : false;
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
