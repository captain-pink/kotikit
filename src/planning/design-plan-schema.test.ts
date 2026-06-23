import { describe, expect, it } from "bun:test";
import { KotikitError } from "../util/result.js";
import { DesignPlanSchema, DesignPlanStepSchema, parseDesignPlan } from "./design-plan-schema.js";

function validPlan() {
  return {
    version: 1 as const,
    scope: "cart",
    pageName: "Cart",
    states: ["default", "loading"],
    layout: {
      version: 1 as const,
      strategy: "semantic-zones",
      zones: [
        {
          id: "content",
          parent: "root",
          direction: "VERTICAL",
          padding: 0,
          itemSpacing: 16,
          minTargetSize: 44,
        },
      ],
      placements: [
        {
          componentName: "Button",
          role: "primary-action",
          zone: "content",
        },
      ],
    },
    steps: [
      { kind: "define-state-frame", state: "default" },
      { kind: "apply-auto-layout", state: "default" },
      {
        kind: "define-layout-zone",
        state: "default",
        zone: "content",
        parentZone: "root",
        direction: "VERTICAL",
      },
      {
        kind: "place-component",
        state: "default",
        componentName: "Button",
        dsKey: "abc",
        role: "primary-action",
        zone: "content",
      },
      { kind: "bind-variable", state: "default", variableName: "brand/primary" },
    ],
    createdAt: "2026-05-29T10:00:00.000Z",
  };
}

describe("DesignPlanSchema", () => {
  it("parses a valid plan with all step kinds and a semantic layout contract", () => {
    expect(() => DesignPlanSchema.parse(validPlan())).not.toThrow();
  });

  it("fills defaults: width=1440, height='auto'", () => {
    const plan = validPlan();
    const parsed = DesignPlanSchema.parse(plan);
    const frame = parsed.steps[0]!;
    expect(frame).toMatchObject({ kind: "define-state-frame", width: 1440, height: "auto" });
  });

  it("fills auto-layout defaults: direction=VERTICAL, padding=24, itemSpacing=16", () => {
    const plan = validPlan();
    const parsed = DesignPlanSchema.parse(plan);
    const al = parsed.steps[1]!;
    expect(al).toMatchObject({
      kind: "apply-auto-layout",
      direction: "VERTICAL",
      padding: 24,
      itemSpacing: 16,
    });
  });

  it("fills layout-zone defaults for stable target regions", () => {
    const parsed = DesignPlanSchema.parse(validPlan());
    const zone = parsed.steps[2]!;
    expect(zone).toMatchObject({
      kind: "define-layout-zone",
      parentZone: "root",
      direction: "VERTICAL",
      padding: 0,
      itemSpacing: 16,
      minTargetSize: 44,
    });
  });

  it("fills bind-variable defaults: property=fill", () => {
    const plan = validPlan();
    const parsed = DesignPlanSchema.parse(plan);
    const bind = parsed.steps[4]!;
    expect(bind).toMatchObject({ kind: "bind-variable", property: "fill" });
  });

  it("rejects unknown step kind", () => {
    const plan = validPlan();
    (plan.steps as unknown[]).push({ kind: "fake-step", state: "default" });
    expect(() => DesignPlanSchema.parse(plan)).toThrow();
  });

  it("rejects empty states array", () => {
    const plan = validPlan();
    plan.states = [];
    expect(() => DesignPlanSchema.parse(plan)).toThrow();
  });

  it("rejects empty steps array", () => {
    const plan = validPlan();
    plan.steps = [];
    expect(() => DesignPlanSchema.parse(plan)).toThrow();
  });

  it("rejects width <= 0", () => {
    const plan = validPlan();
    (plan.steps[0] as { width?: number }).width = -10;
    expect(() => DesignPlanSchema.parse(plan)).toThrow();
  });

  it("accepts height as 'auto' OR positive integer", () => {
    const planA = validPlan();
    (planA.steps[0] as { height?: number | "auto" }).height = 900;
    expect(() => DesignPlanSchema.parse(planA)).not.toThrow();

    const planB = validPlan();
    (planB.steps[0] as { height?: number | "auto" }).height = "auto";
    expect(() => DesignPlanSchema.parse(planB)).not.toThrow();
  });

  it("place-component variant is optional Record<string, string>", () => {
    const plan = validPlan();
    (plan.steps[3] as { variant?: Record<string, string> }).variant = {
      Variant: "Primary",
      Size: "md",
    };
    expect(() => DesignPlanSchema.parse(plan)).not.toThrow();
  });

  it("place-component accepts generic role and zone metadata", () => {
    const parsed = DesignPlanSchema.parse(validPlan());
    expect(parsed.steps[3]).toMatchObject({
      kind: "place-component",
      role: "primary-action",
      zone: "content",
    });
  });

  it("back-fills an empty layout contract for older design plans", () => {
    const { layout: _layout, ...legacyPlan } = validPlan();
    const parsed = DesignPlanSchema.parse(legacyPlan);
    expect(parsed.layout).toEqual({
      version: 1,
      strategy: "semantic-zones",
      zones: [],
      placements: [],
    });
  });

  it("accepts a bound Figma draft target", () => {
    const parsed = DesignPlanSchema.parse({
      ...validPlan(),
      target: {
        fileKey: "fig-file",
        pageId: "0:1",
        pageName: "Draft - Cart",
        pageUrl: "https://www.figma.com/design/fig-file/App?node-id=0-1",
        boundAt: "2026-06-22T00:00:00.000Z",
        source: "user-url",
        section: { name: "kotikit / cart / 2026-06-22" },
      },
    });

    expect(parsed.target?.pageName).toBe("Draft - Cart");
    expect(parsed.target?.safety.requireKotikitSection).toBe(true);
  });
});

describe("parseDesignPlan", () => {
  it("returns the parsed plan on valid input", () => {
    const parsed = parseDesignPlan(validPlan());
    expect(parsed.scope).toBe("cart");
  });

  it("throws KotikitError on schema mismatch with field names", () => {
    const bad = { ...validPlan(), version: 999 };
    expect(() => parseDesignPlan(bad)).toThrow(KotikitError);
    try {
      parseDesignPlan(bad);
    } catch (e) {
      expect((e as KotikitError).userMessage).toContain("invalid format");
    }
  });

  it("throws on missing required fields", () => {
    const bad = { ...validPlan(), scope: undefined };
    expect(() => parseDesignPlan(bad)).toThrow(KotikitError);
  });
});

describe("DesignPlanStepSchema (direct)", () => {
  it("validates each step kind in isolation", () => {
    expect(() =>
      DesignPlanStepSchema.parse({ kind: "define-state-frame", state: "x" })
    ).not.toThrow();
    expect(() =>
      DesignPlanStepSchema.parse({ kind: "apply-auto-layout", state: "x" })
    ).not.toThrow();
    expect(() =>
      DesignPlanStepSchema.parse({ kind: "define-layout-zone", state: "x", zone: "content" })
    ).not.toThrow();
    expect(() =>
      DesignPlanStepSchema.parse({ kind: "place-component", state: "x", componentName: "Button" })
    ).not.toThrow();
    expect(() =>
      DesignPlanStepSchema.parse({ kind: "bind-variable", state: "x", variableName: "brand" })
    ).not.toThrow();
  });
});
