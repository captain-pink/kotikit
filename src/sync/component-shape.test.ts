import { describe, it, expect } from "bun:test";
import {
  buildComponentJson,
  buildPropsString,
  ComponentJsonSchema,
  type FigmaPublishedComponent,
  type FigmaComponentSet,
} from "./component-shape.js";

describe("buildComponentJson", () => {
  it("produces a valid ComponentJson for a Button with Variant + Size", () => {
    const pub: FigmaPublishedComponent = {
      key: "pubkey",
      name: "Button",
      description: "The primary button",
      thumbnail_url: "https://figma.example/thumb.png",
    };
    const set: FigmaComponentSet = {
      key: "setkey",
      name: "Button",
      defaultVariantId: "defaultvariantid",
      componentPropertyDefinitions: {
        Variant: { type: "VARIANT", variantOptions: ["Primary", "Secondary", "Destructive", "Ghost"] },
        Size: { type: "VARIANT", variantOptions: ["sm", "md", "lg"] },
        Disabled: { type: "BOOLEAN", defaultValue: false },
        Label: { type: "TEXT", defaultValue: "Click me" },
      },
    };
    const result = buildComponentJson({ fileKey: "F1", publishedComponent: pub, componentSet: set });

    ComponentJsonSchema.parse(result);

    expect(result.name).toBe("Button");
    expect(result.key).toBe("setkey"); // component-set key wins
    expect(result.fileKey).toBe("F1");
    expect(result.path).toBe("components/button.json");
    expect(result.description).toBe("The primary button");
    expect(result.defaultKey).toBe("defaultvariantid");
    expect(result.thumbnailUrl).toBe("https://figma.example/thumb.png");

    expect(result.variants).toHaveLength(2);
    const variantProp = result.variants.find(v => v.propertyName === "Variant");
    const sizeProp = result.variants.find(v => v.propertyName === "Size");
    expect(variantProp?.values).toEqual(["Primary", "Secondary", "Destructive", "Ghost"]);
    expect(sizeProp?.values).toEqual(["sm", "md", "lg"]);

    expect(result.properties.Disabled?.type).toBe("BOOLEAN");
    expect(result.properties.Disabled?.defaultValue).toBe(false);
    expect(result.properties.Label?.type).toBe("TEXT");
    expect(result.properties.Label?.defaultValue).toBe("Click me");
  });

  it("falls back to publishedComponent.key when no componentSet", () => {
    const result = buildComponentJson({
      fileKey: "F1",
      publishedComponent: { key: "pubkey", name: "Avatar" },
    });
    expect(result.key).toBe("pubkey");
    expect(result.variants).toEqual([]);
    expect(result.properties).toEqual({});
  });

  it("slugifies the name for the path", () => {
    const result = buildComponentJson({
      fileKey: "F1",
      publishedComponent: { key: "k", name: "TextField" },
    });
    expect(result.path).toBe("components/text-field.json");
  });

  it("BOOLEAN/TEXT/INSTANCE_SWAP land in properties, VARIANT lands in variants", () => {
    const set: FigmaComponentSet = {
      key: "k", name: "Box",
      componentPropertyDefinitions: {
        Kind: { type: "VARIANT", variantOptions: ["A", "B"] },
        On: { type: "BOOLEAN", defaultValue: true },
        Label: { type: "TEXT" },
        Swap: { type: "INSTANCE_SWAP" },
      },
    };
    const result = buildComponentJson({
      fileKey: "F",
      publishedComponent: { key: "p", name: "Box" },
      componentSet: set,
    });
    expect(result.variants.map(v => v.propertyName)).toEqual(["Kind"]);
    expect(Object.keys(result.properties).sort()).toEqual(["Label", "On", "Swap"]);
  });

  it("uses nodeDetails when componentSet has no definitions", () => {
    const result = buildComponentJson({
      fileKey: "F",
      publishedComponent: { key: "p", name: "C" },
      nodeDetails: {
        componentPropertyDefinitions: {
          State: { type: "VARIANT", variantOptions: ["on", "off"] },
        },
      },
    });
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]?.propertyName).toBe("State");
  });

  it("validates output through ComponentJsonSchema", () => {
    const result = buildComponentJson({
      fileKey: "F",
      publishedComponent: { key: "p", name: "Card" },
    });
    expect(() => ComponentJsonSchema.parse(result)).not.toThrow();
  });
});

describe("buildPropsString", () => {
  it("joins variant + property names with spaces", () => {
    const json = buildComponentJson({
      fileKey: "F",
      publishedComponent: { key: "p", name: "Btn" },
      componentSet: {
        key: "s", name: "Btn",
        componentPropertyDefinitions: {
          Variant: { type: "VARIANT", variantOptions: ["a", "b"] },
          Disabled: { type: "BOOLEAN" },
        },
      },
    });
    const props = buildPropsString(json);
    // Both names appear (order is variants-first by construction)
    expect(props.split(" ").sort()).toEqual(["Disabled", "Variant"]);
  });

  it("empty for a component with no properties", () => {
    const json = buildComponentJson({
      fileKey: "F",
      publishedComponent: { key: "p", name: "Plain" },
    });
    expect(buildPropsString(json)).toBe("");
  });
});
