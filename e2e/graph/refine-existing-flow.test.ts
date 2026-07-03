import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeDraftTarget,
  seedLocalDesignSystem,
} from "./fixtures/fake-figma.js";

describe("refine-existing graph flow", () => {
  it("starts from compact existing design inventory and creates replacement metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-refine-existing-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "refine-existing",
        input: {
          project: { root, name: "Mock Existing Project" },
          userIntent:
            "Quick high-fidelity refine of the mocked Events frame using the supplied blueprint.",
          figmaTarget: fakeDraftTarget("Draft - Existing Events"),
          screenBlueprint: {
            schemaVersion: "ScreenBlueprintInput/v1",
            title: "Events Experience",
            requiredUiParts: [
              { id: "event-stream", name: "Event stream", role: "timeline" },
              { id: "detail-panel", name: "Detail panel", role: "context panel" },
            ],
          },
          canvasIntent: {
            mode: "refine-existing-targets",
            scope: "page",
            targets: [],
          },
          existingDesignInventory: {
            schemaVersion: "ExistingDesignInventoryInput/v1",
            source: "figma-scan",
            pageId: "page:1",
            pageName: "Mock Existing Dashboard",
            targets: [
              {
                nodeId: "12:34",
                screenId: "events",
                name: "Existing Events Frame",
                kind: "frame",
                bounds: { x: 0, y: 0, width: 1280, height: 720 },
              },
            ],
          },
        },
      });

      expect(started.status).toBe("waiting-for-figma");
      expect(started.state.canvasIntent).toMatchObject({
        mode: "replace-existing-frame",
        targetFrame: { nodeId: "12:34" },
      });
      expect(started.state.canvasPlan).toMatchObject({
        mode: "replace",
      });
      expect(started.state.canvasPlan?.placements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            canvasOperation: "replace-target-frame",
            operation: "replace",
            targetNodeId: "12:34",
          }),
        ])
      );
      expect(
        recordArray(
          recordFrom(
            recordFrom(recordFrom(started.state.draftPlan).applyPacket).transactionPlanSummary
          ).transactions
        )
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            canvasOperation: "replace-target-frame",
            targetNodeId: "12:34",
          }),
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

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
