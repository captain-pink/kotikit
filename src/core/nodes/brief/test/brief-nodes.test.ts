import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { briefNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: unknown[];
  interrupt?: {
    status: "waiting-for-user" | "waiting-for-figma";
    pendingQuestion?: { id: string; prompt: string; choices?: string[] };
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
      requiredUiParts: expect.arrayContaining(["data table", "toolbar", "primary action"]),
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
