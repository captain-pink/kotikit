import { describe, it, expect } from "bun:test";
import { scaffoldComponent, buildComponentTsx, buildStoryTsx } from "./scaffold.js";
import type { ComponentJson } from "../../sync/component-shape.js";

function buttonJson(): ComponentJson {
  return {
    name: "Button",
    key: "k",
    fileKey: "f",
    path: "components/button.json",
    variants: [
      { propertyName: "Variant", values: ["Primary", "Secondary", "Destructive", "Ghost"] },
      { propertyName: "Size", values: ["sm", "md", "lg"] },
    ],
    properties: {
      Disabled: { type: "BOOLEAN", defaultValue: false },
    },
    updatedAt: "x",
  };
}

function cardJson(): ComponentJson {
  return {
    name: "Card",
    key: "k",
    fileKey: "f",
    path: "components/card.json",
    variants: [],
    properties: {},
    updatedAt: "x",
  };
}

describe("scaffoldComponent", () => {
  it("Button with Storybook → 2 files (tsx + stories.tsx), no notes", () => {
    const result = scaffoldComponent({ json: buttonJson(), hasStorybook: true }, "src/components");
    expect(result.componentName).toBe("Button");
    expect(result.kebabName).toBe("button");
    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.path).toBe("src/components/ui/button.tsx");
    expect(result.files[1]?.path).toBe("src/components/ui/button.stories.tsx");
    expect(result.notes).toEqual([]);
  });

  it("Button without Storybook → 1 file, one note", () => {
    const result = scaffoldComponent({ json: buttonJson(), hasStorybook: false }, "src/components");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("src/components/ui/button.tsx");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("Storybook not detected");
  });

  it("PascalCase + kebab consistency for 'PieChart 3D'", () => {
    const json: ComponentJson = { ...buttonJson(), name: "PieChart 3D" };
    const result = scaffoldComponent({ json, hasStorybook: false }, "src/components");
    expect(result.componentName).toBe("PieChart3D");
    // Just verify the path is consistent with kebab name:
    expect(result.files[0]?.path).toBe(`src/components/ui/${result.kebabName}.tsx`);
  });
});

describe("buildComponentTsx", () => {
  it("includes cva, VariantProps, and intrinsic button element for Button", () => {
    const out = buildComponentTsx(buttonJson(), "src/components");
    expect(out).toContain("import * as React from");
    expect(out).toContain("cva");
    expect(out).toContain("VariantProps");
    expect(out).toContain("buttonVariants");
    expect(out).toContain("export function Button");
    expect(out).toContain("<button");
    expect(out).toContain("export default Button");
  });

  it("uses <div> intrinsic element for Card", () => {
    const out = buildComponentTsx(cardJson(), "src/components");
    expect(out).toContain("<div");
    expect(out).not.toContain("<button");
  });

  it("CVA block contains slugified variant values", () => {
    const out = buildComponentTsx(buttonJson(), "src/components");
    expect(out).toContain("primary");
    expect(out).toContain("destructive");
    expect(out).toContain("ghost");
    expect(out).toContain("sm");
  });

  it("Disabled BOOLEAN prop appears in props interface", () => {
    const out = buildComponentTsx(buttonJson(), "src/components");
    expect(out).toContain("disabled?: boolean");
  });
});

describe("buildStoryTsx", () => {
  it("Button story has title 'UI/Button', Default story, and one story per variant axis", () => {
    const out = buildStoryTsx(buttonJson());
    expect(out).toContain('import type { Meta, StoryObj } from "@storybook/react"');
    expect(out).toContain('title: "UI/Button"');
    expect(out).toContain("export const Default");
    expect(out).toContain("export const Variants");
    expect(out).toContain("export const Sizes");
    // No cartesian explosion: only 2 axis stories + Default + maybe States
    expect((out.match(/^export const /gm) ?? []).length).toBeLessThanOrEqual(5);
  });

  it("Disabled BOOLEAN → States story emitted", () => {
    const out = buildStoryTsx(buttonJson());
    expect(out).toContain("export const States");
  });

  it("No BOOLEAN props → no States story", () => {
    const out = buildStoryTsx(cardJson());
    expect(out).not.toContain("export const States");
  });

  it("Card with no variants → only Default story", () => {
    const out = buildStoryTsx(cardJson());
    expect(out).toContain("export const Default");
    expect(out).not.toContain("export const Variants");
  });
});
