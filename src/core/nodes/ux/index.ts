import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildStateMatrix, buildUxEnvelope } from "../../domain/ux-envelope.js";
import { selectPatternPack } from "../../domain/ux-pattern-pack.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import {
  type Artifact,
  ArtifactSchemaVersionByType,
  type DesignApproach,
  type UXEnvelope,
} from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
};

type UxTraits = NonNullable<UXEnvelope["traits"]>;
type RegionTrait = NonNullable<UxTraits["regions"]>[number];
type StateScopeTrait = NonNullable<UxTraits["stateScopes"]>[number];
type RepeatedPatternTrait = NonNullable<UxTraits["repeatedPatterns"]>[number];

const EmptyParamsSchema = z.strictObject({});

export const uxNodeDefinitions: NodeDefinition[] = [
  node({
    key: "ux.brainstormApproach",
    stateReads: ["userIntent", "screen", "designSystem"],
    stateWrites: ["designApproach"],
    requiredCapabilities: ["ux.brainstorm"],
    run: async (input) => {
      const state = graphState(input.state);
      const screen = screenFrom(state.screen);
      const approach = buildDesignApproach({
        userIntent: state.userIntent ?? "Create a product screen.",
        screen,
      });
      return {
        statePatch: { designApproach: approach },
        artifacts: [
          artifactFor({
            state,
            key: "ux.brainstormApproach",
            type: "design-approach",
            payload: approach,
          }),
        ],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ux.buildEnvelope",
    stateReads: ["userIntent", "screen"],
    stateWrites: ["uxEnvelope"],
    requiredCapabilities: ["ux.plan"],
    run: async (input) => {
      const state = graphState(input.state);
      const uxEnvelope = buildUxEnvelope({
        userIntent: state.userIntent ?? "Create a product screen.",
        screen: screenFrom(state.screen),
      });
      return {
        statePatch: { uxEnvelope },
        artifacts: [
          artifactFor({
            state,
            key: "ux.buildEnvelope",
            type: "ux-envelope",
            payload: uxEnvelope,
          }),
        ],
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ux.planStateMatrix",
    stateReads: ["uxEnvelope"],
    stateWrites: ["stateMatrix"],
    requiredCapabilities: ["ux.plan"],
    run: async (input) => {
      const state = graphState(input.state);
      if (state.uxEnvelope === undefined) {
        throw new KotikitError(
          "The UX envelope has not been built yet.",
          "Run ux.buildEnvelope before planning screen states."
        );
      }
      const stateMatrix = buildStateMatrix({
        envelope: state.uxEnvelope,
        patternPack: selectPatternPack(state.uxEnvelope.screenArchetype),
      });
      return {
        statePatch: { stateMatrix },
        artifacts: [
          artifactFor({
            state,
            key: "ux.planStateMatrix",
            type: "state-matrix",
            payload: stateMatrix,
          }),
        ],
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function artifactFor(input: {
  state: KotikitGraphState;
  key: string;
  type: "design-approach" | "ux-envelope" | "state-matrix";
  payload: Artifact["payload"];
}): Artifact {
  const now = nowIso();
  return {
    id: `${input.state.runId}-${input.type}`,
    runId: input.state.runId,
    type: input.type,
    schemaVersion: ArtifactSchemaVersionByType[input.type],
    createdAt: now,
    updatedAt: now,
    sourceNode: { key: input.key, version: "1.0.0" },
    payload: input.payload,
  };
}

function buildDesignApproach(input: {
  userIntent: string;
  screen: ReturnType<typeof screenFrom>;
}): DesignApproach {
  const envelope = buildUxEnvelope(input);
  const title = input.screen.title ?? envelope.primaryGoal;
  const uiParts = input.screen.requiredUiParts ?? [];
  const partsSummary =
    uiParts.length > 0 ? uiParts.join(", ") : "the core product regions needed for the task";
  const requestedStates = uniqueStrings([...(input.screen.states ?? []), ...envelope.edgeCases]);
  const stateSummary =
    requestedStates.length > 0
      ? requestedStates.join(", ")
      : "filled, loading, empty, and error when relevant";
  const confidenceRisk =
    envelope.confidence === "low"
      ? [
          "The request does not match a strong built-in UX pattern, so the first draft should stay easy to revise.",
        ]
      : [];

  return {
    schemaVersion: "DesignApproach/v1",
    goal: title,
    userWorkflow: `${envelope.actor} should complete "${envelope.primaryTask}" in ${title} without extra setup or technical decisions.`,
    recommendedApproach: `Compose the screen first from ${partsSummary}, then let the designer decide whether any missing pieces should be extracted as draft components.`,
    alternativesConsidered: [
      {
        name: "Design-system-first composition",
        tradeoff:
          "Fastest reliable path because existing local components, variables, and icons ground the draft.",
      },
      {
        name: "Wireframe-first exploration",
        tradeoff:
          "Useful for unclear product strategy, but slower and less likely to produce a production-looking first draft.",
      },
      {
        name: "Component-extraction-first",
        tradeoff:
          "Can help library work, but it slows screen creation and risks detached components before the design is validated.",
      },
    ],
    stateStrategy: `Create real screen or region states for ${stateSummary}; do not reduce required states to decorative preview cards.`,
    layoutStrategy:
      "Use auto layout, place sibling screen states with clear canvas gaps, and keep navigation, controls, content, and feedback in context-aware regions.",
    designSystemStrategy:
      "Search the local design system first, reuse matching components and variables, and use screen-draft parts only for genuine gaps.",
    iconStrategy:
      "Use local design-system icons for visible affordances and avoid placeholder glyphs or manually invented icon shapes.",
    assumptions: uniqueStrings([
      ...envelope.assumptions,
      "The designer wants the fastest path to an editable high-fidelity draft.",
      "Draft component extraction should happen only after the visible screen exists.",
    ]).slice(0, 8),
    risks: uniqueStrings([
      ...confidenceRisk,
      "Missing local design-system coverage can tempt the agent to imitate components with primitives.",
      "State variants can become review cards unless the apply step creates each required state in context.",
    ]).slice(0, 8),
    ...(envelope.confidence === "low"
      ? {
          openQuestion:
            "Which user task should this screen optimize for first if the draft needs a stronger product direction?",
        }
      : {}),
    decision: envelope.confidence === "low" ? "ask-designer" : "proceed",
  };
}

function node(
  input: Partial<NodeDefinition> & Pick<NodeDefinition, "key" | "run">
): NodeDefinition {
  return {
    key: input.key,
    version: "1.0.0",
    kind: input.kind ?? "deterministic",
    paramsSchema: input.paramsSchema ?? EmptyParamsSchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: input.stateReads ?? [],
    stateWrites: input.stateWrites ?? [],
    sideEffects: input.sideEffects ?? "none",
    requiredCapabilities: input.requiredCapabilities ?? [],
    run: input.run,
  };
}

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function screenFrom(value: unknown): {
  title?: string;
  requiredUiParts?: string[];
  states?: string[];
  traits?: UXEnvelope["traits"];
} {
  const record = recordFrom(value);
  return {
    title: stringFrom(record.title),
    requiredUiParts: stringArray(record.requiredUiParts),
    states: stringArray(record.states),
    traits: traitsFrom(record.traits),
  };
}

function traitsFrom(value: unknown): UXEnvelope["traits"] | undefined {
  const record = recordFrom(value);
  const regions = regionTraits(record.regions);
  const stateScopes = stateScopeTraits(record.stateScopes);
  const repeatedPatterns = repeatedPatternTraits(record.repeatedPatterns);
  const patternPackIds = stringArray(record.patternPackIds);
  return regions.length > 0 ||
    stateScopes.length > 0 ||
    repeatedPatterns.length > 0 ||
    patternPackIds.length > 0
    ? { regions, stateScopes, repeatedPatterns, patternPackIds }
    : undefined;
}

function regionTraits(value: unknown): RegionTrait[] {
  return recordArray(value).flatMap((item) => {
    const name = stringFrom(item.name);
    const kind = stringFrom(item.kind);
    if (name === undefined || !isRegionKind(kind)) return [];
    return [{ ...optionalId(item.id), name, kind }];
  });
}

function stateScopeTraits(value: unknown): StateScopeTrait[] {
  return recordArray(value).flatMap((item) => {
    const name = stringFrom(item.name);
    const kind = stringFrom(item.kind);
    if (name === undefined || !isStateScopeKind(kind)) return [];
    return [{ ...optionalId(item.id), name, kind }];
  });
}

function repeatedPatternTraits(value: unknown): RepeatedPatternTrait[] {
  return recordArray(value).flatMap((item) => {
    const name = stringFrom(item.name);
    const kind = stringFrom(item.kind);
    if (name === undefined || !isRepeatedPatternKind(kind)) return [];
    return [{ ...optionalId(item.id), name, kind }];
  });
}

function optionalId(value: unknown): { id?: string } {
  const id = stringFrom(value);
  return id === undefined ? {} : { id };
}

function isRegionKind(value: string | undefined): value is RegionTrait["kind"] {
  return (
    value !== undefined &&
    ["table", "list", "timeline", "chart", "form", "detail-panel", "custom"].includes(value)
  );
}

function isStateScopeKind(value: string | undefined): value is StateScopeTrait["kind"] {
  return value !== undefined && ["page", "region", "component", "flow"].includes(value);
}

function isRepeatedPatternKind(value: string | undefined): value is RepeatedPatternTrait["kind"] {
  return value !== undefined && ["rows", "cards", "events", "steps", "custom"].includes(value);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
