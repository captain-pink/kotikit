import { describe, expect, it } from "bun:test";
import { loadBuiltInFlows } from "../../flows/catalog.js";
import { compileFlowDefinition } from "../../graph/compiler.js";
import { createBuiltInNodeRegistry } from "../built-in-registry.js";

describe("built-in node registry", () => {
  it("compiles built-in flows against the real implemented node definitions", async () => {
    const flows = await loadBuiltInFlows();
    const registry = createBuiltInNodeRegistry();

    flows.forEach((flow) => {
      expect(() =>
        compileFlowDefinition(flow, registry, { allowedCapabilities: flow.requiredCapabilities })
      ).not.toThrow();
    });
  });

  it("runs missing component preflight before screen composition in create-screen", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = flows.find((flow) => flow.id === "create-screen");
    if (createScreen === undefined) throw new Error("Missing create-screen flow.");

    expect(nodeIndex(createScreen, "draftComponents.planMissing")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "draftComponents.createOnDraftPage")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "draftComponents.validateCreated")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "figma.ensureDraftTarget")).toBeLessThan(
      nodeIndex(createScreen, "draftComponents.createOnDraftPage")
    );
  });

  it("records and saves Figma apply metadata before post-apply QA", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = flows.find((flow) => flow.id === "create-screen");
    if (createScreen === undefined) throw new Error("Missing create-screen flow.");

    expect(nodeIndex(createScreen, "figma.recordApplyMetadata")).toBeGreaterThan(
      nodeIndex(createScreen, "figma.waitForApplyMetadata")
    );
    expect(nodeIndex(createScreen, "figma.recordApplyMetadata")).toBeLessThan(
      nodeIndex(createScreen, "figma.verifyDraftInvariants")
    );
    expect(nodeIndex(createScreen, "figma.saveApplyReport")).toBeGreaterThan(
      nodeIndex(createScreen, "figma.verifyDraftInvariants")
    );
    expect(nodeIndex(createScreen, "figma.saveApplyReport")).toBeLessThan(
      nodeIndex(createScreen, "qa.runUiQualityGate")
    );
  });

  it("ensures a safe target before missing-component draft creation", async () => {
    const flows = await loadBuiltInFlows();
    const resolveMissing = flows.find((flow) => flow.id === "resolve-missing-components");
    if (resolveMissing === undefined) throw new Error("Missing resolve-missing-components flow.");

    expect(resolveMissing.requiredCapabilities).toContain("figma.target");
    expect(nodeIndex(resolveMissing, "figma.ensureDraftTarget")).toBeLessThan(
      nodeIndex(resolveMissing, "draftComponents.createOnDraftPage")
    );
  });

  it("ensures a safe target before product-flow draft component creation", async () => {
    const flows = await loadBuiltInFlows();
    const productFlow = flows.find((flow) => flow.id === "create-product-flow");
    if (productFlow === undefined) throw new Error("Missing create-product-flow flow.");

    expect(nodeIndex(productFlow, "figma.ensureDraftTarget")).toBeLessThan(
      nodeIndex(productFlow, "draftComponents.createOnDraftPage")
    );
  });

  it("does not run post-apply QA in the missing-component resolver", async () => {
    const flows = await loadBuiltInFlows();
    const resolveMissing = flows.find((flow) => flow.id === "resolve-missing-components");
    if (resolveMissing === undefined) throw new Error("Missing resolve-missing-components flow.");

    expect(resolveMissing.nodes.map((node) => node.uses)).not.toContain("qa.runUiQualityGate");
  });

  it("does not run post-apply QA in product-flow drafts before apply metadata exists", async () => {
    const flows = await loadBuiltInFlows();
    const productFlow = flows.find((flow) => flow.id === "create-product-flow");
    if (productFlow === undefined) throw new Error("Missing create-product-flow flow.");

    expect(productFlow.nodes.map((node) => node.uses)).not.toContain("qa.runUiQualityGate");
  });
});

function nodeIndex(
  flow: Awaited<ReturnType<typeof loadBuiltInFlows>>[number],
  uses: string
): number {
  const index = flow.nodes.findIndex((node) => node.uses === uses);
  if (index === -1) throw new Error(`Missing node ${uses}.`);
  return index;
}
