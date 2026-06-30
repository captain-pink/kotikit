import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import {
  createNotConfiguredFigmaRemoteSearch,
  type FigmaRemoteDesignSystemSearch,
} from "../../adapters/design-system/figma-remote-search.js";
import {
  getLocalVariables,
  type LocalCacheSetupAction,
  type LocalComponentRef,
  searchLocalComponents,
} from "../../adapters/design-system/local-index.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

export type DesignSystemNodeDependencies = {
  remoteSearch?: FigmaRemoteDesignSystemSearch;
};

type DesignSystemSearchState = {
  source: "local-cache" | "local-cache-with-remote-fallback";
  setupRequired: boolean;
  setupAction?: LocalCacheSetupAction;
  components: LocalComponentRef[];
  remote?: {
    status: "skipped" | "ready" | "not-configured";
    results?: unknown[];
  };
  variables?: unknown[];
};

type LocalVariableRef = {
  name: string;
  kind: string;
  source: string;
  id?: string;
  key?: string;
};

type FitReport = {
  schemaVersion: "DesignSystemFitReport/v1";
  source: "local-cache" | "local-cache-with-remote-fallback";
  summary: string;
  exactMatches: FitMatch[];
  substitutes: FitMatch[];
  missingComponents: FitGap[];
  approvedPrimitiveExceptions?: string[];
  variableGaps: VariableGap[];
  repeatedPatterns: PatternFit[];
};

type FitMatch = {
  requestedPart: string;
  componentName: string;
  componentKey: string;
  path?: string;
  reason: string;
};

type FitGap = {
  requestedPart: string;
  reason: string;
};

type VariableGap = {
  kind: "color" | "text" | "effect" | "number" | "spacing";
  reason: string;
};

type PatternFit = {
  pattern: string;
  status: "covered" | "gap";
  componentKey?: string;
  reason: string;
};

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
  interrupt?: ReturnType<typeof createUserInterrupt>;
};

const EmptyParamsSchema = z.strictObject({});
const SearchLocalParamsSchema = z
  .strictObject({
    limitPerQuery: z.number().int().positive().max(25).optional(),
  })
  .passthrough();
const SearchRemoteParamsSchema = z
  .strictObject({
    minimumLocalMatches: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(25).optional(),
  })
  .passthrough();
const BuildFitReportParamsSchema = z
  .strictObject({
    reportCacheHealth: z.boolean().optional(),
    classifyGaps: z.boolean().optional(),
  })
  .passthrough();

export const designSystemNodeDefinitions = createDesignSystemNodeDefinitions();

