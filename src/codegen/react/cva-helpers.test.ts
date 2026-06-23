import { describe, expect, it } from "bun:test";
import type { ComponentJson } from "../../sync/component-shape.js";
import {
  deriveVariantDefaults,
  emitCvaVariantsBlock,
  emitPropsInterface,
  intrinsicElementFor,
  kebabCase,
  slugifyVariantValue,
  variantPropKey,
} from "./cva-helpers.js";

// ─── slugifyVariantValue ──────────────────────────────────────────────────────

describe("slugifyVariantValue", () => {
  it("Primary → primary", () => expect(slugifyVariantValue("Primary")).toBe("primary"));
  it("'On Hover' → on-hover", () => expect(slugifyVariantValue("On Hover")).toBe("on-hover"));
  it("'PieChart 3D' → pie-chart-3d", () =>
    expect(slugifyVariantValue("PieChart 3D")).toBe("pie-chart-3d"));
  it("'Pri/Sec' → pri-sec", () => expect(slugifyVariantValue("Pri/Sec")).toBe("pri-sec"));
  it("dedup-dashes", () =>
    expect(slugifyVariantValue("__leading--trailing__")).toBe("leading-trailing"));
  it("preserves single lowercase", () => expect(slugifyVariantValue("sm")).toBe("sm"));
  it("handles CamelCase without spaces: PieChart → pie-chart", () =>
    expect(slugifyVariantValue("PieChart")).toBe("pie-chart"));
  it("empty string → empty string", () => expect(slugifyVariantValue("")).toBe(""));
});

// ─── kebabCase / variantPropKey ───────────────────────────────────────────────

describe("kebabCase / variantPropKey", () => {
  it("Variant → variant", () => expect(variantPropKey("Variant")).toBe("variant"));
  it("Size → size", () => expect(variantPropKey("Size")).toBe("size"));
  it("IconRight → icon-right", () => expect(kebabCase("IconRight")).toBe("icon-right"));
  it("variantPropKey delegates to kebabCase", () =>
    expect(variantPropKey("IconRight")).toBe(kebabCase("IconRight")));
});

// ─── fixtures ─────────────────────────────────────────────────────────────────

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
      Label: { type: "TEXT" },
      Icon: { type: "INSTANCE_SWAP" },
    },
    updatedAt: "x",
  };
}

// ─── deriveVariantDefaults ────────────────────────────────────────────────────

describe("deriveVariantDefaults", () => {
  it("Button → first value per axis", () => {
    expect(deriveVariantDefaults(buttonJson())).toEqual({ variant: "primary", size: "sm" });
  });

  it("no variants → empty record", () => {
    const json: ComponentJson = { ...buttonJson(), variants: [] };
    expect(deriveVariantDefaults(json)).toEqual({});
  });

  it("single axis", () => {
    const json: ComponentJson = {
      ...buttonJson(),
      variants: [{ propertyName: "Size", values: ["large", "small"] }],
    };
    expect(deriveVariantDefaults(json)).toEqual({ size: "large" });
  });

  it("slugifies the default value", () => {
    const json: ComponentJson = {
      ...buttonJson(),
      variants: [{ propertyName: "Variant", values: ["On Hover", "Default"] }],
    };
    expect(deriveVariantDefaults(json)).toEqual({ variant: "on-hover" });
  });
});

// ─── emitCvaVariantsBlock ─────────────────────────────────────────────────────

describe("emitCvaVariantsBlock", () => {
  it("emits cva(...) with axes and slugified values", () => {
    const out = emitCvaVariantsBlock(buttonJson());
    expect(out).toContain("cva(");
    expect(out).toContain("variant:");
    expect(out).toContain("primary");
    expect(out).toContain("destructive");
    expect(out).toContain("ghost");
    expect(out).toContain("size:");
    expect(out).toContain("sm");
    expect(out).toContain("defaultVariants");
  });

  it('emits cva("") for no-variant components', () => {
    const json: ComponentJson = { ...buttonJson(), variants: [], properties: {} };
    const out = emitCvaVariantsBlock(json);
    expect(out.trim()).toBe('cva("")');
  });

  it("slugifies variant values (On Hover → on-hover)", () => {
    const json: ComponentJson = {
      ...buttonJson(),
      variants: [{ propertyName: "State", values: ["On Hover", "Pressed", "Default"] }],
    };
    const out = emitCvaVariantsBlock(json);
    expect(out).toContain("on-hover");
    expect(out).toContain("pressed");
    expect(out).toContain("default");
    expect(out).not.toContain("On Hover");
  });

  it("includes defaultVariants with first-value fallback", () => {
    const out = emitCvaVariantsBlock(buttonJson());
    expect(out).toContain('variant: "primary"');
    expect(out).toContain('size: "sm"');
  });

  it("produces parseable output structure", () => {
    const out = emitCvaVariantsBlock(buttonJson());
    // Should start with cva( and end with )
    expect(out.trim().startsWith("cva(")).toBe(true);
    expect(out.trim().endsWith(")")).toBe(true);
  });
});

