import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeApplyMetadataFor,
  fakeDraftTarget,
  seedLocalDesignSystem,
} from "./fixtures/fake-figma.js";

describe("create-screen graph flow", () => {
  it("quick lane resolves a missing component, waits for fake apply, and saves QA", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-create-screen-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { artifactStore, runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Smoke Project" },
          userIntent:
            "Quick high-fidelity profile settings form using existing design-system components.",
          figmaTarget: fakeDraftTarget("Draft - Profile Settings"),
        },
      });

      expect(started.status).toBe("waiting-for-user");
      expect(started.state.pendingQuestion?.id).toBe("missing-components");
      expect(started.state.uxEnvelope).toMatchObject({
        schemaVersion: "UXEnvelope/v1",
      });
      expect(started.state.stateMatrix).toMatchObject({
        schemaVersion: "StateMatrix/v1",
      });

      const missingResolved = await runtime.answerRun({
        runId: started.runId,
        answer: "create-draft-components",
      });
      expect(missingResolved.status).toBe("waiting-for-user");
      expect(missingResolved.state.pendingQuestion?.id).toBe("approve-literal-variable-fallback");
      expect(missingResolved.state.draftComponentPlan?.components).toContainEqual(
        expect.objectContaining({ name: "secondary action" })
      );

      const waitingForApply = await runtime.answerRun({
        runId: started.runId,
        answer: "approve-draft-only-literals",
      });
      expect(waitingForApply.status).toBe("waiting-for-figma");
      expect(waitingForApply.state.draftPlan).toMatchObject({
        fidelity: "high",
        applyPacket: expect.any(Object),
      });
      expect(waitingForApply.state.uiComposition?.parts).toContainEqual(
        expect.objectContaining({
          name: "secondary action",
          source: "draft-component",
          componentKey: "draft:draft-secondary-action",
        })
      );
      expect(waitingForApply.state.stateRepresentation).toMatchObject({
        schemaVersion: "StateRepresentationContract/v1",
      });

      await expect(
        artifactStore.getArtifact(`${started.runId}-figma-apply-packet`)
      ).resolves.toMatchObject({
        type: "figma-apply-packet",
        payload: {
          data: {
            targetFileKey: "FILE_SMOKE",
            targetSectionName: "kotikit / smoke / 2026-06-30",
          },
        },
      });

      await runtime.patchRunState({
        runId: started.runId,
        statePatch: { applyMetadata: fakeApplyMetadataFor(waitingForApply.state) },
      });
      const completed = await runtime.continueRun({ runId: started.runId });

      expect(completed.status).toBe("done");
      expect(completed.state.draftComponentLifecycle).toMatchObject({
        schemaVersion: "DraftComponentLifecycle/v1",
        components: expect.arrayContaining([expect.objectContaining({ status: "used" })]),
      });
      expect(completed.state.uiQualityGate?.status).toBe("passed");
      expect(completed.state.artifacts.map((artifact) => artifact.type)).toEqual(
        expect.arrayContaining([
          "design-brief",
          "ux-envelope",
          "state-matrix",
          "figma-apply-packet",
          "figma-apply-report",
          "draft-component-lifecycle",
          "ui-quality-gate-report",
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("guided lane pauses for brief approval before creating the draft artifact chain", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-create-screen-"));
    try {
      seedLocalDesignSystem(root, { includeSecondaryAction: true });
      const { artifactStore, runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Smoke Project" },
          userIntent: "Design a profile settings form with account details and save actions.",
          figmaTarget: fakeDraftTarget("Draft - Guided Settings"),
        },
      });

      expect(started.status).toBe("waiting-for-user");
      expect(started.state.pendingQuestion?.id).toBe("approve-brief");
      expect(started.state.uxEnvelope).toMatchObject({
        schemaVersion: "UXEnvelope/v1",
      });
      expect(started.state.stateMatrix).toMatchObject({
        schemaVersion: "StateMatrix/v1",
      });

      const approved = await runtime.answerRun({
        runId: started.runId,
        answer: "approve-brief",
      });
      expect(approved.status).toBe("waiting-for-user");
      expect(approved.state.pendingQuestion?.id).toBe("approve-literal-variable-fallback");

      const waitingForApply = await runtime.answerRun({
        runId: started.runId,
        answer: "approve-draft-only-literals",
      });
      expect(waitingForApply.status).toBe("waiting-for-figma");
      expect(waitingForApply.state.stateRepresentation).toMatchObject({
        schemaVersion: "StateRepresentationContract/v1",
      });
      await expect(
        artifactStore.getArtifact(`${started.runId}-design-brief`)
      ).resolves.toMatchObject({
        type: "design-brief",
        payload: { summary: expect.stringContaining("Profile Settings") },
      });

      await runtime.patchRunState({
        runId: started.runId,
        statePatch: { applyMetadata: fakeApplyMetadataFor(waitingForApply.state) },
      });
      const completed = await runtime.continueRun({ runId: started.runId });

      expect(completed.status).toBe("done");
      expect(completed.state.artifacts.map((artifact) => artifact.type)).toEqual(
        expect.arrayContaining([
          "design-brief",
          "figma-apply-packet",
          "figma-apply-report",
          "ui-quality-gate-report",
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes after Figma apply metadata is patched through a restarted runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-create-screen-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const first = await createGraphSmokeFixture(root);

      const started = await first.runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Smoke Project" },
          userIntent:
            "Quick high-fidelity profile settings form using existing design-system components.",
          figmaTarget: fakeDraftTarget("Draft - Restart Settings"),
        },
      });
      const missingResolved = await first.runtime.answerRun({
        runId: started.runId,
        answer: "create-draft-components",
      });
      const waitingForApply = await first.runtime.answerRun({
        runId: started.runId,
        answer: "approve-draft-only-literals",
      });

      expect(missingResolved.status).toBe("waiting-for-user");
      expect(waitingForApply.status).toBe("waiting-for-figma");

      await first.runtime.patchRunState({
        runId: started.runId,
        statePatch: { applyMetadata: fakeApplyMetadataFor(waitingForApply.state) },
      });

      const second = await createGraphSmokeFixture(root);
      const completed = await second.runtime.continueRun({ runId: started.runId });

      expect(completed.runId).toBe(started.runId);
      expect(completed.status).toBe("done");
      expect(JSON.stringify(completed.state).length).toBeLessThan(256 * 1024);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
