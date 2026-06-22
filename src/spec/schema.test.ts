import { describe, it, expect } from "bun:test";
import {
  ScreenSpecSchema,
  FlowManifestSchema,
  SCREEN_SPEC_SCHEMA_VERSION,
  FLOW_MANIFEST_SCHEMA_VERSION,
  newScreenSpec,
  newFlowManifest,
  parseScreenSpec,
  parseFlowManifest,
} from "./schema";
import { CONFIG_SCHEMA_VERSION, parseConfig, defaultConfig } from "../config/schema";

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
    expect(parsed.schemaVersion).toBe(SCREEN_SPEC_SCHEMA_VERSION);
  });

  it("normalizes legacy specs without schemaVersion to the latest in-memory schema", () => {
    const legacy = {
      ...newScreenSpec({ title: "Legacy", description: "Old spec" }),
      schemaVersion: undefined,
      components: [{ name: "Button", dsKey: "button-key" }],
    };
    delete legacy.schemaVersion;

    const parsed = parseScreenSpec(legacy);

    expect(parsed.schemaVersion).toBe(SCREEN_SPEC_SCHEMA_VERSION);
    expect(parsed.components[0]?.resolution).toEqual({
      kind: "existing-ds",
      status: "approved",
      variablePolicy: "require-existing-variables",
    });
  });

  it("rejects specs from a future schema version with a readable field name", () => {
    expect(() =>
      parseScreenSpec({
        ...newScreenSpec({ title: "Future", description: "x" }),
        schemaVersion: SCREEN_SPEC_SCHEMA_VERSION + 1,
      })
    ).toThrow(/schemaVersion/);
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

  it("accepts component resolution decisions for missing design-system components", () => {
    const spec = newScreenSpec({ title: "Members", description: "x" });
    spec.components = [
      {
        name: "Member status toggle",
        usage: "Toggle a member between active and inactive",
        resolution: {
          kind: "create-draft-component",
          status: "planned",
          componentSpecRef: "components/member-status-toggle.component.json",
          variablePolicy: "require-existing-variables",
        },
      },
      {
        name: "Row action button",
        resolution: {
          kind: "inline-draft",
          status: "approved",
          variablePolicy: "allow-literals-after-user-confirmation",
        },
      },
    ];

    const parsed = ScreenSpecSchema.parse(spec);

    expect(parsed.components[0]?.resolution?.kind).toBe("create-draft-component");
    expect(parsed.components[0]?.resolution?.status).toBe("planned");
    expect(parsed.components[1]?.resolution?.kind).toBe("inline-draft");
  });

  it("defaults existing design-system components to existing-ds resolution", () => {
    const parsed = ScreenSpecSchema.parse({
      ...newScreenSpec({ title: "Members", description: "x" }),
      components: [{ name: "Button", dsKey: "button-key" }],
    });

    expect(parsed.components[0]?.resolution).toEqual({
      kind: "existing-ds",
      status: "approved",
      variablePolicy: "require-existing-variables",
    });
  });

  it("accepts a bound Figma draft target", () => {
    const parsed = parseScreenSpec({
      ...newScreenSpec({ title: "Members", description: "x" }),
      figmaTarget: {
        fileKey: "fig-file",
        pageId: "0:1",
        pageName: "Draft - Members",
        pageUrl: "https://www.figma.com/design/fig-file/App?node-id=0-1",
        boundAt: "2026-06-22T00:00:00.000Z",
        source: "user-url",
        section: { name: "kotikit / members / 2026-06-22" },
      },
    });

    expect(parsed.figmaTarget?.pageName).toBe("Draft - Members");
    expect(parsed.figmaTarget?.safety.allowPageCreation).toBe(false);
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
    expect(parsed.schemaVersion).toBe(FLOW_MANIFEST_SCHEMA_VERSION);
  });

  it("normalizes legacy flow manifests without schemaVersion to the latest in-memory schema", () => {
    const legacy = {
      ...newFlowManifest({
        title: "Checkout",
        description: "desc",
        screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
      }),
      schemaVersion: undefined,
    };
    delete legacy.schemaVersion;

    expect(parseFlowManifest(legacy).schemaVersion).toBe(FLOW_MANIFEST_SCHEMA_VERSION);
  });

  it("accepts a flow-level Figma draft target", () => {
    const parsed = parseFlowManifest({
      ...newFlowManifest({
        title: "Checkout",
        description: "desc",
        screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
      }),
      figmaTarget: {
        fileKey: "fig-file",
        pageId: "0:1",
        pageName: "Checkout Drafts",
        pageUrl: "https://www.figma.com/design/fig-file/App?node-id=0-1",
        boundAt: "2026-06-22T00:00:00.000Z",
        source: "user-url",
        section: { name: "kotikit / checkout / 2026-06-22" },
      },
    });

    expect(parsed.figmaTarget?.pageName).toBe("Checkout Drafts");
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
    expect(c.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(c.project.framework).toBe("react");
    expect(c.project.tests).toBe(true);
    expect(c.git.autoCommit).toBe(true);
    expect(c.defaults.breakpoints).toEqual([375, 768, 1024, 1440]);
  });
});
