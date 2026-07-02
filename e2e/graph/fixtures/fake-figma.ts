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

export async function drainFakeFigmaTransactions(
  runtime: GraphRuntime,
  runId: string
): Promise<KotikitGraphState> {
  let state = await runtime.getRunState(runId);
  let drainedTransactions = 0;

  while (state.status === "waiting-for-figma") {
    drainedTransactions += 1;
    if (drainedTransactions > 50) {
      throw new Error("Fake Figma transaction drain exceeded the safety limit.");
    }

    const active = recordFrom(state.activeFigmaTransaction);
    if (active.id === undefined) {
      throw new Error("Missing active fake transaction.");
    }

    await runtime.patchRunState({
      runId,
      statePatch: {
        applyMetadata: fakeTransactionMetadataFor(state),
      },
    });
    state = (await runtime.continueRun({ runId })).state;
  }

  return state;
}

export function fakeTransactionMetadataFor(state: KotikitGraphState): Record<string, unknown> {
  const active = recordFrom(state.activeFigmaTransaction);
  const transactionId = stringField(active, "id");
  if (transactionId === undefined) {
    throw new Error("Missing active fake transaction.");
  }

  const target = figmaTargetFrom(state);
  const placement = recordArray(recordFrom(state.canvasPlan).placements).find(
    (candidate) => candidate.id === active.placementId
  );
  const bounds = boundsForActive(placement);
  return {
    transactionId,
    fileKey: stringField(target, "fileKey"),
    pageId: stringField(target, "pageId"),
    sectionName: stringField(recordFrom(target.section), "name"),
    figmaNodeId: `node-${transactionId}`,
    figmaNodeName: stringField(active, "label") ?? transactionId,
    figmaNodeKind: "FRAME",
    bounds,
    representation: stateRepresentationForActive(state, active),
    componentRefs: componentRefsForActive(state),
    variableRefs: variableRefsFrom(state),
    autoLayout: true,
    nodes: compactChildNodesForActive(state, active, bounds),
  };
}

function figmaTargetFrom(state: KotikitGraphState): Record<string, unknown> {
  const packet = recordFrom(recordFrom(state.draftPlan).applyPacket);
  return {
    ...recordFrom(state.figmaTarget),
    ...recordFrom(packet.target),
  };
}

function componentRefsFrom(state: KotikitGraphState): string[] {
  const packet = recordFrom(recordFrom(state.draftPlan).applyPacket);
  const uiComposition = recordFrom(state.uiComposition ?? packet.uiComposition);
  return uniqueStrings(
    recordArray(uiComposition.parts).flatMap((part) => [
      stringField(part, "componentKey"),
      stringField(part, "draftComponentId"),
    ])
  );
}

function componentRefsForActive(state: KotikitGraphState): string[] {
  return componentRefsFrom(state);
}

function compactChildNodesForActive(
  state: KotikitGraphState,
  active: Record<string, unknown>,
  parentBounds: Record<string, unknown>
): Record<string, unknown>[] {
  const kind = stringField(active, "kind");
  if (kind !== "create-screen-state" && kind !== "create-region-state") return [];

  const packet = recordFrom(recordFrom(state.draftPlan).applyPacket);
  const uiComposition = recordFrom(state.uiComposition ?? packet.uiComposition);
  return recordArray(uiComposition.parts).map((part, index) => ({
    id: `node-${String(active.id)}-${String(part.id)}`,
    name: stringField(part, "name") ?? String(part.id),
    kind: "INSTANCE",
    partId: stringField(part, "id"),
    ...(stringField(part, "draftComponentId") === undefined
      ? {}
      : { draftComponentId: stringField(part, "draftComponentId") }),
    bounds: childBoundsWithin(parentBounds, index),
    componentRefs: uniqueStrings([
      stringField(part, "componentKey"),
      stringField(part, "draftComponentId"),
    ]),
    ...(componentSourceFrom(part) === undefined
      ? {}
      : { componentSource: componentSourceFrom(part) }),
    variableRefs: variableRefsFrom(state),
    autoLayout: true,
  }));
}

function boundsForActive(placement: Record<string, unknown> | undefined): Record<string, unknown> {
  const placementBounds = recordFrom(placement?.bounds);
  if (Object.keys(placementBounds).length > 0) return placementBounds;
  return { x: 0, y: 0, width: 1440, height: 960 };
}

function componentSourceFrom(
  part: Record<string, unknown>
): "existing-component" | "draft-component" | "approved-primitive" | undefined {
  if (part.source === "existing-component") return "existing-component";
  if (part.source === "draft-component") return "draft-component";
  if (part.source === "approved-primitive") return "approved-primitive";
  return undefined;
}

function childBoundsWithin(
  parentBounds: Record<string, unknown>,
  index: number
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const parentX = typeof parentBounds.x === "number" ? parentBounds.x : 0;
  const parentY = typeof parentBounds.y === "number" ? parentBounds.y : 0;
  return {
    x: parentX + 960,
    y: parentY + 96 + index * 72,
    width: 240,
    height: 48,
  };
}

function variableRefsFrom(state: KotikitGraphState): string[] {
  const packet = recordFrom(recordFrom(state.draftPlan).applyPacket);
  const variableBindingPlan = recordFrom(state.variableBindingPlan ?? packet.variableBindingPlan);
  return uniqueStrings(
    recordArray(variableBindingPlan.bindings)
      .filter((binding) =>
        ["variable", "style", "draft-variable"].includes(String(binding.source ?? ""))
      )
      .flatMap((binding) => [stringField(binding, "id"), stringField(binding, "name")])
  );
}

function stateRepresentationForActive(
  state: KotikitGraphState,
  active: Record<string, unknown>
): string | undefined {
  return stringField(
    recordArray(recordFrom(state.stateRepresentation).states).find(
      (candidate) => candidate.stateId === active.stateId
    ) ?? {},
    "representation"
  );
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
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
