// kotikit Figma plugin — sandbox entry
// This file runs in Figma's plugin main thread.
// UI runs in figma.showUI(__html__) iframe.

import {
  buildPluginVariablesPayload,
  type PluginVariableCollectionInput,
  type PluginVariableInput,
} from "./src/variables-export.js";

interface FigmaVariableCollectionLike {
  id: string;
  key?: string;
  name: string;
  defaultModeId?: string;
  modes: Array<{ modeId: string; name: string }>;
}

interface FigmaVariableLike {
  id: string;
  key?: string;
  name: string;
  description?: string;
  resolvedType: PluginVariableInput["resolvedType"];
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
  scopes?: string[];
}

figma.showUI(__html__, { width: 400, height: 600, title: "kotikit" });

const compactCollection = (
  collection: FigmaVariableCollectionLike
): PluginVariableCollectionInput => ({
  id: collection.id,
  name: collection.name,
  modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
  ...(collection.key !== undefined ? { key: collection.key } : {}),
  ...(collection.defaultModeId !== undefined ? { defaultModeId: collection.defaultModeId } : {}),
});

const compactVariable = (variable: FigmaVariableLike): PluginVariableInput => ({
  id: variable.id,
  name: variable.name,
  resolvedType: variable.resolvedType,
  variableCollectionId: variable.variableCollectionId,
  valuesByMode: variable.valuesByMode,
  ...(variable.key !== undefined ? { key: variable.key } : {}),
  ...(variable.description !== undefined ? { description: variable.description } : {}),
  ...(variable.scopes !== undefined ? { scopes: variable.scopes } : {}),
});

const exportLocalVariables = async (): Promise<void> => {
  const [collections, variables] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync() as Promise<FigmaVariableCollectionLike[]>,
    figma.variables.getLocalVariablesAsync() as Promise<FigmaVariableLike[]>,
  ]);
  const payload = buildPluginVariablesPayload({
    ...(typeof figma.fileKey === "string" ? { source: { fileKey: figma.fileKey } } : {}),
    collections: collections.map(compactCollection),
    variables: variables.map(compactVariable),
  });

  figma.ui.postMessage({ type: "local-variables-exported", payload });
};

figma.ui.onmessage = async (msg: { type: string; payload?: unknown }) => {
  // The sandbox only handles Figma operations that cannot be done from the UI
  // iframe or REST API. Design creation belongs to the official Figma MCP path.
  switch (msg.type) {
    case "export-local-variables":
      try {
        await exportLocalVariables();
      } catch {
        figma.ui.postMessage({
          type: "local-variables-export-failed",
          message: "Could not read variables from this Figma file.",
        });
      }
      break;
    case "close":
      figma.closePlugin();
      break;
    default:
      figma.notify(`Unknown message: ${msg.type}`);
  }
};