export function createDesignSystemNodeDefinitions(
  deps: DesignSystemNodeDependencies = {}
): NodeDefinition[] {
  const remoteSearch = deps.remoteSearch ?? createNotConfiguredFigmaRemoteSearch();

  return [
    node({
      key: "designSystem.searchLocal",
      paramsSchema: SearchLocalParamsSchema,
      stateReads: ["screen", "flowModel", "userIntent", "project", "designSystem"],
      stateWrites: ["designSystem"],
      sideEffects: "sqlite",
      requiredCapabilities: ["designSystem.search.local"],
      run: async (input) => {
        const state = graphState(input.state);
        const params = SearchLocalParamsSchema.parse(input.params);
        const root = state.project.root;
        const queries = designSystemQueries(state);
        const first = searchLocalComponents(root, queries[0] ?? state.userIntent ?? "button", {
          limit: params.limitPerQuery ?? 8,
        });

        if (first.status === "needs-sync") {
          return {
            statePatch: {
              designSystem: {
                source: "local-cache",
                setupRequired: true,
                setupAction: first.setupAction,
                components: [],
              },
            },
          } satisfies RuntimeNodeOutput;
        }

        const components = uniqueComponents([
          ...first.results,
          ...queries
            .slice(1)
            .flatMap(
              (query) =>
                searchLocalComponents(root, query, { limit: params.limitPerQuery ?? 8 }).results
            ),
        ]);
        const variables = localVariableRefs(root);

        return {
          statePatch: {
            designSystem: {
              source: "local-cache",
              setupRequired: false,
              components,
              ...(variables.length > 0 ? { variables } : {}),
            } satisfies DesignSystemSearchState,
          },
        } satisfies RuntimeNodeOutput;
      },
    }),
    node({
      key: "designSystem.searchRemoteOptional",
      paramsSchema: SearchRemoteParamsSchema,
      stateReads: ["designSystem", "screen", "flowModel", "userIntent"],
      stateWrites: ["designSystem"],
      sideEffects: "figma-read",
      requiredCapabilities: ["figma.read.remote"],
      run: async (input) => {
        const state = graphState(input.state);
        const params = SearchRemoteParamsSchema.parse(input.params);
        const current = designSystemFrom(state.designSystem);
        const minimumLocalMatches =
          params.minimumLocalMatches ?? Math.min(designSystemQueries(state).length, 3);
        if ((current.components?.length ?? 0) >= minimumLocalMatches) {
          return {
            statePatch: {
              designSystem: {
                ...current,
                setupRequired: current.setupRequired ?? false,
                components: current.components ?? [],
                remote: { status: "skipped" },
              },
            },
          } satisfies RuntimeNodeOutput;
        }

        const result = await remoteSearch.searchComponents(designSystemQueries(state).join(" "), {
          limit: params.limit ?? 10,
        });
        return {
          statePatch: {
            designSystem: {
              ...current,
              setupRequired: current.setupRequired ?? false,
              components: current.components ?? [],
              source: "local-cache-with-remote-fallback",
              remote: {
                status: result.status,
                ...(result.status === "ready" ? { results: result.results } : {}),
              },
            } satisfies DesignSystemSearchState,
          },
        } satisfies RuntimeNodeOutput;
      },
    }),
    node({
      key: "designSystem.buildFitReport",
      paramsSchema: BuildFitReportParamsSchema,
      stateReads: ["designSystem", "screen", "flowModel"],
      stateWrites: ["fitReport"],
      run: async (input) => {
        const state = graphState(input.state);
        const fitReport = buildFitReport(state);
        return { statePatch: { fitReport } } satisfies RuntimeNodeOutput;
      },
    }),
    node({
      key: "designSystem.askMissingComponentDecision",
      kind: "interrupt",
      paramsSchema: EmptyParamsSchema,
      stateReads: ["fitReport"],
      stateWrites: ["fitReport", "pendingQuestion"],
      run: async (input) => {
        const state = graphState(input.state);
        const fitReport = fitReportFrom(state.fitReport);
        if (fitReport.missingComponents.length === 0) {
          return { statePatch: { fitReport } } satisfies RuntimeNodeOutput;
        }
        if (state.answers?.["missing-components"] === "approve-primitive-exceptions") {
          return {
            statePatch: {
              fitReport: approvePrimitiveExceptions(fitReport),
            },
          } satisfies RuntimeNodeOutput;
        }
        if (state.answers?.["missing-components"] !== undefined) {
          return { statePatch: { fitReport } } satisfies RuntimeNodeOutput;
        }
        return {
          statePatch: { fitReport },
          interrupt: createUserInterrupt({
            id: "missing-components",
            prompt:
              "Some requested UI parts do not have matching design-system components. Should kotikit create draft components first or treat them as approved primitive exceptions?",
            choices: ["create-draft-components", "approve-primitive-exceptions"],
          }),
        } satisfies RuntimeNodeOutput;
      },
    }),
    node({
      key: "designSystem.saveFitReport",
      paramsSchema: EmptyParamsSchema,
      stateReads: ["fitReport"],
      stateWrites: ["artifacts"],
      sideEffects: "filesystem",
      requiredCapabilities: ["designSystem.fit"],
      run: async (input) => {
        const state = graphState(input.state);
        const report = fitReportFrom(state.fitReport);
        const now = nowIso();
        const artifact: Artifact = {
          id: `${state.runId}-design-system-fit-report`,
          runId: state.runId,
          type: "design-system-fit-report",
          schemaVersion: ArtifactSchemaVersionByType["design-system-fit-report"],
          createdAt: now,
          updatedAt: now,
          sourceNode: { key: "designSystem.saveFitReport", version: "1.0.0" },
          payload: {
            schemaVersion: ArtifactSchemaVersionByType["design-system-fit-report"],
            summary: report.summary,
            refs: fitReportRefs(report),
            data: {
              exactMatches: report.exactMatches.length,
              substitutes: report.substitutes.length,
              missingComponents: report.missingComponents.length,
            },
          },
        };
        return { artifacts: [artifact] } satisfies RuntimeNodeOutput;
      },
    }),
  ];
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

function buildFitReport(state: KotikitGraphState): FitReport {
  const designSystem = designSystemFrom(state.designSystem);
  const components = designSystem.components ?? [];
  const parts = meaningfulParts(state);
  const fit = parts.reduce(
    (acc, part) => {
      const candidate = bestComponentForPart(part, components);
      if (candidate === undefined) {
        acc.missingComponents.push({
          requestedPart: part,
          reason: "No local component or approved substitute matched this meaningful UI part.",
        });
        return acc;
      }
      if (candidate.kind === "substitute") acc.substitutes.push(candidate.match);
      else acc.exactMatches.push(candidate.match);
      return acc;
    },
    {
      exactMatches: [] as FitMatch[],
      substitutes: [] as FitMatch[],
      missingComponents: [] as FitGap[],
    }
  );
  const repeatedPatterns = repeatedPatternsFrom(state).map((pattern) =>
    patternFit(pattern, components)
  );
  const variableGaps = variableGapsFrom(designSystem.variables);
  const summary = `${fit.exactMatches.length} exact match(es), ${fit.substitutes.length} substitute(s), ${fit.missingComponents.length} missing component(s).`;

  return {
    schemaVersion: "DesignSystemFitReport/v1",
    source: designSystem.source ?? "local-cache",
    summary,
    exactMatches: fit.exactMatches,
    substitutes: fit.substitutes,
    missingComponents: fit.missingComponents,
    variableGaps,
    repeatedPatterns,
  };
}

function localVariableRefs(root: string): LocalVariableRef[] {
  const result = getLocalVariables(root);
  if (result.status === "needs-sync") return [];
  return result.entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    source: entry.source,
    ...(entry.id !== undefined ? { id: entry.id } : {}),
    ...(entry.key !== undefined ? { key: entry.key } : {}),
  }));
}

