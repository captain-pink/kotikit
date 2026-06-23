import { describe, expect, it } from "bun:test";
import { defaultConfig } from "../config/schema.js";
import { newScreenSpec } from "../spec/schema.js";
import { CodePlanSchema } from "./code-plan-schema.js";
import { generateCodePlan } from "./code-planner.js";

describe("generateCodePlan", () => {
  it("single-screen plan: correct componentName, targetPath, testPath", () => {
    const spec = newScreenSpec({ title: "Profile Page", description: "User profile." });
    spec.requirements.states = { loading: "Spinner", empty: "X", error: "X", filled: "X" };
    const plan = generateCodePlan({
      root: "/proj",
      scope: "profile-page",
      screen: null,
      spec,
      config: defaultConfig(),
    });
    expect(plan.componentName).toBe("ProfilePage");
    expect(plan.targetPath).toBe("src/components/profile-page/ProfilePage.tsx");
    expect(plan.testPath).toBe("src/components/profile-page/ProfilePage.test.tsx");
    expect(plan.screen).toBeUndefined();
  });

  it("multi-screen plan: componentName from screen slug", () => {
    const spec = newScreenSpec({
      title: "Cart",
      description: "x",
      flowRef: "checkout-flow/flow.json",
    });
    spec.requirements.states = { loading: "x" };
    const plan = generateCodePlan({
      root: "/proj",
      scope: "checkout-flow",
      screen: "cart",
      spec,
      config: defaultConfig(),
    });
    expect(plan.componentName).toBe("Cart");
    expect(plan.targetPath).toBe("src/components/checkout-flow/Cart.tsx");
    expect(plan.screen).toBe("cart");
  });

  it("tests: false → no testPath, no generate-test step", () => {
    const cfg = defaultConfig();
    cfg.project.tests = false;
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = {};
    const plan = generateCodePlan({ root: "/proj", scope: "x", screen: null, spec, config: cfg });
    expect(plan.testPath).toBeUndefined();
    expect(plan.steps.find((s) => s.kind === "generate-test")).toBeUndefined();
  });

  it("testFramework: none → no testPath, no generate-test step", () => {
    const cfg = defaultConfig();
    cfg.project.testFramework = "none";
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = {};
    const plan = generateCodePlan({ root: "/proj", scope: "x", screen: null, spec, config: cfg });
    expect(plan.testPath).toBeUndefined();
    expect(plan.steps.find((s) => s.kind === "generate-test")).toBeUndefined();
  });

  it("4 state keys → compose-states has 4 notes", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.requirements.states = { loading: "a", empty: "b", error: "c", filled: "d" };
    const plan = generateCodePlan({
      root: "/proj",
      scope: "cart",
      screen: null,
      spec,
      config: defaultConfig(),
    });
    const stateStep = plan.steps.find((s) => s.kind === "compose-states");
    expect(stateStep?.notes.length).toBe(4);
  });

  it("plan validates through CodePlanSchema", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = {};
    const plan = generateCodePlan({
      root: "/proj",
      scope: "x",
      screen: null,
      spec,
      config: defaultConfig(),
    });
    expect(() => CodePlanSchema.parse(plan)).not.toThrow();
  });

  it("dsComponentRefs copied from spec.components", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = {};
    spec.components = [{ name: "Button", dsKey: "k1" }, { name: "Input" }];
    const plan = generateCodePlan({
      root: "/proj",
      scope: "x",
      screen: null,
      spec,
      config: defaultConfig(),
    });
    expect(plan.dsComponentRefs).toHaveLength(2);
    expect(plan.dsComponentRefs[0]).toEqual({ name: "Button", dsKey: "k1" });
    expect(plan.dsComponentRefs[1]).toEqual({ name: "Input" });
  });

  it("steps are in canonical order", () => {
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = { loading: "a" };
    const plan = generateCodePlan({
      root: "/proj",
      scope: "x",
      screen: null,
      spec,
      config: defaultConfig(),
    });
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      "scaffold-component",
      "compose-states",
      "compose-interactions",
      "compose-accessibility",
      "compose-responsive",
      "generate-test",
    ]);
  });
});