// ─── intrinsicElementFor ──────────────────────────────────────────────────────

describe("intrinsicElementFor", () => {
  it("Button → button", () => expect(intrinsicElementFor("Button")).toBe("button"));
  it("Input → input", () => expect(intrinsicElementFor("Input")).toBe("input"));
  it("TextField → input", () => expect(intrinsicElementFor("TextField")).toBe("input"));
  it("Select → select", () => expect(intrinsicElementFor("Select")).toBe("select"));
  it("Textarea → textarea", () => expect(intrinsicElementFor("Textarea")).toBe("textarea"));
  it("Card → div", () => expect(intrinsicElementFor("Card")).toBe("div"));
  it("Link → a", () => expect(intrinsicElementFor("Link")).toBe("a"));
  it("Anchor → a", () => expect(intrinsicElementFor("Anchor")).toBe("a"));
  it("Label → label", () => expect(intrinsicElementFor("Label")).toBe("label"));
  it("case-insensitive match: BUTTON → button", () =>
    expect(intrinsicElementFor("BUTTON")).toBe("button"));
  it("substring match: IconButton → button", () =>
    expect(intrinsicElementFor("IconButton")).toBe("button"));
  it("unknown → div", () => expect(intrinsicElementFor("Avatar")).toBe("div"));
});

// ─── emitPropsInterface ───────────────────────────────────────────────────────

describe("emitPropsInterface", () => {
  it("Button props extends VariantProps and Button attrs, includes Boolean/Text/InstanceSwap, ends with children", () => {
    const out = emitPropsInterface(buttonJson(), "button");
    expect(out).toContain("interface ButtonProps");
    expect(out).toContain("VariantProps<typeof buttonVariants>");
    expect(out).toContain("React.ButtonHTMLAttributes<HTMLButtonElement>");
    expect(out).toContain("disabled?: boolean");
    expect(out).toContain("label?: string");
    expect(out).toContain("icon?: React.ReactNode");
    expect(out).toContain("children?: React.ReactNode");
  });

  it("Card → div attrs", () => {
    const json: ComponentJson = { ...buttonJson(), name: "Card", variants: [], properties: {} };
    const out = emitPropsInterface(json, "div");
    expect(out).toContain("interface CardProps");
    expect(out).toContain("React.HTMLAttributes<HTMLDivElement>");
  });

  it("does NOT redeclare VARIANT properties in the interface body", () => {
    const out = emitPropsInterface(buttonJson(), "button");
    // VARIANT props come through VariantProps — they must not appear as explicit lines
    // The variant axes ("Variant", "Size") should not appear as `variant?: ...` or `size?: ...`
    // in the body section (only BOOLEAN/TEXT/INSTANCE_SWAP appear there)
    const bodyStart = out.indexOf("{");
    const body = out.slice(bodyStart);
    // Should not contain variant or size as standalone typed props
    expect(body).not.toMatch(/^\s+variant\?:/m);
    expect(body).not.toMatch(/^\s+size\?:/m);
  });

  it("input element → React.InputHTMLAttributes<HTMLInputElement>", () => {
    const json: ComponentJson = { ...buttonJson(), name: "Input", variants: [] };
    const out = emitPropsInterface(json, "input");
    expect(out).toContain("React.InputHTMLAttributes<HTMLInputElement>");
  });

  it("select element → React.SelectHTMLAttributes<HTMLSelectElement>", () => {
    const json: ComponentJson = { ...buttonJson(), name: "Select", variants: [] };
    const out = emitPropsInterface(json, "select");
    expect(out).toContain("React.SelectHTMLAttributes<HTMLSelectElement>");
  });

  it("anchor element → React.AnchorHTMLAttributes<HTMLAnchorElement>", () => {
    const json: ComponentJson = { ...buttonJson(), name: "Link", variants: [] };
    const out = emitPropsInterface(json, "a");
    expect(out).toContain("React.AnchorHTMLAttributes<HTMLAnchorElement>");
  });

  it("children always appears last", () => {
    const out = emitPropsInterface(buttonJson(), "button");
    const childrenIdx = out.lastIndexOf("children?:");
    const iconIdx = out.indexOf("icon?:");
    expect(childrenIdx).toBeGreaterThan(iconIdx);
  });

  it("variantsConst uses camelCase based on component name", () => {
    const out = emitPropsInterface(buttonJson(), "button");
    // "buttonVariants" (not "ButtonVariants")
    expect(out).toContain("typeof buttonVariants");
  });
});
