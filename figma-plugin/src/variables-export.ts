export type PluginVariableResolvedType = "BOOLEAN" | "FLOAT" | "STRING" | "COLOR";

export interface PluginVariableMode {
  modeId: string;
  name: string;
}

export interface PluginVariableCollectionInput {
  id: string;
  key?: string;
  name: string;
  defaultModeId?: string;
  modes: PluginVariableMode[];
}

export interface PluginVariableInput {
  id: string;
  key?: string;
  name: string;
  description?: string;
  resolvedType: PluginVariableResolvedType;
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
  scopes?: string[];
}

export interface PluginVariablesPayload {
  version: 1;
  source?: {
    fileKey?: string;
    fileName?: string;
  };
  collections: PluginVariableCollectionInput[];
  variables: PluginVariableInput[];
}

export interface BuildPluginVariablesPayloadInput {
  source?: PluginVariablesPayload["source"];
  collections: PluginVariableCollectionInput[];
  variables: PluginVariableInput[];
}

const compactCollection = (collection: PluginVariableCollectionInput): PluginVariableCollectionInput => ({
  id: collection.id,
  name: collection.name,
  modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
  ...(collection.key !== undefined ? { key: collection.key } : {}),
  ...(collection.defaultModeId !== undefined ? { defaultModeId: collection.defaultModeId } : {}),
});

const compactVariable = (variable: PluginVariableInput): PluginVariableInput => ({
  id: variable.id,
  name: variable.name,
  resolvedType: variable.resolvedType,
  variableCollectionId: variable.variableCollectionId,
  valuesByMode: variable.valuesByMode,
  ...(variable.key !== undefined ? { key: variable.key } : {}),
  ...(variable.description !== undefined ? { description: variable.description } : {}),
  ...(variable.scopes !== undefined ? { scopes: variable.scopes } : {}),
});

export function buildPluginVariablesPayload(input: BuildPluginVariablesPayloadInput): PluginVariablesPayload {
  return {
    version: 1,
    ...(input.source !== undefined ? { source: input.source } : {}),
    collections: input.collections.map(compactCollection),
    variables: input.variables.map(compactVariable),
  };
}
