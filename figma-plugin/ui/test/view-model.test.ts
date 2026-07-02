import { describe, expect, it } from "bun:test";
import { buildVariableSyncModel, resultSummary, type ToolResult } from "../view-model.js";

const result = (detail: unknown, isError = false): ToolResult => ({
  ...(isError ? { isError: true } : {}),
  content: [{ type: "text", text: `ok\n\n${JSON.stringify(detail)}` }],
});

describe("plugin variable sync view model", () => {
  it("summarizes the first readable MCP tool paragraph", () => {
    expect(resultSummary(result({ imported: 2 }))).toBe("ok");
    expect(resultSummary({ content: [{ type: "text", text: "" }] })).toBe("Variables synced.");
  });

  it("enables variable sync only when the bridge exposes the variable import tool", () => {
    const model = buildVariableSyncModel({
      connected: true,
      tools: ["kotikit_sync_plugin_variables"],
      variablesResult: null,
    });

    expect(model.statusText).toBe("Connected");
    expect(model.canSyncVariables).toBe(true);
    expect(model.variablesStatus).toBe("ready");
    expect(model.variablesMessage).toBe("Open the source design-system file, then sync variables.");
  });

  it("keeps the model scoped to variable import state", () => {
    const model = buildVariableSyncModel({
      connected: false,
      tools: [],
      variablesResult: result({ imported: 2 }),
    });

    expect(model.statusText).toBe("Disconnected");
    expect(model.canSyncVariables).toBe(false);
    expect(model.variablesStatus).toBe("done");
    expect(model.variablesMessage).toBe("ok");
    expect(model).not.toHaveProperty("checklist");
    expect(model).not.toHaveProperty("reviewSummary");
  });
});
