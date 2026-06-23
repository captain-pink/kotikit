import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { variablesJsonPath } from "../util/paths.js";
import { mergeVariables, VariablesJsonSchema, writeVariablesJson } from "./variables.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-vars-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("mergeVariables", () => {
  it("converts a color style into an entry", () => {
    const out = mergeVariables({
      variables: null,
      styles: [{ key: "k1", name: "Brand/Blue", style_type: "FILL", node_id: "n1" }],
      styleDetailsByNodeId: { n1: { document: { id: "n1", name: "Blue" } } },
    });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]?.name).toBe("Brand/Blue");
    expect(out.entries[0]?.kind).toBe("color");
    expect(out.entries[0]?.source).toBe("style");
  });

  it("converts a TEXT style into kind=text", () => {
    const out = mergeVariables({
      variables: null,
      styles: [{ key: "k", name: "Heading", style_type: "TEXT" }],
      styleDetailsByNodeId: {},
    });
    expect(out.entries[0]?.kind).toBe("text");
  });

  it("converts an EFFECT style into kind=effect", () => {
    const out = mergeVariables({
      variables: null,
      styles: [{ key: "k", name: "Shadow/Card", style_type: "EFFECT" }],
      styleDetailsByNodeId: {},
    });
    expect(out.entries[0]?.kind).toBe("effect");
  });

  it("skips GRID styles", () => {
    const out = mergeVariables({
      variables: null,
      styles: [{ key: "k", name: "Layout/Grid", style_type: "GRID" }],
      styleDetailsByNodeId: {},
    });
    expect(out.entries).toHaveLength(0);
  });

  it("a color variable becomes kind=color, source=variable", () => {
    const out = mergeVariables({
      variables: {
        variables: {
          v1: {
            id: "v1",
            key: "var-key-1",
            name: "primary",
            resolvedType: "COLOR",
            valuesByMode: { m1: "#ff0000" },
            variableCollectionId: "c1",
            scopes: ["FRAME_FILL"],
          },
        },
        variableCollections: {
          c1: {
            id: "c1",
            key: "collection-key-1",
            name: "Brand",
            modes: [{ modeId: "m1", name: "default" }],
          },
        },
      },
      styles: [],
      styleDetailsByNodeId: {},
    });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]?.name).toBe("primary");
    expect(out.entries[0]?.kind).toBe("color");
    expect(out.entries[0]?.source).toBe("variable");
    expect(out.entries[0]?.value).toBe("#ff0000");
    expect(out.entries[0]?.id).toBe("v1");
    expect(out.entries[0]?.key).toBe("var-key-1");
    expect(out.entries[0]?.variableCollectionId).toBe("c1");
    expect(out.entries[0]?.variableCollectionKey).toBe("collection-key-1");
    expect(out.entries[0]?.scopes).toEqual(["FRAME_FILL"]);
    expect(out.entries[0]?.modes).toBeUndefined(); // only one mode → modes omitted
  });

  it("a variable with 2 modes populates `modes` keyed by display name", () => {
    const out = mergeVariables({
      variables: {
        variables: {
          v1: {
            id: "v1",
            name: "bg",
            resolvedType: "COLOR",
            valuesByMode: { m1: "#fff", m2: "#000" },
          },
        },
        variableCollections: {
          c1: {
            id: "c1",
            name: "Brand",
            modes: [
              { modeId: "m1", name: "light" },
              { modeId: "m2", name: "dark" },
            ],
          },
        },
      },
      styles: [],
      styleDetailsByNodeId: {},
    });
    expect(out.entries[0]?.modes).toEqual({ light: "#fff", dark: "#000" });
  });

  it("on name collision, the variable wins and the collision is recorded", () => {
    const out = mergeVariables({
      variables: {
        variables: {
          v1: { id: "v1", name: "primary", resolvedType: "COLOR", valuesByMode: { m1: "#ff0000" } },
        },
        variableCollections: {
          c1: { id: "c1", name: "x", modes: [{ modeId: "m1", name: "default" }] },
        },
      },
      styles: [{ key: "k", name: "primary", style_type: "FILL" }],
      styleDetailsByNodeId: {},
    });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]?.source).toBe("variable");
    expect(out.collisions).toEqual([{ name: "primary", keptSource: "variable" }]);
  });

  it("null variables → output contains only style entries", () => {
    const out = mergeVariables({
      variables: null,
      styles: [
        { key: "k1", name: "a", style_type: "FILL" },
        { key: "k2", name: "b", style_type: "TEXT" },
      ],
      styleDetailsByNodeId: {},
    });
    expect(out.entries).toHaveLength(2);
    expect(out.entries.every((e) => e.source === "style")).toBe(true);
    expect(out.collisions).toEqual([]);
  });

  it("skips BOOLEAN variables (not modelled)", () => {
    const out = mergeVariables({
      variables: {
        variables: {
          v1: { id: "v1", name: "flag", resolvedType: "BOOLEAN", valuesByMode: { m: true } },
        },
      },
      styles: [],
      styleDetailsByNodeId: {},
    });
    expect(out.entries).toHaveLength(0);
  });

  it("output is validated by VariablesJsonSchema", () => {
    const out = mergeVariables({ variables: null, styles: [], styleDetailsByNodeId: {} });
    expect(() => VariablesJsonSchema.parse(out)).not.toThrow();
  });
});

describe("writeVariablesJson", () => {
  it("writes pretty JSON with trailing newline", async () => {
    const root = mkTmp();
    const data = { version: 1 as const, entries: [], collisions: [] };
    await writeVariablesJson(root, data);
    const text = readFileSync(variablesJsonPath(root), "utf-8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(data);
  });
});
