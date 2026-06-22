import { describe, expect, it } from "bun:test";
import {
  hasUsableVariables,
  resolveVariable,
  summarizeVariableAvailability,
} from "./variable-resolver.js";
import type { VariablesJson } from "./variables.js";

const variables: VariablesJson = {
  version: 1,
  collisions: [],
  entries: [
    {
      name: "color/primary",
      kind: "color",
      source: "variable",
      value: "#0055ff",
      key: "primary-key",
      id: "primary-id",
      scopes: ["FRAME_FILL"],
    },
    {
      name: "space/4",
      kind: "spacing",
      source: "variable",
      value: 16,
      id: "space-id",
    },
    {
      name: "legacy/blue",
      kind: "color",
      source: "style",
      value: "#0000ff",
      key: "style-key",
    },
  ],
};

describe("variable resolver", () => {
  it("prefers variable entries over style entries for the requested kind", () => {
    const resolved = resolveVariable(variables, {
      kind: "color",
      nameHints: ["blue", "primary"],
    });

    expect(resolved?.name).toBe("color/primary");
    expect(resolved?.key).toBe("primary-key");
  });

  it("falls back to style entries when variables are unavailable", () => {
    const resolved = resolveVariable(
      { ...variables, entries: variables.entries.filter((entry) => entry.source === "style") },
      { kind: "color", nameHints: ["blue"] }
    );

    expect(resolved?.name).toBe("legacy/blue");
    expect(resolved?.source).toBe("style");
  });

  it("reports usable variables only when at least one variable source entry exists", () => {
    expect(hasUsableVariables(variables)).toBe(true);
    expect(hasUsableVariables({ ...variables, entries: variables.entries.filter((entry) => entry.source === "style") })).toBe(false);
  });

  it("summarizes whether plugin sync should be suggested before literals are allowed", () => {
    expect(summarizeVariableAvailability(null)).toEqual({
      hasVariablesFile: false,
      hasUsableVariables: false,
      shouldSuggestPluginSync: true,
    });
    expect(summarizeVariableAvailability(variables)).toEqual({
      hasVariablesFile: true,
      hasUsableVariables: true,
      shouldSuggestPluginSync: false,
    });
  });
});
