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
  it("preserves blueprint title and semantic parts through create-screen", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-blueprint-screen-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Mock Blueprint Project" },
          userIntent: "Quick high-fidelity screen from the supplied mocked Events Experience PRD.",
          figmaTarget: fakeDraftTarget("Draft - Events"),
          screenBlueprint: {
            schemaVersion: "ScreenBlueprintInput/v1",
            title: "Events Experience",
            productDomain: "Mock Operations",
            requiredUiParts: [
              {
                id: "event-stream",
                name: "Event stream",
                role: "timeline",
                variableRoles: [{ property: "text", semanticRole: "timeline label" }],
              },
              { id: "detail-panel", name: "Detail panel", role: "context panel" },
            ],
          },
        },
      });

      expect(started.status).toBe("waiting-for-figma");
      expect(started.state.screen).toMatchObject({
        title: "Events Experience",
        productDomain: "Mock Operations",
        requiredUiParts: ["Event stream", "Detail panel"],
      });
      expect(started.state.uiComposition?.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "event-stream", role: "timeline" }),
          expect.objectContaining({ id: "detail-panel", role: "context panel" }),
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts punctuation in explicit blueprint UI-part names", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-literal-parts-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Mock Reports Project" },
          userIntent: "Create the supplied mocked Reports blueprint.",
          figmaTarget: fakeDraftTarget("Draft - Reports"),
          screenBlueprint: {
            schemaVersion: "ScreenBlueprintInput/v1",
            id: "dashboards-reports-tab",
            title: "Dashboards – Reports tab",
            requiredUiParts: [
              { name: "sidebar-nav" },
              { name: "page-header" },
              { name: "tab-bar" },
              { name: "pinned-reports-empty-state" },
              { name: "search-and-filter-bar" },
              { name: "reports-table" },
            ],
          },
        },
      });

      expect(started.status).toBe("waiting-for-figma");
      expect(started.state.uxEnvelope?.screenArchetype).toBe("unknown");
      expect(started.state.artifacts.map((artifact) => artifact.type)).toEqual(
        expect.arrayContaining(["design-system-reuse-plan", "figma-apply-packet"])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("quick lane composes screen-draft parts, waits for fake apply, and saves QA", async () => {
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

      expect(started.status).toBe("waiting-for-figma");
      expect(started.state.pendingQuestion).toBeUndefined();
      expect(started.state.uxEnvelope).toMatchObject({
        schemaVersion: "UXEnvelope/v1",
      });
      expect(started.state.stateMatrix).toMatchObject({
        schemaVersion: "StateMatrix/v1",
      });
      expect(recordFrom(started.state).designApproach).toMatchObject({
        schemaVersion: "DesignApproach/v1",
        decision: "proceed",
      });
      await expect(
        artifactStore.getArtifact(`${started.runId}-design-approach`)
      ).resolves.toMatchObject({
        type: "design-approach",
        payload: {
          schemaVersion: "DesignApproach/v1",
          designSystemStrategy: expect.stringContaining("local design system"),
        },
      });

      const waitingForApply = started;
      expect(waitingForApply.state.draftPlan).toMatchObject({
        fidelity: "high",
        applyPacket: expect.any(Object),
      });
      expect(waitingForApply.state.uiComposition?.parts).toContainEqual(
        expect.objectContaining({
          name: "secondary action",
          source: "screen-draft",
          extractionCandidate: true,
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
      expectIncrementalQueueDone(completed);
      expect(completed.uiQualityGate?.status).toBe("passed");
      await expect(
        artifactStore.getArtifact(`${started.runId}-design-system-usage-report`)
      ).resolves.toMatchObject({
        type: "design-system-usage-report",
        payload: { summary: expect.stringContaining("screen-draft part") },
      });
      expect(completed.artifacts.map((artifact) => artifact.type)).toEqual(
        expect.arrayContaining([
          "design-brief",
          "design-approach",
          "ux-envelope",
          "state-matrix",
          "figma-apply-packet",
          "figma-apply-report",
          "design-system-usage-report",
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
      const waitingForApply = approved;
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

      const waitingForApply = started;
      expect(started.status).toBe("waiting-for-figma");
      expect(started.state.pendingQuestion).toBeUndefined();
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
