import type { StateMatrix, UXEnvelope } from "../schemas/artifact.js";
import type { ScreenBlueprintInput } from "../schemas/blueprint.js";
import {
  builtInPatternPacks,
  selectPatternPack,
  type UXPatternPack,
  type UXPatternPackState,
} from "./ux-pattern-pack.js";

type BuildUxEnvelopeInput = {
  userIntent: string;
  explicitBlueprint?: boolean;
  screen?: {
    title?: string;
    confidence?: "explicit" | "inferred" | "low";
    requiredUiParts?: string[];
    states?: string[];
    traits?: UXEnvelope["traits"];
  };
  patternPack?: UXPatternPack;
};

type BuildStateMatrixInput = {
  envelope: UXEnvelope;
  patternPack?: UXPatternPack;
  requestedStates?: NonNullable<ScreenBlueprintInput["states"]>;
};

const FALLBACK_SOURCE_REF = "https://www.nngroup.com/articles/task-analysis/";

/** Classify only simple fallback intent into a broad built-in UX archetype. */
export function classifyScreenArchetype(userIntent: string): UXEnvelope["screenArchetype"] {
  const tokens = tokenSet(userIntent);
  if (tokens.includes("table")) return "admin-data-table";
  if (
    tokens.some((token) =>
      ["dashboard", "overview", "summary", "analytics", "metrics"].includes(token)
    )
  ) {
    return "dashboard";
  }
  if (
    tokens.some((token) =>
      ["settings", "preferences", "profile", "configuration", "form"].includes(token)
    )
  ) {
    return "settings-form";
  }
  return "unknown";
}

/** Build the compact UX contract used by state and composition planning. */
export function buildUxEnvelope(input: BuildUxEnvelopeInput): UXEnvelope {
  const traits = normalizedTraits(input.screen?.traits);
  const explicitPatternPack = patternPackFromTraits(traits);
  const explicitArchetype =
    explicitPatternPack && screenArchetypeForPatternPack(explicitPatternPack);
  const screenArchetype =
    explicitArchetype ??
    (input.explicitBlueprint || input.screen?.confidence === "low" || hasComposableTraits(traits)
      ? "unknown"
      : classifyScreenArchetype(
          [input.userIntent, input.screen?.title, ...(input.screen?.requiredUiParts ?? [])].join(
            " "
          )
        ));
  const patternPack =
    input.patternPack ?? explicitPatternPack ?? selectPatternPack(screenArchetype);
  const defaults = patternPack.envelopeDefaults ?? createFallbackEnvelopeDefaults(input);
  const requestedStates = uniqueStrings([
    ...(input.screen?.confidence === "low" ? [] : (input.screen?.states ?? [])),
    ...(input.explicitBlueprint ? [] : (defaults.edgeCases ?? [])),
  ]);

  return {
    schemaVersion: "UXEnvelope/v1",
    screenArchetype,
    confidence:
      screenArchetype === "unknown"
        ? input.explicitBlueprint
          ? "observed"
          : "low"
        : defaults.confidence,
    actor: defaults.actor,
    primaryGoal: defaults.primaryGoal,
    primaryTask: defaults.primaryTask,
    secondaryTasks: defaults.secondaryTasks,
    dataModel: defaults.dataModel,
    permissions: defaults.permissions,
    edgeCases: requestedStates,
    assumptions: defaults.assumptions,
    sourceRefs: uniqueStrings([...patternPack.sourceRefs, FALLBACK_SOURCE_REF]),
    ...(hasComposableTraits(traits) ? { traits } : {}),
    ...((traits.patternPackIds ?? []).length > 0 ? { patternPackIds: traits.patternPackIds } : {}),
  };
}

/** Create the state matrix from the chosen pattern pack and requested states. */
export function buildStateMatrix(input: BuildStateMatrixInput): StateMatrix {
  const patternPack = input.patternPack ?? selectPatternPack(input.envelope.screenArchetype);
  if (input.requestedStates !== undefined) {
    const explicitIds = input.requestedStates
      .map((state) => state.id)
      .filter((id): id is string => id !== undefined);
    if (new Set(explicitIds).size !== explicitIds.length) {
      throw new Error("Duplicate blueprint state id in requested states.");
    }
    const usedIds = new Set(explicitIds);
    return {
      schemaVersion: "StateMatrix/v1",
      states: input.requestedStates.map((requested) => {
        const kind = normalizeStateKind(requested.kind);
        const pattern =
          patternPack.defaultStates.find((state) => state.kind === kind) ??
          genericState(kind, input.envelope);
        const state = stateMatrixStateFromPattern(pattern);
        const label = requested.name ?? labelForKind(requested.kind);
        const baseId =
          requested.id ?? `${slug(state.affectedRegion ?? "primary content")}-${slug(label)}`;
        const id = requested.id ?? uniqueStateId(baseId, usedIds);
        return { ...state, id, label, requestedKind: requested.kind, copy: { title: label } };
      }),
    };
  }

  const requestedKinds = new Set(input.envelope.edgeCases.map(normalizeStateKind));
  const matchedStates = patternPack.defaultStates.filter((state) => requestedKinds.has(state.kind));
  const matchedKinds = new Set(matchedStates.map((state) => state.kind));
  const resolvedStates =
    requestedKinds.size > 0
      ? [
          ...matchedStates,
          ...Array.from(requestedKinds)
            .filter((kind) => !matchedKinds.has(kind))
            .map((kind) => genericState(kind, input.envelope)),
        ]
      : patternPack.defaultStates;

  return {
    schemaVersion: "StateMatrix/v1",
    states: resolvedStates.map((state) => stateMatrixStateFromPattern(state)),
  };
}

