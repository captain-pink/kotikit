import { describe, it, expect } from "bun:test";
import { applyAll, type DesignPlan } from "../orchestrator.js";
import { FakeFigmaShim } from "../figma-shim-fake.js";

function basicPlan(): DesignPlan {
  return {
    version: 1,
    scope: "cart",
    pageName: "Cart",
    states: ["default"],
    steps: [
      { kind: "define-state-frame", state: "default", width: 1440, height: "auto" },
      { kind: "apply-auto-layout", state: "default", direction: "VERTICAL", padding: 24, itemSpacing: 16 },
      { kind: "place-component", state: "default", componentName: "Button", dsKey: "k-button" },
      { kind: "place-component", state: "default", componentName: "Input", dsKey: "k-input" },
    ],
    createdAt: "2026-05-29T00:00:00.000Z",
  };
}

describe("orchestrator.applyAll", () => {
  it("4-step happy path: all ok", async () => {
    const shim = new FakeFigmaShim();
    shim.fileKey = "fig-file";
    const results = await applyAll({ shim, plan: basicPlan() });
    expect(results).toHaveLength(4);
    expect(results.every(r => r.outcome === "ok")).toBe(true);
    expect(results[0]?.fileKey).toBe("fig-file");
    expect(results[0]?.page?.name).toBe("Cart");
    expect(results[0]?.node?.kind).toBe("frame");
    expect(results[2]?.node?.kind).toBe("instance");
    expect(results[2]?.componentName).toBe("Button");
    expect(results[2]?.dsKey).toBe("k-button");
  });

  it("place-component with no dsKey is warned (others still execute)", async () => {
    const shim = new FakeFigmaShim();
    const plan = basicPlan();
    (plan.steps[2] as { dsKey?: string }).dsKey = undefined;
    const results = await applyAll({ shim, plan });
    expect(results[2]?.outcome).toBe("warned");
    expect(results[3]?.outcome).toBe("ok");  // next step still runs
  });

  it("bind-variable with unknown name is warned", async () => {
    const shim = new FakeFigmaShim();
    const plan = basicPlan();
    plan.steps.push({ kind: "bind-variable", state: "default", variableName: "brand/missing", property: "fill" });
    const results = await applyAll({ shim, plan });
    const bindResult = results[results.length - 1];
    expect(bindResult?.outcome).toBe("warned");
    expect(bindResult?.note).toContain("variable not found");
  });

  it("bind-variable with seeded variable succeeds", async () => {
    const shim = new FakeFigmaShim();
    shim.seedVariable("brand/primary", "var-1");
    const plan = basicPlan();
    plan.steps.push({ kind: "bind-variable", state: "default", variableName: "brand/primary", property: "fill" });
    const results = await applyAll({ shim, plan });
    expect(results[results.length - 1]?.outcome).toBe("ok");
    expect(shim.bindings).toHaveLength(1);
    expect(shim.bindings[0]?.variableId).toBe("var-1");
  });

  it("a throwing shim call is recorded as failed; subsequent steps still execute", async () => {
    const shim = new FakeFigmaShim();
    shim.throwOn = { method: "importComponentByKey" };
    const results = await applyAll({ shim, plan: basicPlan() });
    expect(results[2]?.outcome).toBe("failed");
    expect(results[3]?.outcome).toBe("failed"); // also fails — same throw still set
  });

  it("state-frame map: a second place-component step targets the SAME frame", async () => {
    const shim = new FakeFigmaShim();
    const results = await applyAll({ shim, plan: basicPlan() });
    expect(results.every(r => r.outcome === "ok")).toBe(true);
    // Verify exactly one frame was created
    const frames = Array.from(shim.nodes.values()).filter(n => n.type === "FRAME");
    expect(frames).toHaveLength(1);
    // Both instances appended to the same frame
    expect(frames[0]?.children.length).toBe(2);
  });

  it("onStep callback fires for each step", async () => {
    const shim = new FakeFigmaShim();
    const calls: number[] = [];
    await applyAll({ shim, plan: basicPlan(), onStep: r => calls.push(r.stepIndex) });
    expect(calls).toEqual([0, 1, 2, 3]);
  });

  it("multi-state plan: separate frames per state", async () => {
    const shim = new FakeFigmaShim();
    const plan: DesignPlan = {
      ...basicPlan(),
      states: ["default", "loading"],
      steps: [
        { kind: "define-state-frame", state: "default", width: 1440, height: "auto" },
        { kind: "apply-auto-layout", state: "default", direction: "VERTICAL", padding: 24, itemSpacing: 16 },
        { kind: "place-component", state: "default", componentName: "Header", dsKey: "k-header" },
        { kind: "define-state-frame", state: "loading", width: 1440, height: "auto" },
        { kind: "apply-auto-layout", state: "loading", direction: "VERTICAL", padding: 24, itemSpacing: 16 },
        { kind: "place-component", state: "loading", componentName: "Spinner", dsKey: "k-spinner" },
      ],
    };
    const results = await applyAll({ shim, plan });
    expect(results.every(r => r.outcome === "ok")).toBe(true);
    const frames = Array.from(shim.nodes.values()).filter(n => n.type === "FRAME");
    expect(frames).toHaveLength(2);
  });
});
