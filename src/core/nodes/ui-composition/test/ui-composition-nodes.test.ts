import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { uiCompositionNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
};

describe("ui composition graph nodes", () => {
  it("allows missing UI parts as screen-draft candidates instead of blocking composition", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["primary button", "email input"] },
      fitReport: {
        exactMatches: [{ requestedPart: "primary button", componentKey: "button-key" }],
        substitutes: [],
        missingComponents: [{ requestedPart: "email input" }],
      },
    });

    expect(result.statePatch?.uiComposition).toMatchObject({
      parts: [
        expect.objectContaining({
          name: "primary button",
          source: "existing-component",
          componentKey: "button-key",
        }),
        expect.objectContaining({
          name: "email input",
          source: "screen-draft",
          extractionCandidate: true,
        }),
      ],
    });
  });

  it("builds a contract from existing and draft component refs", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["primary button", "member table"] },
      fitReport: {
        exactMatches: [{ requestedPart: "primary button", componentKey: "button-key" }],
        substitutes: [],
        missingComponents: [{ requestedPart: "member table" }],
      },
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-member-table", name: "member table", reason: "Missing table" }],
      },
      draftPlan: {
        createdDraftComponents: [
          {
            id: "draft-member-table",
            name: "member table",
            componentKey: "draft:member-table-key",
          },
        ],
      },
    });

    expect(result.statePatch?.uiComposition).toMatchObject({
      schemaVersion: "UICompositionContract/v1",
      parts: [
        expect.objectContaining({
          name: "primary button",
          source: "existing-component",
          componentKey: "button-key",
        }),
        expect.objectContaining({
          name: "member table",
          source: "draft-component",
          draftComponentId: "draft-member-table",
          componentKey: "draft:member-table-key",
        }),
      ],
    });
  });

  it("uses substitute component refs as existing component coverage", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["primary button"] },
      fitReport: {
        exactMatches: [],
        substitutes: [{ requestedPart: "primary button", componentKey: "button-substitute-key" }],
      },
    });

    expect(result.statePatch?.uiComposition?.parts[0]).toMatchObject({
      source: "existing-component",
      componentKey: "button-substitute-key",
    });
  });

  it("attaches local icon affordances from the fit report to composition parts", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["search", "primary action"] },
      fitReport: {
        exactMatches: [
          { requestedPart: "search", componentKey: "search-key" },
          { requestedPart: "primary action", componentKey: "button-key" },
        ],
        iconMatches: [
          {
            requestedPart: "search",
            semantic: "search",
            iconKey: "icon-search-key",
            iconName: "Icon/Search",
          },
          {
            requestedPart: "primary action",
            semantic: "primary-action",
            iconKey: "icon-plus-key",
            iconName: "Icon/Plus",
          },
        ],
      },
    });

    expect(result.statePatch?.uiComposition?.parts).toEqual([
      expect.objectContaining({
        id: "search",
        iconAffordances: [
          expect.objectContaining({
            id: "search-icon",
            semantic: "search",
            source: "local-design-system",
            iconKey: "icon-search-key",
          }),
        ],
      }),
      expect.objectContaining({
        id: "primary-action",
        iconAffordances: [
          expect.objectContaining({
            id: "primary-action-icon",
            semantic: "primary-action",
            source: "local-design-system",
            iconKey: "icon-plus-key",
          }),
        ],
      }),
    ]);
  });

  it("uses wrap candidate component refs as existing component coverage", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["member table"], repeatedPatterns: ["table"] },
      fitReport: {
        exactMatches: [],
        substitutes: [],
        wrapCandidates: [
          {
            requestedPart: "member table",
            componentName: "Table preview",
            componentKey: "table-preview-key",
            candidateKind: "wrap-needed",
          },
        ],
        repeatedPatterns: [{ pattern: "table", status: "partial" }],
      },
      draftComponentPlan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [
          { id: "draft-table-container", name: "member table container", reason: "Missing" },
          { id: "draft-table-header-row", name: "member table header row", reason: "Missing" },
          { id: "draft-table-data-row", name: "member table data row", reason: "Missing" },
          { id: "draft-table-cell", name: "member table cell", reason: "Missing" },
        ],
      },
      draftPlan: {
        createdDraftComponents: [
          {
            id: "draft-table-container",
            name: "member table container",
            componentKey: "container-key",
          },
          {
            id: "draft-table-header-row",
            name: "member table header row",
            componentKey: "header-key",
          },
          { id: "draft-table-data-row", name: "member table data row", componentKey: "row-key" },
          { id: "draft-table-cell", name: "member table cell", componentKey: "cell-key" },
        ],
      },
    });

    expect(result.statePatch?.uiComposition?.parts[0]).toMatchObject({
      source: "existing-component",
      componentKey: "table-preview-key",
    });
  });

  it("adds admin data table placement intent to composition parts", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["page shell", "primary action", "member table"] },
      uxEnvelope: adminDataTableEnvelope(),
      fitReport: {
        exactMatches: [
          { requestedPart: "page shell", componentKey: "shell-key" },
          { requestedPart: "primary action", componentKey: "action-key" },
          { requestedPart: "member table", componentKey: "table-key" },
        ],
        substitutes: [],
        missingComponents: [],
      },
    });

    expect(result.statePatch?.uiComposition?.parts).toEqual([
      expect.objectContaining({ id: "page-shell", placement: "left-sidebar" }),
      expect.objectContaining({ id: "primary-action", placement: "top-right-action" }),
      expect.objectContaining({ id: "member-table", placement: "table-body" }),
    ]);
  });

  it("places transaction table parts in the admin data table body", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: { requiredUiParts: ["transaction history table"] },
      uxEnvelope: adminDataTableEnvelope(),
      fitReport: {
        exactMatches: [
          { requestedPart: "transaction history table", componentKey: "transaction-table-key" },
        ],
      },
    });

    expect(result.statePatch?.uiComposition?.parts).toEqual([
      expect.objectContaining({
        id: "transaction-history-table",
        placement: "table-body",
      }),
    ]);
  });

  it("does not block table/list composition on pre-created component families", async () => {
    const result = await runNode("ui.buildCompositionContract", {
      screen: {
        requiredUiParts: ["member table"],
        repeatedPatterns: ["table"],
        states: ["loading", "empty", "error"],
      },
      fitReport: {
        exactMatches: [],
        substitutes: [],
        missingComponents: [{ requestedPart: "member table" }],
        repeatedPatterns: [{ pattern: "table", status: "gap" }],
      },
    });

    expect(result.statePatch?.uiComposition?.parts).toEqual([
      expect.objectContaining({
        name: "member table",
        source: "screen-draft",
        extractionCandidate: true,
      }),
    ]);
  });

  it("rejects partial component imitation in repeated rows/cards/cells", async () => {
    await expect(
      runNode("ui.validateNoHardcodedImitation", {
        uiComposition: {
          schemaVersion: "UICompositionContract/v1",
          parts: [
            {
              id: "row",
              name: "member row",
              role: "row",
              source: "existing-component",
              componentKey: "row-key",
            },
          ],
        },
        draftPlan: {
          repeatedItems: [
            {
              name: "member rows",
              instances: ["row-key"],
              looseLayers: ["name text", "status chip"],
            },
          ],
        },
      })
    ).rejects.toThrow("hardcoded component imitation");
  });

  it("builds a state representation contract from the state matrix", async () => {
    const result = await runNode("ui.buildStateRepresentationContract", {
      stateMatrix: stateMatrix(),
    });

    expect(result.statePatch?.stateRepresentation).toMatchObject({
      schemaVersion: "StateRepresentationContract/v1",
      states: [
        expect.objectContaining({
          stateId: "members-loading",
          representation: "region-state",
        }),
      ],
    });
  });

  it("rejects region states applied as preview cards", async () => {
    await expect(
      runNode("ui.verifyStateRepresentation", {
        stateRepresentation: {
          schemaVersion: "StateRepresentationContract/v1",
          states: [
            {
              stateId: "members-loading",
              kind: "loading",
              scope: "region",
              representation: "region-state",
              replacementBehavior: "replace-table-body",
              persistentRegions: ["sidebar"],
            },
          ],
        },
        applyReport: {
          states: [
            {
              stateId: "members-loading",
              representation: "preview-card",
            },
          ],
        },
      })
    ).rejects.toThrow("preview card");
  });

  it("builds an auto-layout layout contract and rejects structural frames without layout", async () => {
    const result = await runNode("ui.buildLayoutContract", {
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "button",
            name: "primary button",
            role: "primary-action",
            source: "existing-component",
            componentKey: "button-key",
          },
        ],
      },
    });
    expect(result.statePatch?.layoutContract).toMatchObject({
      schemaVersion: "LayoutContract/v1",
      strategy: "auto-layout",
      frames: expect.arrayContaining([expect.objectContaining({ mode: "auto-layout" })]),
    });

    await expect(
      runNode("ui.buildLayoutContract", {
        uiComposition: {
          schemaVersion: "UICompositionContract/v1",
          parts: [
            {
              id: "bad",
              name: "bad frame",
              role: "content",
              source: "approved-primitive",
              primitiveReason: "test",
            },
          ],
          notes: ["no-layout"],
        },
      })
    ).rejects.toThrow("auto layout or grid");
  });

  it("pauses literal variable fallbacks for approval", async () => {
    const output = await runNode("ui.buildVariableBindingPlan", {
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "surface",
            name: "surface",
            role: "content",
            source: "approved-primitive",
            primitiveReason: "background frame",
          },
        ],
      },
      designSystem: { variables: [] },
    });

    expect(output.statePatch?.pendingQuestion).toMatchObject({
      id: "approve-literal-variable-fallback",
    });
  });

  it("uses available local variables without requiring every token category", async () => {
    const output = await runNode("ui.buildVariableBindingPlan", {
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "button",
            name: "primary button",
            role: "primary-action",
            source: "existing-component",
            componentKey: "button-key",
          },
        ],
      },
      designSystem: {
        variables: [
          {
            kind: "color",
            name: "color.bg.default",
            id: "var-color",
            key: "var-color-key",
          },
          { kind: "spacing", name: "space.200", id: "var-space" },
        ],
      },
    });

    expect(output.statePatch?.pendingQuestion).toBeUndefined();
    expect(output.statePatch?.variableBindingPlan).toMatchObject({
      bindings: [
        expect.objectContaining({
          targetId: "button",
          property: "fill",
          source: "variable",
          id: "var-color",
          key: "var-color-key",
        }),
        expect.objectContaining({
          targetId: "button",
          property: "spacing",
          source: "variable",
          id: "var-space",
        }),
      ],
    });
  });

  it("uses approved literal variable fallbacks from the graph answer map", async () => {
    const output = await runNode("ui.buildVariableBindingPlan", {
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "button",
            name: "primary button",
            role: "primary-action",
            source: "existing-component",
            componentKey: "button-key",
          },
        ],
      },
      designSystem: { variables: [] },
      answers: {
        "approve-literal-variable-fallback": "approve-draft-only-literals",
      },
    });

    expect(output.statePatch?.variableBindingPlan).toMatchObject({
      bindings: expect.arrayContaining([
        expect.objectContaining({
          targetId: "button",
          property: "fill",
          source: "approved-literal",
        }),
      ]),
    });
  });
});

