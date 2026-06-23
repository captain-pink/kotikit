import { describe, expect, it } from "bun:test";
import { buildPluginVariablesPayload } from "../variables-export.js";

describe("buildPluginVariablesPayload", () => {
  it("exports compact local variable collections and variables", () => {
    const payload = buildPluginVariablesPayload({
      source: { fileName: "Design System" },
      collections: [
        {
          id: "collection-1",
          key: "collection-key",
          name: "Theme",
          defaultModeId: "light",
          modes: [
            { modeId: "light", name: "Light" },
            { modeId: "dark", name: "Dark" },
          ],
        },
      ],
      variables: [
        {
          id: "variable-1",
          key: "variable-key",
          name: "color/brand",
          description: "Brand color",
          resolvedType: "COLOR",
          variableCollectionId: "collection-1",
          valuesByMode: {
            light: { r: 0, g: 0.2, b: 1, a: 1 },
            dark: { r: 0.6, g: 0.75, b: 1, a: 1 },
          },
          scopes: ["FILL"],
        },
      ],
    });

    expect(payload).toEqual({
      version: 1,
      source: { fileName: "Design System" },
      collections: [
        {
          id: "collection-1",
          key: "collection-key",
          name: "Theme",
          defaultModeId: "light",
          modes: [
            { modeId: "light", name: "Light" },
            { modeId: "dark", name: "Dark" },
          ],
        },
      ],
      variables: [
        {
          id: "variable-1",
          key: "variable-key",
          name: "color/brand",
          description: "Brand color",
          resolvedType: "COLOR",
          variableCollectionId: "collection-1",
          valuesByMode: {
            light: { r: 0, g: 0.2, b: 1, a: 1 },
            dark: { r: 0.6, g: 0.75, b: 1, a: 1 },
          },
          scopes: ["FILL"],
        },
      ],
    });
  });

  it("omits undefined optional fields", () => {
    const payload = buildPluginVariablesPayload({
      collections: [{ id: "collection-1", name: "Theme", modes: [] }],
      variables: [
        {
          id: "variable-1",
          name: "space/4",
          resolvedType: "FLOAT",
          variableCollectionId: "collection-1",
          valuesByMode: { default: 16 },
        },
      ],
    });

    expect(payload.collections[0]).not.toHaveProperty("key");
    expect(payload.collections[0]).not.toHaveProperty("defaultModeId");
    expect(payload.variables[0]).not.toHaveProperty("description");
    expect(payload.variables[0]).not.toHaveProperty("scopes");
  });
});
