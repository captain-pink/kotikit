import { describe, it, expect } from "bun:test";
import { applyAll, type DesignPlan } from "../orchestrator.js";
import { FakeFigmaShim } from "../figma-shim-fake.js";

function basicPlan(): DesignPlan {
  return {
    version: 1,
    scope: "cart",
    pageName: "Cart",
    target: {
      fileKey: "fig-file",
      pageId: "page-1",
      pageName: "Draft - Cart",
      pageUrl: "https://www.figma.com/design/fig-file/App?node-id=page-1",
      boundAt: "2026-06-22T00:00:00.000Z",
      source: "user-url",
      section: { name: "kotikit / cart / 2026-06-22" },
      safety: {
        requireDraftPageName: true,
        allowPageCreation: false,
        requireKotikitSection: true,
      },
    },
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

function makeShim(pageName = "Draft - Cart"): FakeFigmaShim {
  const shim = new FakeFigmaShim();
  shim.fileKey = "fig-file";
  shim.seedPage("page-1", pageName);
  return shim;
}

describe("orchestrator.applyAll", () => {
  it("4-step happy path: all ok", async () => {
    const shim = makeShim();
    const results = await applyAll({ shim, plan: basicPlan() });
    expect(results).toHaveLength(4);
    expect(results.every(r => r.outcome === "ok")).toBe(true);
    expect(results[0]?.fileKey).toBe("fig-file");
    expect(results[0]?.page?.name).toBe("Draft - Cart");
    expect(results[0]?.node?.kind).toBe("frame");
    expect(results[2]?.node?.kind).toBe("instance");
    expect(results[2]?.componentName).toBe("Button");
    expect(results[2]?.dsKey).toBe("k-button");
    const sections = Array.from(shim.nodes.values()).filter(n => n.type === "SECTION");
    const frames = Array.from(shim.nodes.values()).filter(n => n.type === "FRAME");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.name).toBe("kotikit / cart / 2026-06-22");
    expect(frames[0]?.parentId).toBe(sections[0]?.id);
  });

  it("fails closed when a design plan has no target", async () => {
    const shim = makeShim();
    const { target: _target, ...legacyPlan } = basicPlan();

    await expect(applyAll({ shim, plan: legacyPlan })).rejects.toThrow(/target/);
  });

  it("fails closed when the open Figma file does not match the target", async () => {
    const shim = makeShim();
    shim.fileKey = "other-file";

    await expect(applyAll({ shim, plan: basicPlan() })).rejects.toThrow(/different Figma file/);
  });

  it("fails closed when the target page no longer looks like a draft page", async () => {
    const shim = makeShim("Production");

    await expect(applyAll({ shim, plan: basicPlan() })).rejects.toThrow(/Draft/);
  });

  it("place-component with no dsKey is warned (others still execute)", async () => {
    const shim = makeShim();
    const plan = basicPlan();
    (plan.steps[2] as { dsKey?: string }).dsKey = undefined;
    const results = await applyAll({ shim, plan });
    expect(results[2]?.outcome).toBe("warned");
    expect(results[3]?.outcome).toBe("ok");  // next step still runs
  });

  it("bind-variable with unknown name is warned", async () => {
    const shim = makeShim();
    const plan = basicPlan();
    plan.steps.push({ kind: "bind-variable", state: "default", variableName: "brand/missing", property: "fill" });
    const results = await applyAll({ shim, plan });
    const bindResult = results[results.length - 1];
    expect(bindResult?.outcome).toBe("warned");
    expect(bindResult?.note).toContain("variable not found");
  });

  it("bind-variable with seeded variable succeeds", async () => {
    const shim = makeShim();
    shim.seedVariable("brand/primary", "var-1");
    const plan = basicPlan();
    plan.steps.push({ kind: "bind-variable", state: "default", variableName: "brand/primary", property: "fill" });
    const results = await applyAll({ shim, plan });
    expect(results[results.length - 1]?.outcome).toBe("ok");
    expect(shim.bindings).toHaveLength(1);
    expect(shim.bindings[0]?.variableId).toBe("var-1");
  });

  it("a throwing shim call is recorded as failed; subsequent steps still execute", async () => {
    const shim = makeShim();
    shim.throwOn = { method: "importComponentByKey" };
    const results = await applyAll({ shim, plan: basicPlan() });
    expect(results[2]?.outcome).toBe("failed");
    expect(results[3]?.outcome).toBe("failed"); // also fails — same throw still set
  });

  it("state-frame map: a second place-component step targets the SAME frame", async () => {
    const shim = makeShim();
    const results = await applyAll({ shim, plan: basicPlan() });
    expect(results.every(r => r.outcome === "ok")).toBe(true);
    // Verify exactly one frame was created
    const frames = Array.from(shim.nodes.values()).filter(n => n.type === "FRAME");
    expect(frames).toHaveLength(1);
    // Both instances appended to the same frame
    expect(frames[0]?.children.length).toBe(2);
  });

  it("semantic layout zones receive their assigned component instances", async () => {
    const shim = makeShim();
    const plan: DesignPlan = {
      ...basicPlan(),
      steps: [
        { kind: "define-state-frame", state: "default", width: 1440, height: "auto" },
        { kind: "apply-auto-layout", state: "default", direction: "VERTICAL", padding: 24, itemSpacing: 16 },
        {
          kind: "define-layout-zone",
          state: "default",
          zone: "controls",
          parentZone: "root",
          direction: "HORIZONTAL",
          padding: 0,
          itemSpacing: 12,
          minTargetSize: 44,
        },
        {
          kind: "place-component",
          state: "default",
          componentName: "Search field",
          dsKey: "k-search",
          role: "search-input",
          zone: "controls",
        },
      ],
    };

    const results = await applyAll({ shim, plan });
    const zoneResult = results.find((result) => result.stepKind === "define-layout-zone");
    const placeResult = results.find((result) => result.stepKind === "place-component");
    const zoneNode = zoneResult?.node?.id ? shim.nodes.get(zoneResult.node.id) : undefined;

    expect(results.every((result) => result.outcome === "ok")).toBe(true);
    expect(zoneNode?.layoutMode).toBe("HORIZONTAL");
    expect(zoneNode?.children).toContain(placeResult?.node?.id);
    expect(placeResult).toMatchObject({
      role: "search-input",
      zone: "controls",
    });
  });

  it("onStep callback fires for each step", async () => {
    const shim = makeShim();
    const calls: number[] = [];
    await applyAll({ shim, plan: basicPlan(), onStep: r => calls.push(r.stepIndex) });
    expect(calls).toEqual([0, 1, 2, 3]);
  });

  it("multi-state plan: separate frames per state", async () => {
    const shim = makeShim();
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
