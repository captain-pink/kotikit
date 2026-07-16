import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { briefNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: unknown[];
  interrupt?: {
    status: "waiting-for-user" | "waiting-for-figma";
    pendingQuestion?: { id: string; prompt: string; choices?: string[] };
    resume?: "same-node" | "next-node";
  };
};

const baseState = (overrides: Partial<KotikitGraphState> = {}): KotikitGraphState => ({
  schemaVersion: "KotikitGraphState/v1",
  runId: "run-1",
  flowId: "create-screen",
  flowVersion: "1.0.0",
  graphHash: "graph-hash",
  status: "running",
  project: { root: "/tmp/project" },
  userIntent: "Create a fast high-fidelity members table screen from existing DS components.",
  artifacts: [],
  errors: [],
  ...overrides,
});

async function runBriefNode(
  key: string,
  state: KotikitGraphState = baseState(),
  params: unknown = {}
): Promise<NodeOutput> {
  const node = briefNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params, state })) as NodeOutput;
}

describe("brief nodes", () => {
  it("classifies a rough idea into screen or multi-screen flow intent", async () => {
    const screen = await runBriefNode("brief.classifyIntent", baseState());
    const flow = await runBriefNode(
      "brief.classifyIntent",
      baseState({
        userIntent: "Create onboarding flow with welcome, profile, and success screens.",
      })
    );

    expect(screen.statePatch?.brief).toMatchObject({
      classification: "singleScreen",
      lane: "quick",
    });
    expect(flow.statePatch?.brief).toMatchObject({
      classification: "multiScreen",
    });
  });

  it("captures minimal intent for quick high-fidelity screen creation", async () => {
    const result = await runBriefNode("brief.captureMinimalIntent", baseState(), {
      lane: "adaptive",
    });

    expect(result.statePatch?.brief).toMatchObject({
      intent: "Create a fast high-fidelity members table screen from existing DS components.",
      title: "Members Table",
      lane: "quick",
      assumptions: expect.arrayContaining(["Use existing design-system components first."]),
    });
  });

  it("preserves a blueprint title in the brief instead of fallback keywords", async () => {
    const result = await runBriefNode(
      "brief.classifyIntent",
      baseState({
        userIntent:
          "Create the supplied mocked Events PRD. Domain references include Onboarding, Retrieval, Repair, and Inventory.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          title: "Events Experience",
          productDomain: "Mock Operations",
          requiredUiParts: [{ id: "event-stream", name: "Event stream", role: "timeline" }],
        },
      })
    );

    expect(result.statePatch?.brief).toMatchObject({
      title: "Events Experience",
      classification: "singleScreen",
    });
  });

  it("uses quick lane for a complete explicit blueprint even when the prompt is neutral", async () => {
    const result = await runBriefNode(
      "brief.classifyIntent",
      baseState({
        userIntent: "Create the supplied mocked Events screen.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          title: "Events Experience",
          confidence: "explicit",
          requiredUiParts: [{ id: "event-stream", name: "Event stream", role: "timeline" }],
        },
      })
    );

    expect(result.statePatch?.brief).toMatchObject({
      title: "Events Experience",
      lane: "quick",
      confidence: "explicit",
    });
  });

  it("infers a screen blueprint from a short request and local design-system hints", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        designSystem: {
          components: ["Button", "DataTable", "Toolbar", "TextField"],
        },
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      schemaVersion: "ScreenModel/v1",
      title: "Members Table",
      requiredUiParts: expect.arrayContaining([
        "data table",
        "toolbar",
        "primary action",
        "row avatar",
        "status badge",
        "row action menu",
      ]),
      repeatedPatterns: expect.arrayContaining(["table rows"]),
      regions: {
        tables: expect.arrayContaining(["members"]),
        lists: [],
        forms: [],
      },
      states: expect.arrayContaining(["loading", "empty", "error", "filled"]),
      designSystemHints: expect.arrayContaining(["DataTable", "Toolbar"]),
    });
  });

  it("preserves a blueprint Events Experience title and explicit UI parts", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: "Create a mocked Events Experience PRD with admin and onboarding references.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "events",
          title: "Events Experience",
          productDomain: "Mock Operations",
          requiredUiParts: [
            { id: "event-stream", name: "Event stream", role: "timeline", regionId: "activity" },
            { id: "detail-panel", name: "Detail panel", role: "context panel" },
          ],
          traits: {
            regions: [{ id: "activity", name: "Activity", kind: "timeline" }],
            repeatedPatterns: [{ id: "events", name: "Event items", kind: "events" }],
          },
        },
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      title: "Events Experience",
      productDomain: "Mock Operations",
      requiredUiParts: ["Event stream", "Detail panel"],
      uiParts: [
        expect.objectContaining({ id: "event-stream", role: "timeline", regionId: "activity" }),
        expect.objectContaining({ id: "detail-panel", role: "context panel" }),
      ],
      traits: {
        regions: [expect.objectContaining({ id: "activity", kind: "timeline" })],
        repeatedPatterns: [expect.objectContaining({ id: "events", kind: "events" })],
      },
    });
  });

  it("preserves blueprint expected content without inventing default states", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: "Create the supplied mocked Events screen.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "events",
          title: "Events Experience",
          productDomain: "Mock Operations",
          requiredUiParts: [
            { id: "event-stream", name: "Event stream", role: "timeline", regionId: "activity" },
            { id: "detail-panel", name: "Detail panel", role: "context panel" },
          ],
          expectedContent: [
            { kind: "region-title", text: "Recent mock events" },
            { kind: "button-label", text: "Review selected", required: true },
          ],
        },
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      title: "Events Experience",
      expectedContent: [
        { kind: "region-title", text: "Recent mock events" },
        { kind: "button-label", text: "Review selected", required: true },
      ],
      states: [],
    });
  });

  it("preserves flow blueprint structure while selecting the primary screen", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: "Create the mocked Events flow.",
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
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      title: "Event Detail",
      requiredUiParts: ["Summary"],
    });
    expect(result.statePatch?.flowModel).toMatchObject({
      title: "Mock Events Flow",
      screens: [
        expect.objectContaining({ id: "events", title: "Events Experience" }),
        expect.objectContaining({ id: "detail", title: "Event Detail" }),
      ],
    });
  });

  it("asks one missing question at a time", async () => {
    const result = await runBriefNode("brief.askNextQuestion", baseState());

    expect(result.statePatch?.brief).toMatchObject({ activeQuestionId: "states" });
    expect(result.interrupt).toMatchObject({
      status: "waiting-for-user",
      pendingQuestion: {
        id: "states",
        prompt: expect.stringContaining("loading"),
      },
    });
  });

  it("uses a resumed graph answer instead of asking the same brief question again", async () => {
    const result = await runBriefNode(
      "brief.askNextQuestion",
      baseState({
        answers: {
          states: "Show skeleton rows while loading and a retry banner on errors.",
        },
        brief: {
          questions: [{ id: "states", prompt: "States?", answer: undefined }],
          activeQuestionId: "states",
        },
      })
    );

    expect(result.interrupt).toBeUndefined();
    expect(result.statePatch?.brief).toMatchObject({
      activeQuestionId: undefined,
      questions: [
        {
          id: "states",
          answer: "Show skeleton rows while loading and a retry banner on errors.",
        },
      ],
    });
  });

  it("records an answer into graph state", async () => {
    const result = await runBriefNode(
      "brief.recordAnswer",
      baseState({
        userIntent: "Show skeleton rows while loading and a retry banner on errors.",
        brief: {
          activeQuestionId: "states",
          questions: [{ id: "states", prompt: "States?", answer: undefined }],
        },
      })
    );

    expect(result.statePatch?.brief).toMatchObject({
      activeQuestionId: undefined,
      questions: [
        {
          id: "states",
          answer: "Show skeleton rows while loading and a retry banner on errors.",
        },
      ],
    });
  });

  it("produces an approval summary", async () => {
    const result = await runBriefNode(
      "brief.summarizeForApproval",
      baseState({
        brief: { title: "Members Table", classification: "singleScreen", lane: "guided" },
        screen: {
          title: "Members Table",
          requiredUiParts: ["data table", "toolbar"],
          states: ["loading", "empty", "error", "filled"],
        },
      })
    );

    expect(result.statePatch?.brief).toMatchObject({
      approvalSummary: expect.stringContaining("Members Table"),
    });
    const brief = result.statePatch?.brief as { approvalSummary?: string } | undefined;
    expect(JSON.stringify(brief)).not.toContain("undefined");
  });

  it("saves an approved design-brief artifact", async () => {
    const result = await runBriefNode(
      "brief.saveApproved",
      baseState({
        brief: {
          title: "Members Table",
          approvalSummary: "Create the members table screen.",
          approved: true,
        },
      })
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts?.[0]).toMatchObject({
      id: "run-1-design-brief",
      runId: "run-1",
      type: "design-brief",
      schemaVersion: "DesignBrief/v1",
      payload: {
        schemaVersion: "DesignBrief/v1",
        summary: "Create the members table screen.",
      },
    });
  });

  it("refuses to save an unapproved design-brief artifact", async () => {
    await expect(
      runBriefNode(
        "brief.saveApproved",
        baseState({
          brief: {
            title: "Members Table",
            approvalSummary: "Create the members table screen.",
            approved: false,
          },
        })
      )
    ).rejects.toThrow("approved");
  });

  it("saves approved partial briefs with a useful fallback summary", async () => {
    const result = await runBriefNode(
      "brief.saveApproved",
      baseState({
        brief: {
          title: "Members Table",
          approved: true,
        },
      })
    );
    const artifact = result.artifacts?.[0] as { payload?: unknown } | undefined;

    expect(artifact?.payload).toMatchObject({
      summary: "Members Table",
    });
  });
});
