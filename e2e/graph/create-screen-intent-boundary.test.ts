import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeDraftTarget,
  seedLocalDesignSystem,
} from "./fixtures/fake-figma.js";

describe("create-screen intent boundary", () => {
  it("preserves detailed free-text intent without selecting a canned pattern pack", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-free-text-intent-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { runtime } = await createGraphSmokeFixture(root);
      const userIntent =
        "Quick high-fidelity Dashboards Reports tab for a mocked analytics workspace with a persistent sidebar, page header, tab bar, pinned reports empty state, search and filter controls, and a reports table with columns Title, Data source, Chart type, Owner, and Updated.";

      const started = await runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Mock Reports Project" },
          userIntent,
          figmaTarget: fakeDraftTarget("Draft - Reports"),
        },
      });

      expect(started.status).toBe("waiting-for-user");
      expect(started.state.pendingQuestion).toMatchObject({
        id: "provide-typed-blueprint",
        prompt: expect.stringMatching(/restart kotikit_start.*screenBlueprint.*flowBlueprint/i),
      });
      expect(started.state.uxEnvelope).toMatchObject({
        screenArchetype: "unknown",
        confidence: "low",
        primaryGoal: userIntent,
        primaryTask: "Draft UI",
        dataModel: { fields: [] },
      });
      const approach = recordFrom(recordFrom(started.state).designApproach);
      expect(approach).toMatchObject({
        decision: "ask-designer",
        userWorkflow: expect.stringContaining("Title, Data source"),
      });
      expect(started.state.stateMatrix?.states).toEqual([]);
      expect(started.state.uiComposition).toBeUndefined();
      expect(recordFrom(started.state.draftPlan).applyPacket).toBeUndefined();
      expect(started.state.artifacts.map((artifact) => artifact.type)).not.toContain(
        "design-system-reuse-plan"
      );
      expect(started.state.artifacts.map((artifact) => artifact.type)).not.toContain(
        "figma-apply-packet"
      );
      expect(JSON.stringify(started.state.stateMatrix)).not.toMatch(/members|invite/i);

      const approved = await runtime.answerRun({
        runId: started.runId,
        answer: "approve-brief",
      });
      expect(approved.status).toBe("waiting-for-user");
      expect(approved.state.pendingQuestion?.id).toBe("provide-typed-blueprint");
      expect(approved.state.uiComposition).toBeUndefined();
      expect(recordFrom(approved.state.draftPlan).applyPacket).toBeUndefined();
      expect(approved.state.artifacts.map((artifact) => artifact.type)).not.toContain(
        "figma-apply-packet"
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
