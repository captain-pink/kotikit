export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

type VariableSyncStatus = "waiting" | "ready" | "done" | "attention";

export interface VariableSyncModel {
  statusText: string;
  canSyncVariables: boolean;
  variablesStatus: VariableSyncStatus;
  variablesMessage: string;
}

export interface VariableSyncInput {
  connected: boolean;
  tools: string[];
  variablesResult: ToolResult | null;
}

const variableToolName = "kotikit_sync_plugin_variables";

export function resultSummary(result: ToolResult): string {
  return result.content[0]?.text.split("\n\n")[0]?.trim() || "Variables synced.";
}

export function buildVariableSyncModel(input: VariableSyncInput): VariableSyncModel {
  const canSyncVariables = input.connected && input.tools.includes(variableToolName);
  if (input.variablesResult !== null) {
    return {
      statusText: input.connected ? "Connected" : "Disconnected",
      canSyncVariables,
      variablesStatus: input.variablesResult.isError ? "attention" : "done",
      variablesMessage: resultSummary(input.variablesResult),
    };
  }

  return {
    statusText: input.connected ? "Connected" : "Disconnected",
    canSyncVariables,
    variablesStatus: canSyncVariables ? "ready" : "waiting",
    variablesMessage: canSyncVariables
      ? "Open the source design-system file, then sync variables."
      : "Connect to the kotikit bridge to sync variables.",
  };
}
