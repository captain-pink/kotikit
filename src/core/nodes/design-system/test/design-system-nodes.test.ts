import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initComponentsDb, upsertComponent } from "../../../../db/components-db.js";
import { openDb } from "../../../../db/sqlite.js";
import { nowIso } from "../../../../util/ids.js";
import { componentJsonPath, componentsDbPath, variablesJsonPath } from "../../../../util/paths.js";
import { loadBuiltInFlows } from "../../../flows/catalog.js";
import { compileFlowDefinition } from "../../../graph/compiler.js";
import { createNodeRegistry } from "../../../graph/node-registry.js";
import type { FlowDefinition } from "../../../schemas/flow-definition.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { createDesignSystemNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: unknown[];
  interrupt?: { pendingQuestion?: { id: string; prompt: string; choices?: string[] } };
};

const tmpDirs: string[] = [];

afterAll(() => {
  tmpDirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("design-system graph nodes", () => {
  it("searches the local cache as the primary grounding source", async () => {
    const root = mkProject();
    seedComponents(root, [
      { name: "Button", key: "button-key", props: "Variant Size" },
      { name: "Data Table", key: "table-key", props: "Density Sort Sortable" },
      { name: "Toolbar", key: "toolbar-key", props: "" },
    ]);

    const result = await runNode(
      "designSystem.searchLocal",
      {
        ...state(root),
        screen: {
          requiredUiParts: ["button", "data table", "toolbar"],
          repeatedPatterns: ["table"],
          states: ["loading", "empty", "error", "filled"],
        },
      },
      {}
    );

    expect(result.statePatch?.designSystem).toMatchObject({
      source: "local-cache",
      setupRequired: false,
      components: expect.arrayContaining([
        expect.objectContaining({ name: "Button", key: "button-key" }),
        expect.objectContaining({ name: "Data Table", key: "table-key" }),
      ]),
    });
  });

  it("does not call remote Figma search when local cache has enough matches", async () => {
    const root = mkProject();
    seedComponents(root, [
      { name: "Button", key: "button-key", props: "" },
      { name: "Data Table", key: "table-key", props: "" },
      { name: "Toolbar", key: "toolbar-key", props: "" },
    ]);
    let remoteCalls = 0;
    const nodes = createDesignSystemNodeDefinitions({
      remoteSearch: {
        searchComponents: async () => {
          remoteCalls += 1;
          return { status: "ready", source: "figma-remote", results: [] };
        },
      },
    });
    const local = await runNodeWithDefinitions(
      nodes,
      "designSystem.searchLocal",
      {
        ...state(root),
        screen: { requiredUiParts: ["button", "data table", "toolbar"], repeatedPatterns: [] },
      },
      {}
    );

    await runNodeWithDefinitions(
      nodes,
      "designSystem.searchRemoteOptional",
      { ...state(root), designSystem: local.statePatch?.designSystem },
      {}
    );

    expect(remoteCalls).toBe(0);
  });

  it("loads synced variables into local design-system state", async () => {
    const root = mkProject();
    seedComponents(root, [{ name: "Button", key: "button-key", props: "" }]);
    writeVariables(root);

    const result = await runNode(
      "designSystem.searchLocal",
      {
        ...state(root),
        screen: { requiredUiParts: ["button"], repeatedPatterns: [] },
      },
      {}
    );

    expect(result.statePatch?.designSystem).toMatchObject({
      variables: expect.arrayContaining([
        expect.objectContaining({ name: "Color/Primary", kind: "color" }),
        expect.objectContaining({ name: "Space/200", kind: "spacing" }),
      ]),
    });
  });

  it("merges seeded variables with synced local variables", async () => {
    const root = mkProject();
    seedComponents(root, [{ name: "Button", key: "button-key", props: "" }]);
    writeVariables(root);

    const result = await runNode(
      "designSystem.searchLocal",
      {
        ...state(root),
        screen: { requiredUiParts: ["button"], repeatedPatterns: [] },
        designSystem: {
          variables: [
            { id: "var-radius-small", name: "Radius/Small", kind: "number", source: "seeded" },
          ],
        },
      },
      {}
    );

    expect(result.statePatch?.designSystem).toMatchObject({
      variables: expect.arrayContaining([
        expect.objectContaining({ name: "Color/Primary", kind: "color" }),
        expect.objectContaining({ name: "Radius/Small", kind: "number" }),
      ]),
    });
  });

  it("preserves seeded design-system components when the local cache is missing", async () => {
    const root = mkProject();

    const result = await runNode(
      "designSystem.searchLocal",
      {
        ...state(root),
        screen: { requiredUiParts: ["status chip"], repeatedPatterns: [] },
        designSystem: {
          source: "seeded-context",
          components: [{ name: "Status chip", key: "chip-key", fileKey: "seeded-file" }],
        },
      },
      {}
    );

    expect(result.statePatch?.designSystem).toMatchObject({
      setupRequired: false,
      components: [expect.objectContaining({ name: "Status chip", key: "chip-key" })],
    });
  });

  it("builds a fit report with exact matches, substitutes, gaps, variables, and patterns", async () => {
    const root = mkProject();
    const stateWithDesignSystem = {
      ...state(root),
      screen: {
        requiredUiParts: [
          "primary button",
          "status badge",
          "member table",
          "filters toolbar",
          "email input",
        ],
        repeatedPatterns: ["table", "filters", "form"],
        regions: { tables: ["member table"], lists: [], forms: ["invite form"] },
      },
      designSystem: {
        source: "local-cache",
        setupRequired: false,
        components: [
          { name: "Button", path: "components/button.json", key: "button-key", fileKey: "f" },
          { name: "Badge", path: "components/badge.json", key: "badge-key", fileKey: "f" },
          {
            name: "Data Table",
            path: "components/data-table.json",
            key: "table-key",
            fileKey: "f",
          },
          { name: "Toolbar", path: "components/toolbar.json", key: "toolbar-key", fileKey: "f" },
        ],
        variables: [{ name: "Color/Primary", kind: "color" }],
      },
    } satisfies Partial<KotikitGraphState>;

    const result = await runNode("designSystem.buildFitReport", stateWithDesignSystem, {});
    const report = result.statePatch?.fitReport as {
      exactMatches: unknown[];
      substitutes: unknown[];
      missingComponents: unknown[];
      variableGaps: unknown[];
      repeatedPatterns: unknown[];
    };

    expect(report.exactMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestedPart: "primary button", componentKey: "button-key" }),
        expect.objectContaining({ requestedPart: "member table", componentKey: "table-key" }),
        expect.objectContaining({ requestedPart: "filters toolbar", componentKey: "toolbar-key" }),
      ])
    );
    expect(report.substitutes).toEqual([
      expect.objectContaining({ requestedPart: "status badge", componentKey: "badge-key" }),
    ]);
    expect(report.missingComponents).toEqual([
      expect.objectContaining({ requestedPart: "email input" }),
    ]);
    expect(report.variableGaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "spacing" })])
    );
    expect(report.repeatedPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pattern: "table", status: "covered" }),
        expect.objectContaining({ pattern: "form", status: "gap" }),
      ])
    );
  });

  it("classifies close repeated-pattern matches as wrap candidates instead of exact or missing", async () => {
    const root = mkProject();
    const stateWithDesignSystem = {
      ...state(root),
      screen: {
        requiredUiParts: ["member table"],
        repeatedPatterns: ["table"],
      },
      designSystem: {
        source: "local-cache",
        setupRequired: false,
        components: [
          {
            name: "Table preview",
            path: "components/table-preview.json",
            key: "table-preview-key",
            fileKey: "f",
          },
        ],
        variables: [],
      },
    } satisfies Partial<KotikitGraphState>;

    const result = await runNode("designSystem.buildFitReport", stateWithDesignSystem, {});
    const report = result.statePatch?.fitReport as {
      exactMatches: unknown[];
      wrapCandidates: unknown[];
      missingComponents: unknown[];
      repeatedPatterns: unknown[];
    };

    expect(report.exactMatches).toEqual([]);
    expect(report.wrapCandidates).toEqual([
      expect.objectContaining({
        requestedPart: "member table",
        componentKey: "table-preview-key",
        candidateKind: "wrap-needed",
      }),
    ]);
    expect(report.missingComponents).toEqual([]);
    expect(report.repeatedPatterns).toEqual([
      expect.objectContaining({
        pattern: "table",
        status: "partial",
        componentKey: "table-preview-key",
      }),
    ]);
  });

  it("pauses for a draft-component decision when meaningful UI parts are missing", async () => {
    const output = await runNode(
      "designSystem.askMissingComponentDecision",
      {
        ...state(mkProject()),
        fitReport: {
          missingComponents: [
            { requestedPart: "email input", reason: "No local component found." },
          ],
        },
      },
      {}
    );

    expect(output.interrupt?.pendingQuestion).toMatchObject({
      id: "missing-components",
      choices: ["create-draft-components", "approve-primitive-exceptions"],
    });
  });

  it("uses the missing-component decision answer instead of interrupting again", async () => {
    const output = await runNode(
      "designSystem.askMissingComponentDecision",
      {
        ...state(mkProject()),
        answers: { "missing-components": "create-draft-components" },
        fitReport: {
          missingComponents: [
            { requestedPart: "email input", reason: "No local component found." },
          ],
        },
      },
      {}
    );

    expect(output.interrupt).toBeUndefined();
    expect(output.statePatch?.fitReport).toMatchObject({
      missingComponents: [expect.objectContaining({ requestedPart: "email input" })],
    });
  });

  it("records approved primitive exceptions from the missing-component decision answer", async () => {
    const output = await runNode(
      "designSystem.askMissingComponentDecision",
      {
        ...state(mkProject()),
        answers: { "missing-components": "approve-primitive-exceptions" },
        fitReport: {
          missingComponents: [
            { requestedPart: "email input", reason: "No local component found." },
            { requestedPart: "status helper", reason: "No local component found." },
          ],
        },
      },
      {}
    );

    expect(output.interrupt).toBeUndefined();
    expect(output.statePatch?.fitReport).toMatchObject({
      approvedPrimitiveExceptions: ["email input", "status helper"],
    });
  });

  it("saves a compact design-system fit artifact", async () => {
    const output = await runNode(
      "designSystem.saveFitReport",
      {
        ...state(mkProject()),
        fitReport: {
          summary: "3 exact matches, 1 missing component.",
          exactMatches: [{ requestedPart: "button", componentKey: "button-key" }],
          missingComponents: [{ requestedPart: "email input" }],
          substitutes: [],
          variableGaps: [],
          repeatedPatterns: [],
        },
      },
      {}
    );

    expect(output.artifacts?.[0]).toMatchObject({
      type: "design-system-fit-report",
      schemaVersion: "DesignSystemFitReport/v1",
      payload: {
        schemaVersion: "DesignSystemFitReport/v1",
        summary: "3 exact matches, 1 missing component.",
        refs: ["exact: button -> button-key", "missing: email input"],
      },
    });
  });

  it("saves a visible design-system reuse plan before draft decisions", async () => {
    const output = await runNode(
      "designSystem.saveReusePlan",
      {
        ...state(mkProject()),
        fitReport: {
          summary: "1 exact match, 1 wrap candidate, 1 missing component.",
          exactMatches: [
            {
              requestedPart: "primary button",
              componentName: "Button",
              componentKey: "button-key",
            },
          ],
          substitutes: [
            { requestedPart: "status chip", componentName: "Badge", componentKey: "badge-key" },
          ],
          wrapCandidates: [
            {
              requestedPart: "member table",
              componentName: "Table preview",
              componentKey: "table-preview-key",
              candidateKind: "wrap-needed",
              reason: "Candidate can provide a reusable base.",
            },
          ],
          missingComponents: [{ requestedPart: "table data row" }],
          variableGaps: [],
          repeatedPatterns: [],
        },
      },
      {}
    );

    expect(output.artifacts?.[0]).toMatchObject({
      type: "design-system-reuse-plan",
      schemaVersion: "DesignSystemReusePlan/v1",
      payload: {
        schemaVersion: "DesignSystemReusePlan/v1",
        summary:
          "Reuse 1 exact component, validate 1 substitute, wrap 1 close candidate, draft 1 gap.",
        refs: [
          "reuse: primary button -> button-key",
          "substitute: status chip -> badge-key",
          "wrap: member table -> table-preview-key",
          "draft: table data row",
        ],
      },
    });
  });

  it("saves a final design-system usage report from composition and Figma proof", async () => {
    const output = await runNode(
      "designSystem.saveUsageReport",
      {
        ...state(mkProject()),
        uiComposition: {
          schemaVersion: "UICompositionContract/v1",
          parts: [
            {
              id: "primary-button",
              name: "Primary button",
              role: "primary-action",
              source: "existing-component",
              componentKey: "button-key",
            },
            {
              id: "table-row",
              name: "Table row",
              role: "row",
              source: "draft-component",
              componentKey: "row-key",
              draftComponentId: "draft-table-row",
            },
            {
              id: "divider",
              name: "Divider",
              role: "content",
              source: "approved-primitive",
              primitiveReason: "Approved primitive separator.",
            },
            {
              id: "member-table",
              name: "Member table",
              role: "data-display",
              source: "screen-draft",
              extractionCandidate: true,
            },
          ],
        },
        applyReport: {
          iconRefs: ["search-icon-key"],
        },
        draftComponentLifecycle: {
          schemaVersion: "DraftComponentLifecycle/v1",
          sectionName: "Kotikit Draft Components",
          components: [
            {
              draftComponentId: "draft-table-row",
              name: "Table row",
              reason: "Missing row component",
              componentKey: "row-key",
              placement: {},
              requiredInstances: 1,
              actualInstances: [{ nodeId: "2:1" }],
              status: "used",
            },
          ],
        },
      },
      {}
    );

    expect(output.artifacts?.[0]).toMatchObject({
      type: "design-system-usage-report",
      schemaVersion: "DesignSystemUsageReport/v1",
      payload: {
        schemaVersion: "DesignSystemUsageReport/v1",
        summary:
          "Reused 1 design-system component, kept 1 screen-draft part, used 1 draft component, used 1 icon, kept 1 primitive exception.",
        refs: [
          "reused: Primary button -> button-key",
          "screen-draft: Member table",
          "drafted: Table row -> row-key",
          "icon: search-icon-key",
          "primitive: Divider",
        ],
      },
    });
  });

  it("compiles create-screen with reuse planning before composition and usage reporting after QA", async () => {
    const flow = requireFlow(await loadBuiltInFlows(), "create-screen");
    const saveReuseIndex = flow.nodes.findIndex(
      (node) => node.uses === "designSystem.saveReusePlan"
    );
    const compositionIndex = flow.nodes.findIndex(
      (node) => node.uses === "ui.buildCompositionContract"
    );
    const usageReportIndex = flow.nodes.findIndex(
      (node) => node.uses === "designSystem.saveUsageReport"
    );
    const qaIndex = flow.nodes.findIndex((node) => node.uses === "qa.postDraftQa");

    expect(saveReuseIndex).toBeGreaterThan(-1);
    expect(compositionIndex).toBeGreaterThan(saveReuseIndex);
    expect(flow.nodes.map((node) => node.uses)).not.toContain(
      "designSystem.askMissingComponentDecision"
    );
    expect(usageReportIndex).toBeGreaterThan(qaIndex);
  });

  it("declares a remote-read capability for optional Figma remote search", () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      id: "remote-design-system-search",
      version: "1.0.0",
      title: "Remote Design System Search",
      description: "Compile-time capability check for optional remote search.",
      stateSchema: "KotikitGraphState/v1",
      requiredCapabilities: ["figma.read.remote"],
      nodes: [
        {
          id: "search-remote",
          uses: "designSystem.searchRemoteOptional",
          params: {},
        },
      ],
      edges: [],
      start: "search-remote",
      end: ["search-remote"],
      safetyProfile: "test",
    };
    const registry = createNodeRegistry(createDesignSystemNodeDefinitions());

    expect(() =>
      compileFlowDefinition(flow, registry, { allowedCapabilities: flow.requiredCapabilities })
    ).not.toThrow();
  });
});