function uniqueStateId(baseId: string, usedIds: Set<string>): string {
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function stateMatrixStateFromPattern(state: UXPatternPackState): StateMatrix["states"][number] {
  const affectedRegion = state.affectedRegion ?? "primary content";
  return {
    id: `${slug(affectedRegion)}-${state.kind}`,
    label: labelForState(state),
    kind: state.kind,
    scope: state.scope,
    affectedRegion: state.affectedRegion,
    persistentRegions: state.persistentRegions ?? [],
    replacementBehavior: state.replacementBehavior,
    requiredComponents: state.requiredComponents,
    copy: state.copy,
    primaryAction: state.primaryAction,
    secondaryAction: state.secondaryAction,
    sourceRefs: state.sourceRefs,
  };
}

function genericState(kind: UXPatternPackState["kind"], envelope: UXEnvelope): UXPatternPackState {
  const scope = envelope.traits?.stateScopes?.[0]?.kind ?? "page";
  const affectedRegion = envelope.traits?.regions?.[0]?.name ?? "primary content";
  return {
    kind,
    scope,
    affectedRegion,
    persistentRegions: [],
    replacementBehavior: scope === "page" ? "replace-whole-page" : "replace-region-content",
    requiredComponents: [],
    copy: { title: labelForKind(kind) },
    sourceRefs: [FALLBACK_SOURCE_REF],
  };
}

function labelForState(state: UXPatternPackState): string {
  return state.copy?.title ?? labelForKind(state.kind);
}

function labelForKind(kind: string): string {
  return titleCase(kind.replace(/-/g, " "));
}

function normalizedTraits(
  traits: UXEnvelope["traits"] | undefined
): NonNullable<UXEnvelope["traits"]> {
  return {
    regions: traits?.regions ?? [],
    stateScopes: traits?.stateScopes ?? [],
    repeatedPatterns: traits?.repeatedPatterns ?? [],
    patternPackIds: traits?.patternPackIds ?? [],
  };
}

function hasComposableTraits(traits: UXEnvelope["traits"] | undefined): boolean {
  if (traits === undefined) return false;
  return (
    (traits.regions ?? []).length > 0 ||
    (traits.stateScopes ?? []).length > 0 ||
    (traits.repeatedPatterns ?? []).length > 0 ||
    (traits.patternPackIds ?? []).length > 0
  );
}

function patternPackFromTraits(
  traits: UXEnvelope["traits"] | undefined
): UXPatternPack | undefined {
  const patternPackIds = traits?.patternPackIds ?? [];
  return builtInPatternPacks.find(
    (pack) =>
      patternPackIds.includes(pack.id) || pack.appliesTo.some((id) => patternPackIds.includes(id))
  );
}

function screenArchetypeForPatternPack(pack: UXPatternPack): UXEnvelope["screenArchetype"] {
  return pack.appliesTo.find(isScreenArchetype) ?? "unknown";
}

function isScreenArchetype(value: string): value is UXEnvelope["screenArchetype"] {
  return [
    "admin-data-table",
    "dashboard",
    "settings-form",
    "detail-page",
    "creation-flow",
    "review-workflow",
    "unknown",
  ].includes(value);
}

function createFallbackEnvelopeDefaults(
  input: BuildUxEnvelopeInput
): NonNullable<UXPatternPack["envelopeDefaults"]> {
  return {
    confidence: "low",
    actor: "Designer",
    primaryGoal:
      input.screen?.confidence === "low"
        ? input.userIntent
        : (input.screen?.title ?? "Create a screen"),
    primaryTask: "Draft UI",
    secondaryTasks: [],
    dataModel: {
      primaryEntity: "unknown",
      expectedVolume: "unknown",
      fields: [],
    },
    permissions: [],
    edgeCases: [],
    assumptions: ["Kotikit could not infer a specific UX pattern pack from the request."],
  };
}

function normalizeStateKind(value: string): UXPatternPackState["kind"] {
  const normalized = normalizeWords(value);
  if (normalized === "no results" || normalized === "no-results") return "no-results";
  if (
    normalized === "filled" ||
    normalized === "loading" ||
    normalized === "empty" ||
    normalized === "error" ||
    normalized === "permission" ||
    normalized === "success"
  ) {
    return normalized;
  }
  return "custom";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function slug(value: string): string {
  return normalizeWords(value).replace(/\s+/g, "-") || "state";
}

function tokenSet(value: string): string[] {
  return normalizeWords(value).split(/\s+/).filter(Boolean);
}

function normalizeWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
