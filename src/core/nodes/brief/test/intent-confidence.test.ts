import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { briefNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: {
    status: "waiting-for-user" | "waiting-for-figma";
    pendingQuestion?: { id: string; prompt: string; choices?: string[] };
    resume?: "same-node" | "next-node";
  };
};

const PROMPT_WORDS = [
  "Quick",
  "create",
  "a",
  "mocked",
  "reports",
  "table",
  "screen",
  "with",
  "sidebar",
  "tabs",
  "search",
  "filters",
  "columns",
  "charts",
  "owners",
  "updates",
  "sources",
  "titles",
  "for",
  "reviewers",
  "using",
  "existing",
  "design",
  "system",
  "components",
];

describe("brief intent confidence boundary", () => {
  for (const [wordCount, confidence] of [
    [18, "inferred"],
    [19, "low"],
    [24, "low"],
    [25, "low"],
  ] as const) {
    it(`classifies a ${wordCount}-word unstructured prompt as ${confidence}`, async () => {
      const userIntent = PROMPT_WORDS.slice(0, wordCount).join(" ");
      expect(userIntent.split(/\s+/)).toHaveLength(wordCount);

      const result = await runBriefNode("brief.inferScreenBlueprint", baseState({ userIntent }));

      expect(result.statePatch?.screen).toMatchObject({ confidence });
      if (confidence === "low") {
        expect(result.statePatch?.screen).toMatchObject({
          title: "Product Screen",
          states: [],
        });
      }
    });
  }

  it("does not infer table parts from admin dashboard wording alone", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: "Create an admin dashboard for mocked operations metrics and alerts.",
      })
    );

    expect(result.statePatch?.screen).not.toMatchObject({
      requiredUiParts: expect.arrayContaining([
        "data table",
        "pagination",
        "row avatar",
        "row action menu",
      ]),
    });
  });

  it("does not let incidental onboarding wording hijack a detailed PRD", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent:
          "Create a detailed mocked Events workspace for operations reviewers. The PRD mentions mock service domains named Onboarding, Retrieval, Repair, and Inventory, but the requested screen is an event activity view with priority indicators, a timeline, and a detail panel.",
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      schemaVersion: "ScreenModel/v1",
      confidence: "low",
    });
    expect(result.statePatch?.screen).not.toMatchObject({
      title: "Onboarding Flow",
      requiredUiParts: expect.arrayContaining(["row avatar", "row action menu", "pagination"]),
    });
  });

  it("marks detailed intent without a blueprint as low confidence instead of guessing", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent:
          "Create a detailed production screen for mocked event operations. It should balance monitoring, triage, service-domain context, multiple states, and reviewer actions, but this request intentionally does not provide a structured screen blueprint.",
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      title: "Product Screen",
      confidence: "low",
      requiredUiParts: ["page shell", "content heading", "primary action"],
      states: [],
    });
    expect(result.statePatch?.screen).not.toMatchObject({
      requiredUiParts: expect.arrayContaining(["data table", "pagination", "row avatar"]),
    });
  });

  it("requires a typed blueprint again when text tries to approve a low-confidence brief", async () => {
    const result = await runBriefNode(
      "brief.askApproval",
      baseState({
        answers: { "provide-typed-blueprint": "approve-brief" },
        brief: {
          title: "Product Screen",
          lane: "quick",
          confidence: "low",
          approvalSummary: "Preserve the supplied mocked Reports request.",
        },
        screen: { confidence: "low" },
      })
    );

    expect(result.statePatch?.brief).toMatchObject({ approved: false });
    expect(result.interrupt).toMatchObject({
      status: "waiting-for-user",
      resume: "same-node",
      pendingQuestion: {
        id: "provide-typed-blueprint",
        prompt: expect.stringMatching(
          /restart kotikit_start.*screenBlueprint.*flowBlueprint.*required UI parts.*regions.*expected content.*only requested states/i
        ),
      },
    });
  });

  it("summarizes low-confidence intent without inventing standard states", async () => {
    const result = await runBriefNode(
      "brief.summarizeForApproval",
      baseState({
        brief: {
          title: "Product Screen",
          intent: "Preserve the supplied mocked Reports request.",
          confidence: "low",
        },
        screen: {
          title: "Product Screen",
          confidence: "low",
          requiredUiParts: ["page shell", "content heading", "primary action"],
          states: [],
        },
      })
    );
    const summary = String(
      (result.statePatch?.brief as { approvalSummary?: string } | undefined)?.approvalSummary
    );

    expect(summary).toMatch(/no states.*typed blueprint/i);
    expect(summary).not.toMatch(/filled|loading|empty|error/i);
  });
});

function baseState(overrides: Partial<KotikitGraphState> = {}): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-intent-confidence",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "graph-hash",
    status: "running",
    project: { root: "/tmp/mock-project" },
    userIntent: "Create a mocked product screen.",
    artifacts: [],
    errors: [],
    ...overrides,
  };
}

async function runBriefNode(key: string, state: KotikitGraphState): Promise<NodeOutput> {
  const node = briefNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state })) as NodeOutput;
}
