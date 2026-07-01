import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { qaNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: unknown[];
};

describe("qa graph nodes", () => {
  it("refuses to run the UI quality gate before Figma apply metadata is recorded", async () => {
    await expect(runNode("qa.runUiQualityGate", {})).rejects.toThrow("apply metadata");
  });

  it("blocks common broken UI output invariants", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        nodes: [
          { id: "vertical", textDirection: "vertical" },
          { id: "mirrored", mirroredText: true },
          { id: "flipped", transform: { scaleX: -1 } },
          { id: "negative", width: -1, height: 20 },
          { id: "clipped", clippedText: true },
          { id: "missing-component", expectedComponentRef: true },
          { id: "detached", detachedInstance: true },
          { id: "overlap", overlaps: ["other"] },
          { id: "hardcoded", hardcodedComponentImitation: true },
          { id: "state-card", statePreviewCard: true },
          { id: "missing-state", expectedStateFrame: true },
          { id: "shell-drift", stateShellDrift: true },
          { id: "orphan-draft", orphanDraftComponent: true },
          { id: "draft-overlap", draftComponentOverlap: true },
          { id: "detached-draft-use", draftComponentDetachedUse: true },
        ],
      },
    });
    const checks = recordArray(recordFrom(result.statePatch?.uiQualityGate).checks);

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      schemaVersion: "UIQualityGateReport/v1",
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "vertical-text", status: "blocked" }),
        expect.objectContaining({ id: "mirrored-text", status: "blocked" }),
        expect.objectContaining({ id: "component-refs", status: "blocked" }),
        expect.objectContaining({ id: "hardcoded-imitation", status: "blocked" }),
        expect.objectContaining({ id: "state-preview-card", status: "blocked" }),
        expect.objectContaining({ id: "missing-state-frame", status: "blocked" }),
        expect.objectContaining({ id: "state-shell-drift", status: "blocked" }),
        expect.objectContaining({ id: "orphan-draft-component", status: "blocked" }),
        expect.objectContaining({ id: "draft-component-overlap", status: "blocked" }),
        expect.objectContaining({ id: "draft-component-detached-use", status: "blocked" }),
      ]),
    });
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "state-preview-card",
          recommendedAction: expect.stringContaining("state"),
        }),
        expect.objectContaining({
          id: "draft-component-overlap",
          recommendedAction: expect.stringContaining("draft component"),
        }),
      ])
    );
  });

  it("passes clean apply reports", async () => {
    const result = await runNode("qa.runUiQualityGate", {
      applyReport: {
        nodes: [{ id: "button", componentKey: "button-key", width: 120, height: 40 }],
      },
    });

    expect(result.statePatch?.uiQualityGate).toMatchObject({
      schemaVersion: "UIQualityGateReport/v1",
      status: "passed",
    });
  });

  it("saves post-draft QA findings without posting comments or changing memory", async () => {
    const result = await runNode("qa.postDraftQa", {
      uiQualityGate: {
        schemaVersion: "UIQualityGateReport/v1",
        status: "blocked",
        checks: [{ id: "vertical-text", name: "Vertical text", status: "blocked" }],
      },
    });

    expect(result.artifacts?.[0]).toMatchObject({
      type: "ui-quality-gate-report",
      payload: expect.objectContaining({ status: "blocked" }),
    });
    expect(result.statePatch).not.toHaveProperty("review");
  });

  it("refuses to save post-draft QA before the quality gate runs", async () => {
    await expect(runNode("qa.postDraftQa", {})).rejects.toThrow("quality gate");
  });
});

async function runNode(key: string, patch: Partial<KotikitGraphState>): Promise<NodeOutput> {
  const node = qaNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-qa",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/kotikit" },
    artifacts: [],
    errors: [],
    ...patch,
  };
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
