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

  it("keeps create-screen compose-first without pre-screen draft component writes", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = flows.find((flow) => flow.id === "create-screen");
    if (createScreen === undefined) throw new Error("Missing create-screen flow.");

    const nodeUses = createScreen.nodes.map((node) => node.uses);
    expect(createScreen.requiredCapabilities).not.toContain("draftComponents.write");
    expect(nodeUses).not.toContain("designSystem.askMissingComponentDecision");
    expect(nodeUses).not.toContain("draftComponents.planMissing");
    expect(nodeUses).not.toContain("draftComponents.createOnDraftPage");
    expect(nodeUses).not.toContain("draftComponents.validateCreated");
    expect(nodeUses).not.toContain("draftComponents.buildLifecycle");
    expect(nodeUses).not.toContain("draftComponents.verifyLifecycle");
    expect(nodeIndex(createScreen, "ux.buildEnvelope")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "ux.planStateMatrix")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "designSystem.saveReusePlan")).toBeLessThan(
      nodeIndex(createScreen, "ui.buildCompositionContract")
    );
    expect(nodeIndex(createScreen, "figma.ensureDraftTarget")).toBeLessThan(
      nodeIndex(createScreen, "draft.buildCanvasPlan")
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
      nodeIndex(createScreen, "figma.verifyDraftInvariants")
    );
    expect(nodeIndex(createScreen, "figma.saveApplyReport")).toBeGreaterThan(
      nodeIndex(createScreen, "figma.verifyDraftInvariants")
    );
    expect(nodeIndex(createScreen, "figma.saveApplyReport")).toBeLessThan(
      nodeIndex(createScreen, "qa.runUiQualityGate")
    );
  });

  it("builds incremental Figma plans before the apply packet in create-screen", async () => {
    const flows = await loadBuiltInFlows();
    const createScreen = flows.find((flow) => flow.id === "create-screen");
    if (createScreen === undefined) throw new Error("Missing create-screen flow.");

    expect(nodeIndex(createScreen, "figma.ensureDraftTarget")).toBeLessThan(
      nodeIndex(createScreen, "draft.buildCanvasPlan")
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

  it("keeps stale optional flows out of the tiny built-in core", async () => {
    const flows = await loadBuiltInFlows();

    expect(flows.map((flow) => flow.id)).toEqual(["create-screen", "review-screen"]);
    expect(flows.flatMap((flow) => flow.nodes.map((node) => node.uses))).not.toEqual(
      expect.arrayContaining([
        "draftComponents.createOnDraftPage",
        "flow.mapUserFlow",
        "review.collectEvidence",
        "comments.buildEvidenceMap",
        "memory.promotePreference",
      ])
    );
  });

  it("registers lightweight feedback nodes without the stale review stack", () => {
    const registry = createBuiltInNodeRegistry();

    expect(registry.has("brief.classifyIntent")).toBe(true);
    expect(registry.has("figma.applyTransactionQueue")).toBe(true);
    expect(registry.has("qa.runUiQualityGate")).toBe(true);
    expect(registry.has("feedback.buildEvidenceMap")).toBe(true);
    expect(registry.has("feedback.createRevisionPlan")).toBe(true);
    expect(registry.has("feedback.askRevisionApproval")).toBe(true);
    expect(registry.has("draftComponents.createOnDraftPage")).toBe(false);
    expect(registry.has("flow.mapUserFlow")).toBe(false);
    expect(registry.has("review.collectEvidence")).toBe(false);
    expect(registry.has("comments.buildEvidenceMap")).toBe(false);
    expect(registry.has("memory.promotePreference")).toBe(false);
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
