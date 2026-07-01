import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadBuiltInFlows } from "../../../src/core/flows/catalog.js";
import { createGraphRuntime, type GraphRuntime } from "../../../src/core/graph/runtime.js";
import { createBuiltInNodeRegistry } from "../../../src/core/nodes/built-in-registry.js";
import { type ArtifactStore, createArtifactStore } from "../../../src/core/runs/artifact-store.js";
import { createCheckpointStore } from "../../../src/core/runs/checkpoint-store.js";
import { createRunStore } from "../../../src/core/runs/run-store.js";
import type { KotikitGraphState } from "../../../src/core/schemas/graph-state.js";
import { initComponentsDb, upsertComponent } from "../../../src/db/components-db.js";
import { openDb } from "../../../src/db/sqlite.js";
import { nowIso } from "../../../src/util/ids.js";
import { componentJsonPath, componentsDbPath, variablesJsonPath } from "../../../src/util/paths.js";

export type GraphSmokeFixture = {
  artifactStore: ArtifactStore;
  runtime: GraphRuntime;
};

export type SeedOptions = {
  includePrimaryAction?: boolean;
  includeSecondaryAction?: boolean;
  includeProductFlowParts?: boolean;
};

type SeedComponent = {
  name: string;
  key: string;
  props?: string;
};

export async function createGraphSmokeFixture(root: string): Promise<GraphSmokeFixture> {
  return {
    artifactStore: createArtifactStore(root),
    runtime: createGraphRuntime({
      registry: createBuiltInNodeRegistry(),
      flowCatalog: await loadBuiltInFlows(),
      runStore: createRunStore(root),
      artifactStore: createArtifactStore(root),
      checkpointStore: createCheckpointStore(root),
    }),
  };
}

export function seedLocalDesignSystem(root: string, options: SeedOptions = {}): void {
  const components = [
    { name: "Page Shell", key: "page-shell-key" },
    { name: "Content Heading", key: "content-heading-key" },
    ...(options.includePrimaryAction === false
      ? []
      : [{ name: "Primary Action", key: "button-primary-key", props: "Variant Size State" }]),
    { name: "Form Fields", key: "form-fields-key", props: "State" },
    ...(options.includeSecondaryAction === true
      ? [{ name: "Secondary Action", key: "button-secondary-key", props: "Variant Size State" }]
      : []),
    ...(options.includeProductFlowParts === true
      ? [
          { name: "Email Input", key: "email-input-key", props: "State" },
          { name: "Role Selector", key: "role-selector-key", props: "State" },
        ]
      : []),
  ] satisfies SeedComponent[];

  const db = openDb(componentsDbPath(root));
  initComponentsDb(db);
  components.forEach((component) => {
    seedComponent(root, db, component);
  });
  db.close();
  writeVariables(root);
}

export function fakeDraftTarget(
  pageName = "Draft - Kotikit Smoke"
): KotikitGraphState["figmaTarget"] {
  return {
    fileKey: "FILE_SMOKE",
    pageId: "1:2",
    pageName,
    pageUrl: "https://www.figma.com/design/FILE_SMOKE/Kotikit-Smoke?node-id=1-2",
    boundAt: "2026-06-30T00:00:00.000Z",
    source: "user-url",
    section: {
      id: "section-smoke",
      name: "kotikit / smoke / 2026-06-30",
    },
    safety: {
      requireDraftPageName: true,
      allowPageCreation: false,
      requireKotikitSection: true,
    },
  };
}

