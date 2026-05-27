import { describe, it, expect } from "bun:test";
import {
  ScreenSpecSchema,
  FlowManifestSchema,
  newScreenSpec,
  newFlowManifest,
  parseScreenSpec,
  parseFlowManifest,
} from "./schema";
import { parseConfig, defaultConfig } from "../config/schema";

describe("ScreenSpecSchema", () => {
  it("accepts a valid minimal screen spec", () => {
    const spec = newScreenSpec({ title: "Cart", description: "Shows cart items" });
    expect(() => ScreenSpecSchema.parse(spec)).not.toThrow();
  });

  it("round-trips through parseScreenSpec", () => {
    const spec = newScreenSpec({ title: "Cart", description: "Shows cart" });
    const parsed = parseScreenSpec(spec);
    expect(parsed.title).toBe("Cart");
    expect(parsed.type).toBe("screen");
  });

  it('accepts "inherits" for responsive', () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    expect(spec.requirements.responsive).toBe("inherits");
    expect(() => ScreenSpecSchema.parse(spec)).not.toThrow();
  });

  it("accepts an override object for responsive", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.requirements.responsive = { overrides: { breakpoints: [375] } };
    expect(() => ScreenSpecSchema.parse(spec)).not.toThrow();
  });

  it("rejects a string breakpoints value in the override", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    // Force an invalid shape
    // @ts-expect-error intentional bad input for runtime test
    spec.requirements.responsive = { overrides: { breakpoints: "375px" } };
    expect(() => parseScreenSpec(spec)).toThrow();
  });

  it("throws a plain-English error when context.description is missing", () => {
    const bad = { ...newScreenSpec({ title: "Cart", description: "x" }), context: { userTypes: [], entryPoints: [] } };
    expect(() => parseScreenSpec(bad)).toThrow(/context/);
  });

  it("flowRef is present when supplied", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x", flowRef: "checkout-flow/flow.json" });
    expect(spec.flowRef).toBe("checkout-flow/flow.json");
  });

  it("flowRef is absent when not supplied", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    expect(spec.flowRef).toBeUndefined();
  });
});

describe("FlowManifestSchema", () => {
  it("accepts a valid manifest", () => {
    const manifest = newFlowManifest({
      title: "Checkout Flow",
      description: "Full purchase flow",
      screens: [
        { id: "cart", path: "cart.spec.json", title: "Cart" },
        { id: "shipping", path: "shipping.spec.json", title: "Shipping" },
      ],
    });
    expect(() => FlowManifestSchema.parse(manifest)).not.toThrow();
  });

  it("round-trips through parseFlowManifest", () => {
    const m = newFlowManifest({
      title: "Checkout",
      description: "desc",
      screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
    });
    const parsed = parseFlowManifest(m);
    expect(parsed.title).toBe("Checkout");
  });

  it("rejects a manifest with zero screens", () => {
    expect(() =>
      parseFlowManifest({
        id: "00000000-0000-4000-a000-000000000000",
        title: "Empty",
        description: "no screens",
        screens: [],
        transitions: [],
        sharedState: [],
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      })
    ).toThrow();
  });
});

describe("ConfigSchema", () => {
  it("defaultConfig passes parse", () => {
    expect(() => parseConfig(defaultConfig())).not.toThrow();
  });

  it("defaultConfig has expected shape", () => {
    const c = defaultConfig();
    expect(c.project.framework).toBe("react");
    expect(c.project.tests).toBe(true);
    expect(c.git.autoCommit).toBe(true);
    expect(c.defaults.breakpoints).toEqual([375, 768, 1024, 1440]);
  });
});
