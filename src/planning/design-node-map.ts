import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { z } from "zod";
import { designNodeMapPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";
import { DesignPlanStepKindSchema } from "./design-plan-schema.js";

export const DesignNodeKindSchema = z.enum(["page", "frame", "instance", "node"]);
export type DesignNodeKind = z.infer<typeof DesignNodeKindSchema>;

export const DesignNodeMapEntrySchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  stepKind: DesignPlanStepKindSchema,
  outcome: z.enum(["ok", "warned", "failed"]),
  state: z.string().optional(),
  componentName: z.string().optional(),
  dsKey: z.string().optional(),
  nodeId: z.string(),
  nodeKind: DesignNodeKindSchema,
  nodeName: z.string().optional(),
});
export type DesignNodeMapEntry = z.infer<typeof DesignNodeMapEntrySchema>;

export const DesignNodeMapSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),
  figmaFileKey: z.string().optional(),
  page: z.object({
    id: z.string(),
    name: z.string(),
  }).optional(),
  nodes: z.array(DesignNodeMapEntrySchema),
  updatedAt: z.string(),
});
export type DesignNodeMap = z.infer<typeof DesignNodeMapSchema>;

export interface DesignNodeMapUpdate {
  scope: string;
  screen?: string;
  updatedAt: string;
  figmaFileKey?: string;
  page?: {
    id: string;
    name: string;
  };
  entry: DesignNodeMapEntry;
}

export interface DesignNodeMapUpsert {
  updatedAt: string;
  figmaFileKey?: string;
  page?: {
    id: string;
    name: string;
  };
  entry: DesignNodeMapEntry;
}

const parseDesignNodeMap = (raw: unknown): DesignNodeMap => {
  const result = DesignNodeMapSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join(".") || "root")
      .join(", ");
    throw new KotikitError(
      "The design node map has an invalid format.",
      `Problem with: ${fields}. Regenerate the Figma design apply map and try again.`
    );
  }
  return result.data;
};

export const mergeDesignNodeMap = (
  existing: DesignNodeMap | null,
  update: DesignNodeMapUpdate
): DesignNodeMap => {
  const previousNodes = existing?.nodes ?? [];
  const nodes = [
    ...previousNodes.filter((node) => node.stepIndex !== update.entry.stepIndex),
    update.entry,
  ].sort((a, b) => a.stepIndex - b.stepIndex);

  return {
    version: 1,
    scope: update.scope,
    ...(update.screen !== undefined ? { screen: update.screen } : {}),
    ...(update.figmaFileKey ?? existing?.figmaFileKey
      ? { figmaFileKey: update.figmaFileKey ?? existing?.figmaFileKey }
      : {}),
    ...(update.page ?? existing?.page ? { page: update.page ?? existing?.page } : {}),
    nodes,
    updatedAt: update.updatedAt,
  };
};

export const readDesignNodeMap = async (
  root: string,
  scope: string,
  screen: string | null
): Promise<DesignNodeMap | null> => {
  const path = designNodeMapPath(root, scope, screen);
  if (!existsSync(path)) return null;

  try {
    return parseDesignNodeMap(JSON.parse(await readFile(path, "utf-8")));
  } catch (err) {
    if (err instanceof KotikitError) throw err;
    throw new KotikitError(
      "The design node map file could not be read.",
      "It may have been edited manually and become malformed. Regenerate the Figma design apply map and try again."
    );
  }
};

export const writeDesignNodeMap = async (
  root: string,
  scope: string,
  screen: string | null,
  map: DesignNodeMap
): Promise<string> => {
  const path = designNodeMapPath(root, scope, screen);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2) + "\n", "utf-8");
  return path;
};

export const upsertDesignNodeMapEntry = async (
  root: string,
  scope: string,
  screen: string | null,
  update: DesignNodeMapUpsert
): Promise<DesignNodeMap> => {
  const existing = await readDesignNodeMap(root, scope, screen);
  const map = mergeDesignNodeMap(existing, {
    scope,
    ...(screen !== null ? { screen } : {}),
    ...update,
  });
  await writeDesignNodeMap(root, scope, screen, map);
  return map;
};
