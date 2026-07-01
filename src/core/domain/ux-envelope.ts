import type { StateMatrix, UXEnvelope } from "../schemas/artifact.js";
import {
  builtInPatternPacks,
  selectPatternPack,
  type UXPatternPack,
  type UXPatternPackState,
} from "./ux-pattern-pack.js";

type BuildUxEnvelopeInput = {
  userIntent: string;
  screen?: {
    title?: string;
    requiredUiParts?: string[];
    states?: string[];
  };
  patternPack?: UXPatternPack;
};

type BuildStateMatrixInput = {
  envelope: UXEnvelope;
  patternPack?: UXPatternPack;
};

const FALLBACK_SOURCE_REF = "https://www.nngroup.com/articles/task-analysis/";

export function classifyScreenArchetype(userIntent: string): UXEnvelope["screenArchetype"] {
  const normalizedIntent = normalizeWords(userIntent);
  const matchedPack = builtInPatternPacks.find((pack) => {
    const keywords = pack.intentKeywords ?? pack.appliesTo;
    return keywords.some((keyword) => normalizedIntent.includes(normalizeWords(keyword)));
  });

  return (matchedPack?.appliesTo[0] as UXEnvelope["screenArchetype"] | undefined) ?? "unknown";
}

export function buildUxEnvelope(input: BuildUxEnvelopeInput): UXEnvelope {
  const screenArchetype = classifyScreenArchetype(
    [input.userIntent, input.screen?.title, ...(input.screen?.requiredUiParts ?? [])].join(" ")
  );
  const patternPack = input.patternPack ?? selectPatternPack(screenArchetype);
  const defaults = patternPack.envelopeDefaults ?? createFallbackEnvelopeDefaults(input);
  const requestedStates = uniqueStrings([
    ...(input.screen?.states ?? []),
    ...(defaults.edgeCases ?? []),
  ]);

  return {
    schemaVersion: "UXEnvelope/v1",
    screenArchetype,
    confidence: screenArchetype === "unknown" ? "low" : defaults.confidence,
    actor: defaults.actor,
    primaryGoal: defaults.primaryGoal,
    primaryTask: defaults.primaryTask,
    secondaryTasks: defaults.secondaryTasks,
    dataModel: defaults.dataModel,
    permissions: defaults.permissions,
    edgeCases: requestedStates,
    assumptions: defaults.assumptions,
    sourceRefs: uniqueStrings([...patternPack.sourceRefs, FALLBACK_SOURCE_REF]),
  };
}

export function buildStateMatrix(input: BuildStateMatrixInput): StateMatrix {
  const patternPack = input.patternPack ?? selectPatternPack(input.envelope.screenArchetype);
  const requestedKinds = new Set(input.envelope.edgeCases.map(normalizeStateKind));
  const states =
    requestedKinds.size > 0
      ? patternPack.defaultStates.filter((state) => requestedKinds.has(state.kind))
      : patternPack.defaultStates;

  return {
    schemaVersion: "StateMatrix/v1",
    states: states.map((state) => stateMatrixStateFromPattern(state)),
  };
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

function labelForState(state: UXPatternPackState): string {
  return (
    state.copy?.title ??
    state.kind.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function createFallbackEnvelopeDefaults(
  input: BuildUxEnvelopeInput
): NonNullable<UXPatternPack["envelopeDefaults"]> {
  return {
    confidence: "low",
    actor: "Designer",
    primaryGoal: input.screen?.title ?? "Create a screen",
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

function normalizeWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
