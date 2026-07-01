import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { draftComponentNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: { pendingQuestion?: { id: string; choices?: string[] } };
};
type StatePatch = Partial<KotikitGraphState> & Record<string, unknown>;

describe("draft component graph nodes", () => {
  it("pauses for missing component strategy approval", async () => {
    const result = await runNode("draftComponents.planMissing", {
      fitReport: {
        missingComponents: [{ requestedPart: "email input" }],
      },
    });

    expect(result.interrupt?.pendingQuestion).toMatchObject({
      id: "missing-components",
      choices: ["create-draft-components", "approve-primitive-exceptions"],
    });
  });

  it("plans missing components in the draft components section after approval", async () => {
    const result = await runNode("draftComponents.planMissing", {
      fitReport: {
        missingComponents: [{ requestedPart: "email input" }, { requestedPart: "member table" }],
      },
      draftComponentStrategy: "create-draft-components",
    });

    expect(result.statePatch?.draftComponentPlan).toMatchObject({
      schemaVersion: "DraftComponentPlan/v1",
      sectionName: "Kotikit Draft Components",
      components: [
        expect.objectContaining({ id: "draft-email-input", name: "email input" }),
        expect.objectContaining({ id: "draft-member-table", name: "member table" }),
      ],
    });
  });

  it("plans missing components from the graph answer map", async () => {
    const result = await runNode("draftComponents.planMissing", {
      fitReport: {
        missingComponents: [{ requestedPart: "email input" }],
      },
      answers: {
        "missing-components": "create-draft-components",
      },
    });

    expect(result.statePatch?.draftComponentPlan).toMatchObject({
      components: [expect.objectContaining({ id: "draft-email-input" })],
    });
  });

  it("does not re-ask after primitive exceptions are approved", async () => {
    const result = await runNode("draftComponents.planMissing", {
      fitReport: {
        missingComponents: [{ requestedPart: "email input" }],
        approvedPrimitiveExceptions: ["email input"],
      },
      answers: {
        "missing-components": "approve-primitive-exceptions",
      },
    });

    expect(result.interrupt).toBeUndefined();
    expect(result.statePatch?.draftComponentPlan).toBeUndefined();
  });

  it("creates draft components before screen composition starts", async () => {
    const result = await runNode("draftComponents.createOnDraftPage", {
      figmaTarget: draftTarget(),
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
      },
    });

    expect(result.statePatch?.draftPlan).toMatchObject({
      createdDraftComponents: [
        expect.objectContaining({
          id: "draft-email-input",
          name: "email input",
          sectionName: "Kotikit Draft Components",
        }),
      ],
    });
  });

  it("refuses draft component creation on an unsafe Figma target", async () => {
    await expect(
      runNode("draftComponents.createOnDraftPage", {
        figmaTarget: {
          ...draftTarget(),
          pageName: "Production",
        },
        draftComponentPlan: {
          schemaVersion: "DraftComponentPlan/v1",
          sectionName: "Kotikit Draft Components",
          components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
        },
      })
    ).rejects.toThrow("not safe for writes");
  });

  it("validates created draft component keys", async () => {
    await expect(
      runNode("draftComponents.validateCreated", {
        draftComponentPlan: {
          schemaVersion: "DraftComponentPlan/v1",
          sectionName: "Kotikit Draft Components",
          components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
        },
        draftPlan: {
          createdDraftComponents: [{ id: "draft-email-input", name: "email input" }],
        },
      })
    ).rejects.toThrow("component key");
  });
});

async function runNode(key: string, patch: StatePatch): Promise<NodeOutput> {
  const node = draftComponentNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: StatePatch): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-draft-components",
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

function draftTarget(): NonNullable<KotikitGraphState["figmaTarget"]> {
  return {
    fileKey: "FILE",
    pageId: "1:2",
    pageName: "Draft - Members",
    pageUrl: "https://www.figma.com/design/FILE/Name?node-id=1-2",
    boundAt: "2026-06-30T00:00:00.000Z",
    source: "user-url",
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    safety: {
      requireDraftPageName: true,
      allowPageCreation: false,
      requireKotikitSection: true,
    },
  };
}
