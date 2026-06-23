import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { variablesJsonPath } from "../util/paths.js";
import { importPluginVariables, PluginVariablesPayloadSchema } from "./plugin-variables.js";

const roots: string[] = [];

const mkRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "kotikit-plugin-vars-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("plugin variable import", () => {
  it("normalizes plugin-exported local variables into variables.json", async () => {
    const root = mkRoot();
    const payload = PluginVariablesPayloadSchema.parse({
      version: 1,
      source: { fileName: "Design System" },
      collections: [
        {
          id: "collection-1",
          name: "Theme",
          modes: [
            { modeId: "light", name: "Light" },
            { modeId: "dark", name: "Dark" },
          ],
        },
      ],
      variables: [
        {
          id: "variable-1",
          name: "color/brand",
          resolvedType: "COLOR",
          variableCollectionId: "collection-1",
          description: "Primary brand color",
          valuesByMode: {
            light: { r: 0, g: 0.2, b: 1, a: 1 },
            dark: { r: 0.6, g: 0.75, b: 1, a: 1 },
          },
        },
      ],
    });

    const result = await importPluginVariables(root, payload);
    const file = JSON.parse(readFileSync(variablesJsonPath(root), "utf-8")) as {
      entries: Array<{ name: string; source: string; modes?: Record<string, unknown> }>;
    };

    expect(result.imported).toBe(1);
    expect(result.totalEntries).toBe(1);
    expect(file.entries[0]?.name).toBe("color/brand");
    expect(file.entries[0]?.source).toBe("variable");
    expect(file.entries[0]?.modes).toHaveProperty("Light");
    expect(file.entries[0]?.modes).toHaveProperty("Dark");
  });

  it("keeps existing style tokens and lets plugin variables win on name collisions", async () => {
    const root = mkRoot();
    mkdirSync(join(root, "design-system"), { recursive: true });
    writeFileSync(
      variablesJsonPath(root),
      `${JSON.stringify({
        version: 1,
        entries: [
          { name: "color/brand", kind: "color", source: "style", value: "#0055ff" },
          { name: "effect/focus", kind: "effect", source: "style", value: { type: "DROP_SHADOW" } },
        ],
        collisions: [],
      })}\n`
    );

    const payload = PluginVariablesPayloadSchema.parse({
      version: 1,
      collections: [
        { id: "collection-1", name: "Theme", modes: [{ modeId: "m1", name: "Default" }] },
      ],
      variables: [
        {
          id: "variable-1",
          name: "color/brand",
          resolvedType: "COLOR",
          variableCollectionId: "collection-1",
          valuesByMode: { m1: { r: 0, g: 0.1, b: 0.8, a: 1 } },
        },
        {
          id: "variable-2",
          name: "space/4",
          resolvedType: "FLOAT",
          variableCollectionId: "collection-1",
          valuesByMode: { m1: 16 },
        },
      ],
    });

    const result = await importPluginVariables(root, payload);
    const file = JSON.parse(readFileSync(variablesJsonPath(root), "utf-8")) as {
      entries: Array<{ name: string; source: string }>;
      collisions: Array<{ name: string; keptSource: string }>;
    };

    expect(result.imported).toBe(2);
    expect(file.entries.map((entry) => entry.name)).toEqual([
      "color/brand",
      "space/4",
      "effect/focus",
    ]);
    expect(file.entries.find((entry) => entry.name === "color/brand")?.source).toBe("variable");
    expect(file.collisions).toContainEqual({ name: "color/brand", keptSource: "variable" });
    expect(existsSync(variablesJsonPath(root))).toBe(true);
  });
});
