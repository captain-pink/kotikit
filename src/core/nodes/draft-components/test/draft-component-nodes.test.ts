import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { draftComponentNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: {
    status?: "waiting-for-user" | "waiting-for-figma";
    resume?: "same-node" | "next-node";
    pendingQuestion?: { id: string; choices?: string[] };
  };
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

  it("pauses for real Figma draft component creation before screen composition starts", async () => {
    const result = await runNode("draftComponents.createOnDraftPage", {
      figmaTarget: draftTarget(),
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
      },
      canvasPlan: canvasPlan(),
    });

    expect(result.interrupt).toEqual({ status: "waiting-for-figma", resume: "same-node" });
    expect(result.statePatch?.activeFigmaTransaction).toMatchObject({
      id: "txn-draft-draft-email-input",
      kind: "create-draft-component",
      draftComponentId: "draft-email-input",
      placementId: "draft-draft-email-input",
    });
  });

  it("records real Figma draft component metadata and rejects fake draft keys", async () => {
    await expect(
      runNode("draftComponents.createOnDraftPage", {
        figmaTarget: draftTarget(),
        draftComponentPlan: {
          schemaVersion: "DraftComponentPlan/v1",
          sectionName: "Kotikit Draft Components",
          components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
        },
        activeFigmaTransaction: {
          id: "txn-draft-draft-email-input",
          order: 1,
          kind: "create-draft-component",
          label: "email input",
          placementId: "draft-draft-email-input",
          draftComponentId: "draft-email-input",
          requiredMetadata: [
            "node-id",
            "bounds",
            "auto-layout",
            "component-refs",
            "component-source",
            "icon-refs",
            "variable-refs",
          ],
        },
        applyMetadata: {
          transactionId: "txn-draft-draft-email-input",
          fileKey: "FILE",
          pageId: "1:2",
          sectionName: "kotikit / members / 2026-06-30",
          figmaNodeId: "6:2",
          figmaNodeName: "Draft/email input",
          figmaNodeKind: "COMPONENT",
          bounds: { x: 0, y: 0, width: 360, height: 240 },
          componentRefs: ["draft:draft-email-input"],
          variableRefs: [],
          autoLayout: true,
        },
      })
    ).rejects.toThrow("real Figma component key");

    const result = await runNode("draftComponents.createOnDraftPage", {
      figmaTarget: draftTarget(),
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
      },
      activeFigmaTransaction: {
        id: "txn-draft-draft-email-input",
        order: 1,
        kind: "create-draft-component",
        label: "email input",
        placementId: "draft-draft-email-input",
        draftComponentId: "draft-email-input",
        requiredMetadata: [
          "node-id",
          "bounds",
          "auto-layout",
          "component-refs",
          "component-source",
          "icon-refs",
          "variable-refs",
        ],
      },
      applyMetadata: {
        transactionId: "txn-draft-draft-email-input",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-06-30",
        figmaNodeId: "6:2",
        figmaNodeName: "Draft/email input",
        figmaNodeKind: "COMPONENT",
        bounds: { x: 0, y: 0, width: 360, height: 240 },
        componentRefs: ["figma-local-component-key"],
        variableRefs: [],
        autoLayout: true,
      },
    });

    expect(result.statePatch?.draftPlan).toMatchObject({
      createdDraftComponents: [
        {
          id: "draft-email-input",
          name: "email input",
          componentKey: "figma-local-component-key",
          componentNodeId: "6:2",
          sectionName: "Kotikit Draft Components",
        },
      ],
    });
    expect(result.statePatch?.activeFigmaTransaction).toBeUndefined();
    expect(result.statePatch?.applyMetadata).toBeUndefined();
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

    await expect(
      runNode("draftComponents.validateCreated", {
        draftComponentPlan: {
          schemaVersion: "DraftComponentPlan/v1",
          sectionName: "Kotikit Draft Components",
          components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
        },
        draftPlan: {
          createdDraftComponents: [
            {
              id: "draft-email-input",
              name: "email input",
              componentKey: "draft:draft-email-input",
            },
          ],
        },
      })
    ).rejects.toThrow("real Figma component key");
  });

  it("builds draft component lifecycle from created components and applied instances", async () => {
    const result = await runNode("draftComponents.buildLifecycle", {
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
      },
      draftPlan: {
        createdDraftComponents: [
          {
            id: "draft-email-input",
            name: "email input",
            componentKey: "draft:draft-email-input",
          },
        ],
      },
      applyReport: {
        draftComponentInstances: [{ draftComponentId: "draft-email-input", nodeId: "node-1" }],
      },
    });

    expect(result.statePatch?.draftComponentLifecycle).toMatchObject({
      schemaVersion: "DraftComponentLifecycle/v1",
      components: [expect.objectContaining({ status: "used" })],
    });
  });

  it("marks overlapping draft component placements as blocked", async () => {
    const result = await runNode("draftComponents.buildLifecycle", {
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-email-input", name: "email input", reason: "Missing input" }],
      },
      draftPlan: {
        createdDraftComponents: [
          {
            id: "draft-email-input",
            name: "email input",
            componentKey: "draft:draft-email-input",
          },
        ],
      },
      applyReport: {
        draftComponentInstances: [{ draftComponentId: "draft-email-input", nodeId: "node-1" }],
        draftComponentPlacements: [
          {
            draftComponentId: "draft-email-input",
            sectionName: "Kotikit Draft Components",
            overlapsGeneratedScreen: true,
          },
        ],
      },
    });

    expect(result.statePatch?.draftComponentLifecycle).toMatchObject({
      components: [expect.objectContaining({ status: "overlap-blocked" })],
    });
  });

  it("blocks unused draft components after apply", async () => {
    await expect(
      runNode("draftComponents.verifyLifecycle", {
        draftComponentLifecycle: {
          schemaVersion: "DraftComponentLifecycle/v1",
          sectionName: "Kotikit Draft Components",
          components: [
            {
              draftComponentId: "draft-email-input",
              name: "email input",
              reason: "Missing input",
              placement: { sectionName: "Kotikit Draft Components" },
              requiredInstances: 1,
              actualInstances: [],
              status: "orphan-blocked",
            },
          ],
        },
      })
    ).rejects.toThrow("not used");
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

function canvasPlan(): NonNullable<KotikitGraphState["canvasPlan"]> {
  return {
    schemaVersion: "CanvasPlan/v1",
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    coordinateSpace: "section-relative",
    screenSize: { width: 1440, height: 900 },
    minGap: 160,
    sectionStyle: {
      background: {
        color: "AED0FF",
        opacity: 0.1,
      },
    },
    zones: [
      {
        id: "zone-draft-components",
        kind: "draft-components",
        label: "Draft components",
        bounds: { x: 0, y: 0, width: 360, height: 240 },
      },
      {
        id: "zone-screen-states",
        kind: "screen-states",
        label: "Screen states",
        bounds: { x: 560, y: 0, width: 1440, height: 900 },
      },
    ],
    placements: [
      {
        id: "draft-draft-email-input",
        kind: "draft-component",
        draftComponentId: "draft-email-input",
        label: "email input",
        bounds: { x: 0, y: 0, width: 360, height: 240 },
        parentZoneId: "zone-draft-components",
        transactionId: "txn-draft-draft-email-input",
      },
    ],
    strategy: {
      primaryFirst: true,
      creationOrder: ["draft-draft-email-input"],
      designerNotes: ["Draft components stay in their own section."],
    },
  };
}