async function runNode(
  key: string,
  patch: Partial<KotikitGraphState>,
  params: unknown
): Promise<NodeOutput> {
  return runNodeWithDefinitions(createDesignSystemNodeDefinitions(), key, patch, params);
}

async function runNodeWithDefinitions(
  definitions: ReturnType<typeof createDesignSystemNodeDefinitions>,
  key: string,
  patch: Partial<KotikitGraphState>,
  params: unknown
): Promise<NodeOutput> {
  const node = definitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({
    nodeId: key,
    state: { ...state(mkProject()), ...patch },
    params,
  })) as NodeOutput;
}

function state(root: string): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-design-system",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root },
    userIntent: "Create a members table with filters.",
    artifacts: [],
    errors: [],
  };
}

function mkProject(): string {
  const root = mkdtempSync(join(tmpdir(), "kotikit-ds-node-"));
  tmpDirs.push(root);
  return root;
}

function seedComponents(
  root: string,
  components: { name: string; key: string; props: string }[]
): void {
  const db = openDb(componentsDbPath(root));
  initComponentsDb(db);
  components.forEach((component) => {
    const slug = component.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    upsertComponent(db, {
      name: component.name,
      path: `components/${slug}.json`,
      key: component.key,
      fileKey: "file-a",
      props: component.props,
    });
    const path = componentJsonPath(root, slug);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        name: component.name,
        key: component.key,
        fileKey: "file-a",
        path: `components/${slug}.json`,
        variants: [],
        properties: {},
        updatedAt: nowIso(),
      })
    );
  });
  db.close();
}

function writeVariables(root: string): void {
  const path = variablesJsonPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "var-color-primary",
          name: "Color/Primary",
          kind: "color",
          source: "variable",
          value: "#0055ff",
        },
        {
          id: "var-space-200",
          name: "Space/200",
          kind: "spacing",
          source: "variable",
          value: 8,
        },
      ],
      collisions: [],
    })
  );
}

function requireFlow(flows: FlowDefinition[], id: string): FlowDefinition {
  const flow = flows.find((candidate) => candidate.id === id);
  if (flow === undefined) throw new Error(`Expected ${id} flow.`);
  return flow;
}
