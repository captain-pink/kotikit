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

    expect(nodeIndex(createScreen, "ux.buildEnvelope")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "ux.planStateMatrix")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
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

  it("applies Figma transactions incrementally before post-apply QA", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = flows.find((flow) => flow.id === "create-screen");
    if (createScreen === undefined) throw new Error("Missing create-screen flow.");

    expect(createScreen.nodes.map((node) => node.uses)).not.toContain("figma.waitForApplyMetadata");
    expect(createScreen.nodes.map((node) => node.uses)).not.toContain("figma.recordApplyMetadata");
    expect(nodeIndex(createScreen, "figma.applyTransactionQueue")).toBeGreaterThan(
      nodeIndex(createScreen, "draft.buildFigmaApplyPacket")
    );
    expect(nodeIndex(createScreen, "figma.applyTransactionQueue")).toBeLessThan(
      nodeIndex(createScreen, "draftComponents.buildLifecycle")
    );
    expect(nodeIndex(createScreen, "draftComponents.buildLifecycle")).toBeLessThan(
      nodeIndex(createScreen, "figma.verifyDraftInvariants")
    );
    expect(nodeIndex(createScreen, "figma.saveApplyReport")).toBeGreaterThan(
      nodeIndex(createScreen, "figma.verifyDraftInvariants")
    );
    expect(nodeIndex(createScreen, "figma.saveApplyReport")).toBeLessThan(
      nodeIndex(createScreen, "qa.runUiQualityGate")
    );
  });

  it("builds incremental Figma plans before draft writes and the apply packet in create-screen", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = flows.find((flow) => flow.id === "create-screen");
    if (createScreen === undefined) throw new Error("Missing create-screen flow.");

    expect(nodeIndex(createScreen, "figma.ensureDraftTarget")).toBeLessThan(
      nodeIndex(createScreen, "draft.buildCanvasPlan")
    );
    expect(nodeIndex(createScreen, "draft.buildCanvasPlan")).toBeLessThan(
      nodeIndex(createScreen, "draftComponents.createOnDraftPage")
    );
    expect(nodeIndex(createScreen, "draft.compileHighFidelityDraft")).toBeGreaterThan(
      nodeIndex(createScreen, "draft.buildCanvasPlan")
    );
    expect(nodeIndex(createScreen, "draft.buildCanvasPlan")).toBeLessThan(
      nodeIndex(createScreen, "draft.buildFigmaTransactionPlan")
    );
    expect(nodeIndex(createScreen, "draft.buildFigmaTransactionPlan")).toBeLessThan(
      nodeIndex(createScreen, "draft.buildFigmaApplyPacket")
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

  it("grounds improve-existing-design in local design-system evidence before comparison", async () => {
    const flows = await loadBuiltInFlows();
    const improve = flows.find((flow) => flow.id === "improve-existing-design");
    if (improve === undefined) throw new Error("Missing improve-existing-design flow.");

    expect(nodeIndex(improve, "review.collectEvidence")).toBeLessThan(
      nodeIndex(improve, "designSystem.searchLocal")
    );
    expect(nodeIndex(improve, "designSystem.searchLocal")).toBeLessThan(
      nodeIndex(improve, "review.compareToDesignSystem")
    );
  });

  it("saves review comment sessions and prepares comments only after approval", async () => {
    const flows = await loadBuiltInFlows();
    const reviewComments = flows.find((flow) => flow.id === "review-comments");
    if (reviewComments === undefined) throw new Error("Missing review-comments flow.");
    const approvalNode = reviewComments.nodes.find((node) => node.uses === "review.askApproval");

    expect(nodeIndex(reviewComments, "review.askApproval")).toBeLessThan(
      nodeIndex(reviewComments, "review.saveSession")
    );
    expect(nodeIndex(reviewComments, "review.saveSession")).toBeLessThan(
      nodeIndex(reviewComments, "review.prepareApprovedComments")
    );
    expect(nodeIndex(reviewComments, "review.prepareApprovedComments")).toBeLessThan(
      nodeIndex(reviewComments, "memory.detectPreferenceCandidate")
    );
    expect(approvalNode?.params).toMatchObject({
      requiresRevisionApproval: false,
      requiresCommentApproval: true,
    });
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
