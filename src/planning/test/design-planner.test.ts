import { describe, expect, it } from "bun:test";
import { defaultConfig } from "../../config/schema.js";
import { newScreenSpec } from "../../spec/schema.js";
import { DesignPlanSchema } from "../design-plan-schema.js";
import { generateDesignPlan } from "../design-planner.js";

describe("generateDesignPlan", () => {
  it("single-screen plan: pageName = PascalCase(scope), no `screen` field", () => {
    const spec = newScreenSpec({ title: "Profile Page", description: "User profile." });
    spec.requirements.states = { loading: "x", empty: "x", error: "x", filled: "x" };
    const plan = generateDesignPlan({
      scope: "profile-page",
      screen: null,
      spec,
      config: defaultConfig(),
    });
    expect(plan.pageName).toBe("ProfilePage");
    expect(plan.screen).toBeUndefined();
    expect(plan.states).toEqual(["loading", "empty", "error", "filled"]);
  });

  it("multi-screen plan: pageName = PascalCase(screen)", () => {
    const spec = newScreenSpec({
      title: "Cart",
      description: "x",
      flowRef: "checkout-flow/flow.json",
    });
    spec.requirements.states = { loading: "x" };
    const plan = generateDesignPlan({
      scope: "checkout-flow",
      screen: "cart",
      spec,
      config: defaultConfig(),
    });
    expect(plan.pageName).toBe("Cart");
    expect(plan.screen).toBe("cart");
  });

  it("4 states × 3 components: frames, root layouts, semantic zones, and placements", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.requirements.states = { loading: "x", empty: "x", error: "x", filled: "x" };
    spec.components = [
      { name: "Invite", usage: "Primary action" },
      { name: "Search", usage: "Search items", dsKey: "k1" },
      { name: "ItemList", usage: "Data list" },
    ];
    const plan = generateDesignPlan({
      scope: "cart",
      screen: null,
      spec,
      config: defaultConfig(),
    });

    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds.filter((k) => k === "define-state-frame")).toHaveLength(4);
    expect(kinds.filter((k) => k === "apply-auto-layout")).toHaveLength(4);
    expect(kinds.filter((k) => k === "define-layout-zone")).toHaveLength(16);
    expect(kinds.filter((k) => k === "place-component")).toHaveLength(12);
    expect(plan.steps).toHaveLength(36);
  });

  it("no states declared → defaults to ['default']", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = {};
    const plan = generateDesignPlan({ scope: "x", screen: null, spec, config: defaultConfig() });
    expect(plan.states).toEqual(["default"]);
    expect(plan.steps.some((s) => s.kind === "define-state-frame" && s.state === "default")).toBe(
      true
    );
  });

  it("dsKey copied from spec.components[].dsKey when present", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.components = [{ name: "Button", dsKey: "k123" }, { name: "Input" }];
    const plan = generateDesignPlan({ scope: "x", screen: null, spec, config: defaultConfig() });
    const placeSteps = plan.steps.filter((s) => s.kind === "place-component");
    expect(placeSteps).toHaveLength(2);
    const btn = placeSteps.find((s: { componentName?: string }) => s.componentName === "Button");
    const inp = placeSteps.find((s: { componentName?: string }) => s.componentName === "Input");
    expect((btn as { dsKey?: string }).dsKey).toBe("k123");
    expect((inp as { dsKey?: string }).dsKey).toBeUndefined();
  });

  it("components are placed into generic layout zones with semantic roles", () => {
    const spec = newScreenSpec({ title: "Members", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.components = [
      { name: "Invite member", usage: "Primary action", dsKey: "invite-key" },
      { name: "Search field", usage: "Find members", dsKey: "search-key" },
      { name: "Status filter tabs", usage: "Filter members", dsKey: "tabs-key" },
      { name: "Members table", usage: "Data grid", dsKey: "table-key" },
      { name: "Status switch", usage: "Activate or deactivate", dsKey: "switch-key" },
      { name: "Remove action", usage: "Delete member", dsKey: "remove-key" },
    ];
    const plan = generateDesignPlan({
      scope: "members",
      screen: null,
      spec,
      config: defaultConfig(),
    });

    expect(plan.layout.placements.map((placement) => [placement.role, placement.zone])).toEqual([
      ["primary-action", "header-actions"],
      ["search-input", "controls"],
      ["filter-control", "controls"],
      ["data-display", "content"],
      ["binary-control", "content-toggles"],
      ["destructive-action", "content-actions"],
    ]);
    expect(
      plan.steps
        .filter((step) => step.kind === "place-component")
        .map((step) => [step.componentName, step.role, step.zone])
    ).toEqual([
      ["Invite member", "primary-action", "header-actions"],
      ["Search field", "search-input", "controls"],
      ["Status filter tabs", "filter-control", "controls"],
      ["Members table", "data-display", "content"],
      ["Status switch", "binary-control", "content-toggles"],
      ["Remove action", "destructive-action", "content-actions"],
    ]);
  });

  it("plan validates through DesignPlanSchema", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = { default: "x" };
    const plan = generateDesignPlan({ scope: "x", screen: null, spec, config: defaultConfig() });
    expect(() => DesignPlanSchema.parse(plan)).not.toThrow();
  });

  it("step ordering: state-by-state grouping", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = { a: "x", b: "x" };
    spec.components = [{ name: "C1" }];
    const plan = generateDesignPlan({ scope: "x", screen: null, spec, config: defaultConfig() });
    // First state's frame + auto-layout + component, then second state's
    expect(plan.steps[0]?.state).toBe("a");
    expect(plan.steps[1]?.state).toBe("a");
    expect(plan.steps[2]?.state).toBe("a");
    expect(plan.steps[3]?.state).toBe("a");
    expect(plan.steps[4]?.state).toBe("b");
    expect(plan.steps[5]?.state).toBe("b");
    expect(plan.steps[6]?.state).toBe("b");
    expect(plan.steps[7]?.state).toBe("b");
  });
});
