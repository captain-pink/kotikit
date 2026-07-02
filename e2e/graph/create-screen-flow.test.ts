import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  drainFakeFigmaTransactions,
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
      expect(missingResolved.status).toBe("waiting-for-figma");
      expect(missingResolved.state.draftComponentPlan?.components).toContainEqual(
        expect.objectContaining({ name: "secondary action" })
      );

      const draftCreated = await drainFakeFigmaTransactions(runtime, started.runId);
      expect(draftCreated.status).toBe("waiting-for-user");
      expect(draftCreated.pendingQuestion?.id).toBe("approve-literal-variable-fallback");

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
          componentKey: "local-draft-draft-secondary-action-key",
        })
      );
      expect(waitingForApply.state.stateRepresentation).toMatchObject({
        schemaVersion: "StateRepresentationContract/v1",
      });
      expectIncrementalQueueReady(waitingForApply.state);

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

      const completed = await drainFakeFigmaTransactions(runtime, started.runId);

      expect(completed.status).toBe("done");
      expect(completed.draftComponentLifecycle).toMatchObject({
        schemaVersion: "DraftComponentLifecycle/v1",
        components: expect.arrayContaining([expect.objectContaining({ status: "used" })]),
      });
      expectIncrementalQueueDone(completed);
      expect(completed.uiQualityGate?.status).toBe("passed");
      expect(completed.artifacts.map((artifact) => artifact.type)).toEqual(
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
      expectIncrementalQueueReady(waitingForApply.state);
      await expect(
        artifactStore.getArtifact(`${started.runId}-design-brief`)
      ).resolves.toMatchObject({
        type: "design-brief",
        payload: { summary: expect.stringContaining("Profile Settings") },
      });

      const completed = await drainFakeFigmaTransactions(runtime, started.runId);

      expect(completed.status).toBe("done");
      expectIncrementalQueueDone(completed);
      expect(completed.artifacts.map((artifact) => artifact.type)).toEqual(
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
      const draftCreated = await drainFakeFigmaTransactions(first.runtime, started.runId);
      const waitingForApply = await first.runtime.answerRun({
        runId: started.runId,
        answer: "approve-draft-only-literals",
      });

      expect(missingResolved.status).toBe("waiting-for-figma");
      expect(draftCreated.status).toBe("waiting-for-user");
      expect(waitingForApply.status).toBe("waiting-for-figma");
      expectIncrementalQueueReady(waitingForApply.state);

      const second = await createGraphSmokeFixture(root);
      const completed = await drainFakeFigmaTransactions(second.runtime, started.runId);

      expect(completed.status).toBe("done");
      expect(completed.runId).toBe(started.runId);
      expectIncrementalQueueDone(completed);
      expect(recordFrom(completed).applyMetadata).toBeUndefined();
      expect(JSON.stringify(completed).length).toBeLessThan(256 * 1024);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function expectIncrementalQueueReady(state: Record<string, unknown>): void {
  expect(state.canvasPlan).toMatchObject({
    schemaVersion: "CanvasPlan/v1",
  });
  expect(state.figmaTransactionPlan).toMatchObject({
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
  });
  expect(state.activeFigmaTransaction).toMatchObject({
    id: expect.stringMatching(/^txn-/),
  });
}

function expectIncrementalQueueDone(state: Record<string, unknown>): void {
  expect(state.figmaNodeLedger).toMatchObject({
    schemaVersion: "FigmaNodeLedger/v1",
  });
  expect(
    recordArray(recordFrom(state.figmaTransactionPlan).transactions).every(
      (item) => item.status === "recorded"
    )
  ).toBe(true);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}
