import { KotikitError } from "../../util/result.js";
import type { UICompositionContract, UXEnvelope } from "../schemas/artifact.js";

type FitMatch = {
  requestedPart?: string;
  componentKey?: string;
  componentName?: string;
};

type IconMatch = {
  requestedPart?: string;
  semantic?: string;
  iconName?: string;
  iconKey?: string;
};

type FitGap = {
  requestedPart?: string;
};

type FitReportLike = {
  exactMatches?: FitMatch[];
  substitutes?: FitMatch[];
  wrapCandidates?: FitMatch[];
  missingComponents?: FitGap[];
  iconMatches?: IconMatch[];
  repeatedPatterns?: { pattern?: string; status?: string }[];
};

type DraftComponentPlanLike = {
  components?: { id?: string; name?: string }[];
};

type CreatedDraftComponentLike = {
  id?: string;
  name?: string;
  componentKey?: string;
};

type UICompositionPart = UICompositionContract["parts"][number];
type UIPlacement = NonNullable<UICompositionPart["placement"]>;
type UIIconAffordance = NonNullable<UICompositionPart["iconAffordances"]>[number];

export function buildUiCompositionContract(input: {
  requiredUiParts: string[];
  neededStates?: string[];
  screenArchetype?: UXEnvelope["screenArchetype"];
  fitReport?: FitReportLike;
  draftComponentPlan?: DraftComponentPlanLike;
  createdDraftComponents?: CreatedDraftComponentLike[];
  approvedPrimitiveExceptions?: string[];
}): UICompositionContract {
  const parts = input.requiredUiParts.map((part) => {
    const id = idFor(part);
    const role = roleFor(part);
    const iconAffordances = iconAffordancesForPart(part, input.fitReport?.iconMatches);
    const placement = placementFor({
      id,
      name: part,
      role,
      screenArchetype: input.screenArchetype,
    });
    const existing = findFit(part, [
      ...(input.fitReport?.exactMatches ?? []),
      ...(input.fitReport?.substitutes ?? []),
      ...(input.fitReport?.wrapCandidates ?? []),
    ]);
    if (existing?.componentKey !== undefined) {
      return {
        id,
        name: part,
        role,
        ...(placement === undefined ? {} : { placement }),
        source: "existing-component" as const,
        componentKey: existing.componentKey,
        ...(iconAffordances.length === 0 ? {} : { iconAffordances }),
      };
    }

    const draft = input.draftComponentPlan?.components?.find(
      (component) => normalize(component.name) === normalize(part)
    );
    if (draft?.id !== undefined) {
      const created = input.createdDraftComponents?.find((component) => component.id === draft.id);
      if (created?.componentKey === undefined || created.componentKey.length === 0) {
        throw new KotikitError(
          `The UI composition contract is missing a created draft component key for ${part}.`,
          "Create and validate draft components before composing the screen."
        );
      }
      return {
        id,
        name: part,
        role,
        ...(placement === undefined ? {} : { placement }),
        source: "draft-component" as const,
        draftComponentId: draft.id,
        componentKey: created.componentKey,
        ...(iconAffordances.length === 0 ? {} : { iconAffordances }),
      };
    }

    if (input.approvedPrimitiveExceptions?.some((item) => normalize(item) === normalize(part))) {
      return {
        id,
        name: part,
        role,
        ...(placement === undefined ? {} : { placement }),
        source: "approved-primitive" as const,
        primitiveReason: "Approved primitive exception for this draft.",
        ...(iconAffordances.length === 0 ? {} : { iconAffordances }),
      };
    }

    return {
      id,
      name: part,
      role,
      ...(placement === undefined ? {} : { placement }),
      source: "screen-draft" as const,
      extractionCandidate: true,
      ...(iconAffordances.length === 0 ? {} : { iconAffordances }),
    };
  });

  return {
    schemaVersion: "UICompositionContract/v1",
    parts,
  };
}

export function assertNoHardcodedImitation(input: { draftPlan?: unknown }): void {
  const repeatedItems = recordArray(recordFrom(input.draftPlan).repeatedItems);
  const offender = repeatedItems.find((item) => {
    const instances = stringArray(item.instances);
    const looseLayers = stringArray(item.looseLayers);
    return instances.length > 0 && looseLayers.length > 0;
  });

  if (offender !== undefined) {
    throw new KotikitError(
      "This draft contains hardcoded component imitation in a repeated structure.",
      "Build the repeated row/card/cell as a full component instance or create a draft component before composing the screen."
    );
  }
}

function findFit(part: string, matches: FitMatch[] | undefined): FitMatch | undefined {
  return matches?.find((match) => normalize(match.requestedPart) === normalize(part));
}

function iconAffordancesForPart(
  part: string,
  matches: IconMatch[] | undefined
): UIIconAffordance[] {
  return (matches ?? [])
    .filter((match) => normalize(match.requestedPart) === normalize(part))
    .flatMap((match) => {
      if (match.semantic === undefined || match.iconKey === undefined) return [];
      const id = `${idFor(part)}-icon`;
      return [
        {
          id,
          semantic: match.semantic,
          source: "local-design-system" as const,
          iconKey: match.iconKey,
          ...(match.iconName === undefined ? {} : { iconName: match.iconName }),
          required: true,
          reason: "Use the local design-system icon planned for this UI affordance.",
        },
      ];
    });
}

function roleFor(part: string): string {
  if (hasAny(part, ["button", "action", "actions"])) return "primary-action";
  if (hasAny(part, ["table", "tables", "list", "lists"])) return "data-display";
  if (hasAny(part, ["input", "inputs", "field", "fields"])) return "input";
  if (hasAny(part, ["filter", "filters", "toolbar", "toolbars"])) return "toolbar";
  if (hasAny(part, ["row", "rows"])) return "row";
  return "content";
}

function placementFor(input: {
  id: string;
  name: string;
  role: string;
  screenArchetype?: UXEnvelope["screenArchetype"];
}): UIPlacement | undefined {
  if (input.screenArchetype !== "admin-data-table") return undefined;

  const text = normalize(`${input.id} ${input.name} ${input.role}`);
  if (hasAny(text, ["shell", "sidebar", "navigation", "nav"])) return "left-sidebar";
  if (hasAny(text, ["primary action", "primary-action"])) return "top-right-action";
  if (hasAny(text, ["toolbar", "filter"])) return "top-bar";
  if (hasAny(text, ["table", "list", "data display", "data-display"])) return "table-body";
  return "main-content";
}

function hasAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => hasPhrase(value, candidate));
}

function hasPhrase(value: string, required: string): boolean {
  const valueWords = tokensFor(value);
  const requiredWords = tokensFor(required);
  if (requiredWords.length === 0) return false;

  return valueWords.some((_, index) =>
    requiredWords.every((word, offset) => valueWords[index + offset] === word)
  );
}

function tokensFor(value: unknown): string[] {
  const normalized = normalize(value);
  return normalized === "" ? [] : normalized.split(" ");
}

function idFor(value: string): string {
  return normalize(value).replace(/\s+/g, "-") || "part";
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
