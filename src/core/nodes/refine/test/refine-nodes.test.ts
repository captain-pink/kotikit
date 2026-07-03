import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { refineNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: {
    status: "waiting-for-user" | "waiting-for-figma";
    pendingQuestion?: { id: string; prompt: string; choices?: string[] };
  };
};

const baseState = (overrides: Partial<KotikitGraphState> = {}): KotikitGraphState => ({
  schemaVersion: "KotikitGraphState/v1",
  runId: "run-refine",
  flowId: "refine-existing",
  flowVersion: "1.0.0",
  graphHash: "graph-hash",
  status: "running",
  project: { root: "/tmp/project" },
  userIntent: "Refine the mocked Events page.",
  artifacts: [],
  errors: [],
  ...overrides,
});

async function runRefineNode(
  key: string,
  state: KotikitGraphState = baseState(),
  params: unknown = {}
): Promise<NodeOutput> {
  const node = refineNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params, state })) as NodeOutput;
}

describe("refine nodes", () => {
  it("promotes a single existing target to replace-existing-frame canvas intent", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "selected-frame",
          targets: [
            {
              nodeId: "12:34",
              screenId: "events",
              name: "Existing Events Frame",
              bounds: { x: 0, y: 0, width: 1440, height: 900 },
            },
          ],
        },
      })
    );

    expect(output.interrupt).toBeUndefined();
    expect(output.statePatch?.canvasIntent).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:34", screenId: "events" },
    });
  });

  it("maps an explicit flow primary screen to its target", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        flowBlueprint: {
          schemaVersion: "FlowBlueprintInput/v1",
          title: "Mock Events Flow",
          primaryScreenId: "detail",
          screens: [
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "events",
              title: "Events Experience",
              requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
            },
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "detail",
              title: "Event Detail",
              requiredUiParts: [{ id: "summary", name: "Summary", role: "summary" }],
            },
          ],
        },
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "selected-frames",
          targets: [
            { nodeId: "12:34", screenId: "events", name: "Events" },
            { nodeId: "12:35", screenId: "detail", name: "Event Detail" },
          ],
        },
      })
    );

    expect(output.statePatch?.canvasIntent).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:35", screenId: "detail" },
    });
  });

  it("uses compact existing design inventory when direct canvas targets are missing", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        flowBlueprint: {
          schemaVersion: "FlowBlueprintInput/v1",
          title: "Mock Events Flow",
          primaryScreenId: "events",
          screens: [
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "events",
              title: "Events Experience",
              requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
            },
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
          pageName: "Mock Dashboard",
          targets: [
            {
              nodeId: "12:34",
              screenId: "events",
              name: "Existing Events Frame",
              kind: "frame",
              bounds: { x: 0, y: 0, width: 1440, height: 900 },
            },
          ],
        },
      })
    );

    expect(output.statePatch?.canvasIntent).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:34", screenId: "events" },
    });
  });

  it("asks for one clarification when multiple targets are ambiguous", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "selected-frames",
          targets: [
            { nodeId: "12:34", name: "Frame A" },
            { nodeId: "12:35", name: "Frame B" },
          ],
        },
      })
    );

    expect(output.statePatch?.pendingQuestion).toMatchObject({
      id: "select-refine-target",
      choices: ["12:34", "12:35"],
    });
    expect(output.interrupt).toMatchObject({
      status: "waiting-for-user",
      pendingQuestion: { id: "select-refine-target" },
    });
  });
});