function bestComponentForPart(
  part: string,
  components: LocalComponentRef[]
): { kind: "exact" | "substitute"; match: FitMatch } | undefined {
  const scored = components
    .map((component) => ({
      component,
      score: componentFitScore(part, component.name),
      kind: substituteKind(part, component.name),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name));
  const winner = scored[0];
  if (winner === undefined) return undefined;
  return {
    kind: winner.kind,
    match: {
      requestedPart: part,
      componentName: winner.component.name,
      componentKey: winner.component.key,
      path: winner.component.path,
      reason:
        winner.kind === "exact"
          ? "Component covers the requested UI role."
          : "Component is a plausible substitute but still needs explicit draft validation.",
    },
  };
}

function componentFitScore(part: string, componentName: string): number {
  const partTokens = tokenSet(part);
  const componentTokens = tokenSet(componentName);
  if (componentTokens.some((token) => partTokens.includes(token))) return 100;
  if (partTokens.includes("table") && componentTokens.includes("data")) return 90;
  if (partTokens.includes("filter") && componentTokens.includes("toolbar")) return 80;
  return 0;
}

function substituteKind(part: string, componentName: string): "exact" | "substitute" {
  const partTokens = tokenSet(part);
  const componentTokens = tokenSet(componentName);
  if (partTokens.includes("status") && componentTokens.includes("badge")) return "substitute";
  return "exact";
}

function patternFit(pattern: string, components: LocalComponentRef[]): PatternFit {
  const component = components.find((candidate) => componentFitScore(pattern, candidate.name) > 0);
  if (component === undefined) {
    return {
      pattern,
      status: "gap",
      reason: "No design-system component family covers this repeated pattern.",
    };
  }
  return {
    pattern,
    status: "covered",
    componentKey: component.key,
    reason: `${component.name} covers this repeated pattern.`,
  };
}

function variableGapsFrom(variables: unknown): VariableGap[] {
  const entries = Array.isArray(variables) ? variables : [];
  const kinds = new Set(
    entries
      .map((entry) => (isRecord(entry) && typeof entry.kind === "string" ? entry.kind : undefined))
      .filter((kind): kind is string => kind !== undefined)
  );
  return (["color", "spacing", "text"] as const)
    .filter((kind) => !kinds.has(kind))
    .map((kind) => ({
      kind,
      reason: `No local ${kind} variable or style was available in the design-system cache.`,
    }));
}

function designSystemQueries(state: KotikitGraphState): string[] {
  const parts = [...meaningfulParts(state), ...repeatedPatternsFrom(state)];
  const tokens = parts.flatMap((part) => [part, ...knownRoleTokens(part)]).filter(Boolean);
  const fallback = state.userIntent === undefined ? [] : knownRoleTokens(state.userIntent);
  return uniqueStrings([...tokens, ...fallback]);
}

function meaningfulParts(state: KotikitGraphState): string[] {
  const screen = recordFrom(state.screen);
  const flowModel = recordFrom(state.flowModel);
  const screenParts = stringArray(screen.requiredUiParts);
  const flowParts = stringArray(flowModel.screens).flatMap((item) =>
    stringArray(recordFrom(item).requiredUiParts)
  );
  return uniqueStrings([...screenParts, ...flowParts]);
}

function screenRegions(screen: Record<string, unknown>): string[] {
  const regions = recordFrom(screen.regions);
  return [
    ...stringArray(regions.tables),
    ...stringArray(regions.lists),
    ...stringArray(regions.forms),
  ];
}

function repeatedPatternsFrom(state: KotikitGraphState): string[] {
  const screen = recordFrom(state.screen);
  const flowModel = recordFrom(state.flowModel);
  const screenPatterns = stringArray(screen.repeatedPatterns);
  const flowPatterns = stringArray(flowModel.screens).flatMap((item) =>
    stringArray(recordFrom(item).repeatedPatterns)
  );
  const regionPatterns = screenRegions(screen).flatMap(knownRoleTokens);
  return uniqueStrings([...screenPatterns, ...flowPatterns, ...regionPatterns]);
}

function knownRoleTokens(value: string): string[] {
  const tokens = tokenSet(value);
  return [
    tokens.includes("button") || tokens.includes("action") ? "button" : undefined,
    tokens.includes("table") ? "table" : undefined,
    tokens.includes("list") || tokens.includes("row") ? "list" : undefined,
    tokens.includes("form") ? "form" : undefined,
    tokens.includes("field") || tokens.includes("input") || tokens.includes("email")
      ? "input"
      : undefined,
    tokens.includes("filter") || tokens.includes("toolbar") ? "toolbar" : undefined,
    tokens.includes("tab") ? "tabs" : undefined,
    tokens.includes("badge") || tokens.includes("status") ? "badge" : undefined,
  ].filter((token): token is string => token !== undefined);
}

function fitReportRefs(report: FitReport): string[] {
  return [
    ...report.exactMatches.map((match) => `exact: ${match.requestedPart} -> ${match.componentKey}`),
    ...report.substitutes.map(
      (match) => `substitute: ${match.requestedPart} -> ${match.componentKey}`
    ),
    ...report.missingComponents.map((gap) => `missing: ${gap.requestedPart}`),
  ];
}

function approvePrimitiveExceptions(report: FitReport): FitReport {
  const approved = uniqueStrings([
    ...(report.approvedPrimitiveExceptions ?? []),
    ...report.missingComponents.map((gap) => gap.requestedPart),
  ]);
  return {
    ...report,
    approvedPrimitiveExceptions: approved,
  };
}

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function designSystemFrom(value: unknown): Partial<DesignSystemSearchState> {
  return isRecord(value) ? (value as Partial<DesignSystemSearchState>) : {};
}

function fitReportFrom(value: unknown): FitReport {
  if (!isRecord(value)) {
    return {
      schemaVersion: "DesignSystemFitReport/v1",
      source: "local-cache",
      summary: "No design-system fit report has been built yet.",
      exactMatches: [],
      substitutes: [],
      missingComponents: [],
      variableGaps: [],
      repeatedPatterns: [],
    };
  }
  return {
    schemaVersion: "DesignSystemFitReport/v1",
    source: value.source === "local-cache-with-remote-fallback" ? value.source : "local-cache",
    summary: typeof value.summary === "string" ? value.summary : "Design-system fit report.",
    exactMatches: arrayFrom<FitMatch>(value.exactMatches),
    substitutes: arrayFrom<FitMatch>(value.substitutes),
    missingComponents: arrayFrom<FitGap>(value.missingComponents),
    approvedPrimitiveExceptions: stringArray(value.approvedPrimitiveExceptions),
    variableGaps: arrayFrom<VariableGap>(value.variableGaps),
    repeatedPatterns: arrayFrom<PatternFit>(value.repeatedPatterns),
  };
}

function uniqueComponents(components: LocalComponentRef[]): LocalComponentRef[] {
  const byKey = new Map<string, LocalComponentRef>();
  components.forEach((component) => {
    if (!byKey.has(component.key)) byKey.set(component.key, component);
  });
  return Array.from(byKey.values());
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function tokenSet(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordFrom(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayFrom<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
