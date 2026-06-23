import { describe, expect, it } from "bun:test";
import {
  type FlowDraft,
  isMultiScreen,
  isSingleScreen,
  materializeFlow,
  materializeSingle,
  type SingleDraft,
} from "./decompose";
import { FlowManifestSchema, ScreenSpecSchema } from "./schema";

const makeScreenDraft = (slug: string, title: string) => ({
  slug,
  title,
  description: `${title} screen description`,
  functional: [`Show ${title} content`],
  states: { default: "Idle", loading: "Loading data" },
  components: [{ name: `${title}Container`, usage: "Main wrapper" }],
  acceptanceCriteria: [`${title} renders without error`],
  userTypes: ["registered"],
  entryPoints: [`/${slug}`],
});

const flowDraft: FlowDraft = {
  scope: "checkout-flow",
  title: "Checkout Flow",
  description: "Full purchase journey",
  screens: [
    makeScreenDraft("cart", "Cart"),
    makeScreenDraft("shipping", "Shipping"),
    makeScreenDraft("payment", "Payment"),
  ],
  transitions: [
    { from: "cart", to: "shipping", trigger: "Proceed" },
    { from: "shipping", to: "payment", trigger: "Next" },
  ],
  sharedState: ["orderId", "userAddress"],
};

const singleDraft: SingleDraft = {
  scope: "profile-page",
  screen: makeScreenDraft("profile-page", "Profile Page"),
};

describe("isMultiScreen", () => {
  it("returns true for FlowDraft", () => {
    expect(isMultiScreen(flowDraft)).toBe(true);
  });

  it("returns false for SingleDraft", () => {
    expect(isMultiScreen(singleDraft)).toBe(false);
  });

  it("returns false for a malformed flow-like draft with no scope", () => {
    expect(isMultiScreen({ screens: [makeScreenDraft("members", "Members")] } as never)).toBe(
      false
    );
  });
});

describe("isSingleScreen", () => {
  it("returns true for SingleDraft", () => {
    expect(isSingleScreen(singleDraft)).toBe(true);
  });

  it("returns false for a malformed screen-like draft with no screen", () => {
    expect(isSingleScreen({ title: "Members", type: "screen" } as never)).toBe(false);
  });
});

describe("materializeFlow", () => {
  it("returns manifest with 3 entries matching screen slugs", () => {
    const { manifest } = materializeFlow(flowDraft);
    expect(manifest.screens).toHaveLength(3);
    expect(manifest.screens[0].id).toBe("cart");
    expect(manifest.screens[1].id).toBe("shipping");
    expect(manifest.screens[2].id).toBe("payment");
  });

  it("manifest screen paths are <slug>.spec.json", () => {
    const { manifest } = materializeFlow(flowDraft);
    for (const screen of manifest.screens) {
      expect(screen.path).toBe(`${screen.id}.spec.json`);
    }
  });

  it("returns 3 specs each with flowRef set", () => {
    const { specs } = materializeFlow(flowDraft);
    expect(specs).toHaveLength(3);
    for (const { spec } of specs) {
      expect(spec.flowRef).toBe("checkout-flow/flow.json");
    }
  });

  it("each spec has the correct screenSlug", () => {
    const { specs } = materializeFlow(flowDraft);
    expect(specs[0].screenSlug).toBe("cart");
    expect(specs[1].screenSlug).toBe("shipping");
    expect(specs[2].screenSlug).toBe("payment");
  });

  it("each spec passes ScreenSpecSchema.parse", () => {
    const { specs } = materializeFlow(flowDraft);
    for (const { spec } of specs) {
      expect(() => ScreenSpecSchema.parse(spec)).not.toThrow();
    }
  });

  it("manifest passes FlowManifestSchema.parse", () => {
    const { manifest } = materializeFlow(flowDraft);
    expect(() => FlowManifestSchema.parse(manifest)).not.toThrow();
  });

  it("specs carry functional requirements from draft", () => {
    const { specs } = materializeFlow(flowDraft);
    expect(specs[0].spec.requirements.functional).toContain("Show Cart content");
  });

  it("specs carry states from draft", () => {
    const { specs } = materializeFlow(flowDraft);
    expect(specs[0].spec.requirements.states["loading"]).toBe("Loading data");
  });

  it("specs carry userTypes from draft", () => {
    const { specs } = materializeFlow(flowDraft);
    expect(specs[0].spec.context.userTypes).toContain("registered");
  });

  it("specs carry acceptanceCriteria from draft", () => {
    const { specs } = materializeFlow(flowDraft);
    expect(specs[0].spec.acceptanceCriteria).toContain("Cart renders without error");
  });
});

describe("materializeSingle", () => {
  it("returns spec with flowRef === undefined", () => {
    const { spec } = materializeSingle(singleDraft);
    expect(spec.flowRef).toBeUndefined();
  });

  it("spec passes ScreenSpecSchema.parse", () => {
    const { spec } = materializeSingle(singleDraft);
    expect(() => ScreenSpecSchema.parse(spec)).not.toThrow();
  });

  it("spec title matches screen draft title", () => {
    const { spec } = materializeSingle(singleDraft);
    expect(spec.title).toBe("Profile Page");
  });

  it("spec carries functional requirements from draft", () => {
    const { spec } = materializeSingle(singleDraft);
    expect(spec.requirements.functional).toContain("Show Profile Page content");
  });

  it("spec carries components from draft", () => {
    const { spec } = materializeSingle(singleDraft);
    expect(spec.components[0].name).toBe("Profile PageContainer");
  });
});