export function fakeApplyMetadataFor(state: KotikitGraphState): Record<string, unknown> {
  const packet = recordFrom(recordFrom(state.draftPlan).applyPacket);
  const target = {
    ...recordFrom(state.figmaTarget),
    ...recordFrom(packet.target),
  };
  const uiComposition = recordFrom(state.uiComposition ?? packet.uiComposition);
  const variableBindingPlan = recordFrom(state.variableBindingPlan ?? packet.variableBindingPlan);
  const layoutContract = recordFrom(state.layoutContract ?? packet.layoutContract);
  const parts = recordArray(uiComposition.parts);

  return {
    fileKey: target.fileKey,
    pageId: target.pageId,
    sectionName: stringField(recordFrom(target.section), "name"),
    nodes: parts.map((part) => ({
      id: `node-${String(part.id)}`,
      partId: part.id,
      name: part.name,
      componentName: part.name,
      componentKey: part.componentKey,
      draftComponentId: part.draftComponentId,
      expectedComponentRef: true,
      width: 320,
      height: 48,
      textDirection: "horizontal",
      mirroredText: false,
      transform: { scaleX: 1, scaleY: 1 },
      clippedText: false,
      detachedInstance: false,
      overlaps: [],
      hardcodedComponentImitation: false,
    })),
    variableBindings: recordArray(variableBindingPlan.bindings),
    layoutFrames: recordArray(layoutContract.frames),
    repeatedItems: recordArray(packet.repeatedItems),
    textTransforms: recordArray(packet.textTransforms),
  };
}

export function fakeReviewEvidence(): Record<string, unknown> {
  return {
    target: {
      source: "figma",
      fileKey: "FILE_SMOKE",
      nodeId: "9:10",
      targetKind: "frame",
      targetName: "Members Review Frame",
      figmaUrl: "https://www.figma.com/design/FILE_SMOKE/Kotikit-Smoke?node-id=9-10",
      scope: "members",
      screen: "admin",
    },
    evidence: {
      collectedAt: "2026-06-30T00:00:00.000Z",
      tokenBudget: {
        maxRegions: 8,
        returnedRegions: 2,
        truncatedRegions: 0,
      },
      targetSummary: {
        nodeId: "9:10",
        name: "Members Review Frame",
        type: "FRAME",
        kind: "frame",
        childCount: 2,
      },
      regions: [
        { nodeId: "primary-action", name: "Primary Action", type: "INSTANCE" },
        { nodeId: "content-heading", name: "Content Heading", type: "TEXT" },
      ],
      notes: ["Fixture evidence is bounded and local."],
    },
    findings: [
      {
        theme: "color",
        severity: "high",
        confidence: "observed",
        title: "Strengthen primary action contrast",
        observation: "The primary action is visible but not prominent enough.",
        rationale: "The main action should carry the strongest visual emphasis.",
        recommendation: "Bind the primary action fill to Color/Primary.",
        nodeId: "primary-action",
        partName: "Primary Action",
        componentKey: "button-primary-key",
        variableBindings: [
          {
            targetId: "primary-action",
            property: "fill",
            source: "variable",
            name: "Color/Primary",
            id: "var-color-primary",
          },
        ],
      },
    ],
  };
}

export function fakeCommentSnapshot(): Record<string, unknown> {
  return {
    commentSnapshot: {
      comments: [
        {
          id: "comment-1",
          message: "Please tighten the spacing around the primary action.",
          nodeId: "primary-action",
          targetName: "Primary Action",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    },
  };
}

function seedComponent(
  root: string,
  db: ReturnType<typeof openDb>,
  component: SeedComponent
): void {
  const slug = slugify(component.name);
  upsertComponent(db, {
    name: component.name,
    path: `components/${slug}.json`,
    key: component.key,
    fileKey: "FILE_DS",
    props: component.props ?? "State",
  });
  const path = componentJsonPath(root, slug);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        name: component.name,
        key: component.key,
        fileKey: "FILE_DS",
        path: `components/${slug}.json`,
        variants: [{ propertyName: "State", values: ["Default"] }],
        properties: { State: { type: "VARIANT" } },
        updatedAt: nowIso(),
      },
      null,
      2
    )}\n`
  );
}

function writeVariables(root: string): void {
  const path = variablesJsonPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
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
            id: "style-text-body",
            name: "Text/Body",
            kind: "text",
            source: "style",
            value: "Inter 14",
          },
          {
            id: "var-space-400",
            name: "Space/400",
            kind: "spacing",
            source: "variable",
            value: 16,
          },
          {
            id: "style-effect-raised",
            name: "Effect/Raised",
            kind: "effect",
            source: "style",
            value: "shadow-sm",
          },
        ],
        collisions: [],
      },
      null,
      2
    )}\n`
  );
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

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
