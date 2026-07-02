import { readFile } from "node:fs/promises";
import { z } from "zod";
import { variablesJsonPath } from "../util/paths.js";
import type { FigmaLocalVariables } from "./figma-types.js";
import {
  mergeVariables,
  type VariablesJson,
  VariablesJsonSchema,
  writeVariablesJson,
} from "./variables.js";

const PluginVariableModeSchema = z.object({
  modeId: z.string(),
  name: z.string(),
});

const PluginVariableCollectionSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  name: z.string(),
  defaultModeId: z.string().optional(),
  modes: z.array(PluginVariableModeSchema).default([]),
});

const PluginVariableSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  resolvedType: z.enum(["BOOLEAN", "FLOAT", "STRING", "COLOR"]),
  variableCollectionId: z.string(),
  valuesByMode: z.record(z.string(), z.unknown()).default({}),
  scopes: z.array(z.string()).optional(),
});

export const PluginVariablesPayloadSchema = z.object({
  version: z.literal(1),
  source: z
    .object({
      fileKey: z.string().optional(),
      fileName: z.string().optional(),
    })
    .optional(),
  collections: z.array(PluginVariableCollectionSchema).default([]),
  variables: z.array(PluginVariableSchema).default([]),
});
type PluginVariablesPayload = z.infer<typeof PluginVariablesPayloadSchema>;

export interface PluginVariablesImportResult {
  imported: number;
  totalEntries: number;
  collisions: number;
  variablesPath: string;
  source?: PluginVariablesPayload["source"];
}

const toFigmaLocalVariables = (payload: PluginVariablesPayload): FigmaLocalVariables => ({
  variableCollections: Object.fromEntries(
    payload.collections.map((collection) => [
      collection.id,
      {
        id: collection.id,
        name: collection.name,
        modes: collection.modes,
        ...(collection.defaultModeId !== undefined
          ? { defaultModeId: collection.defaultModeId }
          : {}),
        ...(collection.key !== undefined ? { key: collection.key } : {}),
      },
    ])
  ),
  variables: Object.fromEntries(
    payload.variables.map((variable) => [
      variable.id,
      {
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        valuesByMode: variable.valuesByMode,
        variableCollectionId: variable.variableCollectionId,
        ...(variable.description !== undefined ? { description: variable.description } : {}),
        ...(variable.key !== undefined ? { key: variable.key } : {}),
        ...(variable.scopes !== undefined ? { scopes: variable.scopes } : {}),
      },
    ])
  ),
});

const readExistingVariablesJson = async (root: string): Promise<VariablesJson | null> => {
  try {
    const text = await readFile(variablesJsonPath(root), "utf-8");
    return VariablesJsonSchema.parse(JSON.parse(text));
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
};

const mergeVariableFiles = (
  existing: VariablesJson | null,
  incoming: VariablesJson
): VariablesJson => {
  if (existing === null) return incoming;

  const incomingNames = new Set(incoming.entries.map((entry) => entry.name));
  const preservedExistingEntries = existing.entries.filter(
    (entry) => !incomingNames.has(entry.name)
  );
  const newCollisions = existing.entries
    .filter((entry) => incomingNames.has(entry.name) && entry.source === "style")
    .map((entry) => ({ name: entry.name, keptSource: "variable" as const }));
  const collisionByName = new Map(
    [...existing.collisions, ...incoming.collisions, ...newCollisions].map((collision) => [
      collision.name,
      collision,
    ])
  );

  return VariablesJsonSchema.parse({
    version: 1,
    entries: [...incoming.entries, ...preservedExistingEntries],
    collisions: [...collisionByName.values()],
  });
};

export async function importPluginVariables(
  root: string,
  payload: unknown
): Promise<PluginVariablesImportResult> {
  const parsed = PluginVariablesPayloadSchema.parse(payload);
  const incoming = mergeVariables({
    variables: toFigmaLocalVariables(parsed),
    styles: [],
    styleDetailsByNodeId: {},
  });
  const existing = await readExistingVariablesJson(root);
  const merged = mergeVariableFiles(existing, incoming);

  await writeVariablesJson(root, merged);

  return {
    imported: incoming.entries.length,
    totalEntries: merged.entries.length,
    collisions: merged.collisions.length,
    variablesPath: variablesJsonPath(root),
    ...(parsed.source !== undefined ? { source: parsed.source } : {}),
  };
}