async function runNode(key: string, patch: Partial<KotikitGraphState>): Promise<NodeOutput> {
  const node = uiCompositionNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-ui",
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

function stateMatrix(): NonNullable<KotikitGraphState["stateMatrix"]> {
  return {
    schemaVersion: "StateMatrix/v1",
    states: [
      {
        id: "members-loading",
        label: "Loading",
        kind: "loading",
        scope: "region",
        affectedRegion: "members table",
        persistentRegions: ["sidebar"],
        replacementBehavior: "replace-table-body",
        requiredComponents: ["skeleton row"],
        sourceRefs: ["https://carbondesignsystem.com/patterns/empty-states-pattern/"],
      },
    ],
  };
}

function adminDataTableEnvelope(): NonNullable<KotikitGraphState["uxEnvelope"]> {
  return {
    schemaVersion: "UXEnvelope/v1",
    screenArchetype: "admin-data-table",
    confidence: "observed",
    actor: "Admin",
    primaryGoal: "Manage members",
    primaryTask: "Review member records",
    secondaryTasks: ["Filter members"],
    dataModel: {
      primaryEntity: "member",
      expectedVolume: "many",
      fields: ["name", "status"],
    },
    permissions: ["member:read"],
    edgeCases: ["empty member list"],
    assumptions: ["Members are shown in a table"],
    sourceRefs: ["https://example.com/members"],
  };
}
