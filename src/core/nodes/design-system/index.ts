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
  type LocalIconRef,
  searchLocalComponents,
  searchLocalIcons,
} from "../../adapters/design-system/local-index.js";
import { selectPatternPack } from "../../domain/ux-pattern-pack.js";
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
  icons?: LocalIconRef[];
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
  sourcePolicy: {
    componentDiscovery: "local-cache-only";
    variableDiscovery: "local-cache-only";
    iconDiscovery: "local-cache-only";
    figmaDiscoveryAllowed: false;
  };
  summary: string;
  exactMatches: FitMatch[];
  substitutes: FitMatch[];
  wrapCandidates: WrapCandidate[];
  missingComponents: FitGap[];
  approvedPrimitiveExceptions?: string[];
  iconMatches: IconMatch[];
  variableGaps: VariableGap[];
  variableRefs: LocalVariableRef[];
  repeatedPatterns: PatternFit[];
};

type FitMatch = {
  requestedPart: string;
  componentName: string;
  componentKey: string;
  source?: string;
  path?: string;
  reason: string;
};

type WrapCandidate = FitMatch & {
  candidateKind: "wrap-needed" | "partial";
};

type FitGap = {
  requestedPart: string;
  reason: string;
};

type VariableGap = {
  kind: "color" | "text" | "effect" | "number" | "spacing";
  reason: string;
};

type IconMatch = {
  requestedPart: string;
  semantic: string;
  iconName: string;
  iconKey: string;
  reason: string;
};

type PatternFit = {
  pattern: string;
  status: "covered" | "partial" | "gap";
  componentKey?: string;
  reason: string;
};

type ComponentFitCandidate =
  | { kind: "exact" | "substitute"; match: FitMatch }
  | { kind: "wrap-needed"; match: WrapCandidate };

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

const LOCAL_SOURCE_POLICY: FitReport["sourcePolicy"] = {
  componentDiscovery: "local-cache-only",
  variableDiscovery: "local-cache-only",
  iconDiscovery: "local-cache-only",
  figmaDiscoveryAllowed: false,
};

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
        const current = designSystemFrom(state.designSystem);
        const seededComponents = arrayFrom<LocalComponentRef>(current.components);
        const seededIcons = arrayFrom<LocalIconRef>(current.icons);
        const seededVariables = arrayFrom<LocalVariableRef>(current.variables);
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
                setupRequired: seededComponents.length === 0,
                ...(seededComponents.length === 0 ? { setupAction: first.setupAction } : {}),
                components: seededComponents,
                ...(seededIcons.length > 0 ? { icons: seededIcons } : {}),
                ...(seededVariables.length > 0 ? { variables: seededVariables } : {}),
              } satisfies DesignSystemSearchState,
            },
          } satisfies RuntimeNodeOutput;
        }

        const localComponents = uniqueComponents([
          ...first.results,
          ...queries
            .slice(1)
            .flatMap(
              (query) =>
                searchLocalComponents(root, query, { limit: params.limitPerQuery ?? 8 }).results
            ),
        ]);
        const localIcons = uniqueIcons([
          ...localIconsForQueries(root, iconQueries(state), params.limitPerQuery ?? 8),
          ...seededIcons,
        ]);
        const components = uniqueComponents([...localComponents, ...seededComponents]);
        const localVariables = localVariableRefs(root);
        const variables = uniqueVariables([...localVariables, ...seededVariables]);

        return {
          statePatch: {
            designSystem: {
              source: "local-cache",
              setupRequired: false,
              components,
              ...(localIcons.length > 0 ? { icons: localIcons } : {}),
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
    node({
      key: "designSystem.saveReusePlan",
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
          id: `${state.runId}-design-system-reuse-plan`,
          runId: state.runId,
          type: "design-system-reuse-plan",
          schemaVersion: ArtifactSchemaVersionByType["design-system-reuse-plan"],
          createdAt: now,
          updatedAt: now,
          sourceNode: { key: "designSystem.saveReusePlan", version: "1.0.0" },
          payload: reusePlanPayload(report),
        };
        return { artifacts: [artifact] } satisfies RuntimeNodeOutput;
      },
    }),
    node({
      key: "designSystem.saveUsageReport",
      paramsSchema: EmptyParamsSchema,
      stateReads: ["uiComposition", "draftComponentLifecycle", "applyReport"],
      stateWrites: ["artifacts"],
      sideEffects: "filesystem",
      requiredCapabilities: ["designSystem.fit"],
      run: async (input) => {
        const state = graphState(input.state);
        const now = nowIso();
        const artifact: Artifact = {
          id: `${state.runId}-design-system-usage-report`,
          runId: state.runId,
          type: "design-system-usage-report",
          schemaVersion: ArtifactSchemaVersionByType["design-system-usage-report"],
          createdAt: now,
          updatedAt: now,
          sourceNode: { key: "designSystem.saveUsageReport", version: "1.0.0" },
          payload: usageReportPayload(state),
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
  const icons = designSystem.icons ?? [];
  const parts = meaningfulParts(state);
  const repeatedPatterns = repeatedPatternsFrom(state);
  const fit = parts.reduce(
    (acc, part) => {
      const candidate = bestComponentForPart(part, components, repeatedPatterns);
      if (candidate === undefined) {
        acc.missingComponents.push({
          requestedPart: part,
          reason: "No local component or approved substitute matched this meaningful UI part.",
        });
        return acc;
      }
      if (candidate.kind === "substitute") acc.substitutes.push(candidate.match);
      else if (candidate.kind === "wrap-needed") acc.wrapCandidates.push(candidate.match);
      else acc.exactMatches.push(candidate.match);
      return acc;
    },
    {
      exactMatches: [] as FitMatch[],
      substitutes: [] as FitMatch[],
      wrapCandidates: [] as WrapCandidate[],
      missingComponents: [] as FitGap[],
    }
  );
  const patternFits = repeatedPatterns.map((pattern) => patternFit(pattern, components));
  const iconMatches = iconMatchesForParts(parts, icons);
  const variableGaps = variableGapsFrom(designSystem.variables);
  const summary = `${fit.exactMatches.length} exact match(es), ${fit.substitutes.length} substitute(s), ${fit.wrapCandidates.length} wrap candidate(s), ${fit.missingComponents.length} missing component(s).`;

  return {
    schemaVersion: "DesignSystemFitReport/v1",
    source: designSystem.source ?? "local-cache",
    sourcePolicy: LOCAL_SOURCE_POLICY,
    summary,
    exactMatches: fit.exactMatches,
    substitutes: fit.substitutes,
    wrapCandidates: fit.wrapCandidates,
    missingComponents: fit.missingComponents,
    variableGaps,
    variableRefs: variableRefsFrom(designSystem.variables),
    iconMatches,
    repeatedPatterns: patternFits,
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

function variableRefsFrom(variables: unknown): LocalVariableRef[] {
  return arrayFrom<LocalVariableRef>(variables).map((variable) => ({
    name: variable.name,
    kind: variable.kind,
    source: variable.source ?? "local-variables-cache",
    ...(variable.id === undefined ? {} : { id: variable.id }),
    ...(variable.key === undefined ? {} : { key: variable.key }),
  }));
}

function componentSource(component: LocalComponentRef): string {
  const source = recordFrom(component).source;
  return typeof source === "string" && source.length > 0 ? source : "local-component-db";
}

function localIconsForQueries(
  root: string,
  queries: string[],
  limitPerQuery: number
): LocalIconRef[] {
  return uniqueIcons(
    queries.flatMap((query) => {
      const result = searchLocalIcons(root, query, { limit: Math.min(limitPerQuery, 5) });
      return result.status === "ready" ? result.results : [];
    })
  );
}

function bestComponentForPart(
  part: string,
  components: LocalComponentRef[],
  repeatedPatterns: string[]
): ComponentFitCandidate | undefined {
  const scored = components
    .map((component) => ({
      component,
      score: componentFitScore(part, component.name),
      kind: componentCandidateKind(part, component.name, repeatedPatterns),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name));
  const winner = scored[0];
  if (winner === undefined) return undefined;
  const match: FitMatch = {
    requestedPart: part,
    componentName: winner.component.name,
    componentKey: winner.component.key,
    source: componentSource(winner.component),
    path: winner.component.path,
    reason:
      winner.kind === "exact"
        ? "Component covers the requested UI role."
        : winner.kind === "substitute"
          ? "Component is a plausible substitute but still needs explicit draft validation."
          : "Component is a close design-system candidate that should be wrapped or composed with draft coverage for missing parts.",
  };

  if (winner.kind === "wrap-needed") {
    return {
      kind: "wrap-needed",
      match: { ...match, candidateKind: "wrap-needed" },
    };
  }

  return {
    kind: winner.kind,
    match,
  };
}

function componentFitScore(part: string, componentName: string): number {
  const partTokens = tokenSet(part);
  const componentTokens = tokenSet(componentName);
  if (componentTokens.some((token) => partTokens.includes(token))) return 100;
  if (semanticAliasesForPart(part).some((token) => componentTokens.includes(token))) return 95;
  if (partTokens.includes("table") && componentTokens.includes("data")) return 90;
  if (partTokens.includes("filter") && componentTokens.includes("toolbar")) return 80;
  return 0;
}

function componentCandidateKind(
  part: string,
  componentName: string,
  repeatedPatterns: string[]
): "exact" | "substitute" | "wrap-needed" {
  const partTokens = tokenSet(part);
  const componentTokens = tokenSet(componentName);
  if (partTokens.includes("status") && componentTokens.includes("badge")) return "substitute";
  if (isCloseRepeatedPatternCandidate(part, componentName, repeatedPatterns)) {
    return "wrap-needed";
  }
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
  if (isPartialComponentName(component.name)) {
    return {
      pattern,
      status: "partial",
      componentKey: component.key,
      reason: `${component.name} is a close reusable base, but missing coverage still needs a wrapper, draft components, or explicit validation.`,
    };
  }
  return {
    pattern,
    status: "covered",
    componentKey: component.key,
    reason: `${component.name} covers this repeated pattern.`,
  };
}

function isCloseRepeatedPatternCandidate(
  part: string,
  componentName: string,
  repeatedPatterns: string[]
): boolean {
  const partTokens = tokenSet(part);
  const componentTokens = tokenSet(componentName);
  if (!isPartialComponentName(componentName)) return false;
  return repeatedPatterns.some((pattern) =>
    tokenSet(pattern).some((token) => partTokens.includes(token) && componentTokens.includes(token))
  );
}

function isPartialComponentName(componentName: string): boolean {
  const tokens = tokenSet(componentName);
  return ["preview", "sample", "example", "placeholder"].some((token) => tokens.includes(token));
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
  return uniqueStrings([...tokens, ...fallback, ...semanticCompanionParts(state)]);
}

function meaningfulParts(state: KotikitGraphState): string[] {
  const screen = recordFrom(state.screen);
  const flowModel = recordFrom(state.flowModel);
  const screenParts = stringArray(screen.requiredUiParts);
  const flowParts = recordArray(flowModel.screens).flatMap((item) =>
    stringArray(recordFrom(item).requiredUiParts)
  );
  return uniqueStrings([
    ...screenParts,
    ...flowParts,
    ...patternPackParts(state),
    ...stateParts(state),
  ]);
}

function patternPackParts(state: KotikitGraphState): string[] {
  const archetype = recordFrom(state.uxEnvelope).screenArchetype;
  if (typeof archetype !== "string") return [];
  return selectPatternPack(archetype).componentRoles;
}

function stateParts(state: KotikitGraphState): string[] {
  return recordArray(recordFrom(state.stateMatrix).states).flatMap((item) => [
    ...stringArray(item.requiredComponents),
    ...optionalString(item.primaryAction),
    ...optionalString(item.secondaryAction),
    ...optionalString(item.affectedRegion),
  ]);
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
  const flowPatterns = recordArray(flowModel.screens).flatMap((item) =>
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
    tokens.includes("avatar") || tokens.includes("member") || tokens.includes("user")
      ? "avatar"
      : undefined,
    tokens.includes("nav") || tokens.includes("navigation") || tokens.includes("sidebar")
      ? "nav item"
      : undefined,
    tokens.includes("select") || tokens.includes("dropdown") ? "select" : undefined,
    tokens.includes("empty") ? "empty state" : undefined,
    tokens.includes("error") || tokens.includes("alert") || tokens.includes("permission")
      ? "alert"
      : undefined,
  ].filter((token): token is string => token !== undefined);
}

function semanticCompanionParts(state: KotikitGraphState): string[] {
  const parts = meaningfulParts(state);
  const dataModel = recordFrom(recordFrom(state.uxEnvelope).dataModel);
  const fields = stringArray(dataModel.fields);
  const primaryEntity = typeof dataModel.primaryEntity === "string" ? dataModel.primaryEntity : "";
  const roleParts = parts.flatMap((part) => {
    const tokens = tokenSet(part);
    return [
      tokens.includes("action") ? "button" : undefined,
      tokens.includes("toolbar") || tokens.includes("filter") ? "select" : undefined,
      tokens.includes("toolbar") || tokens.includes("filter") ? "combobox" : undefined,
      tokens.includes("navigation") || tokens.includes("sidebar") ? "nav item" : undefined,
      tokens.includes("table") ? "checkbox" : undefined,
      tokens.includes("table") ? "menu" : undefined,
      tokens.includes("empty") ? "empty state" : undefined,
      tokens.includes("error") || tokens.includes("permission") ? "alert" : undefined,
    ].filter((item): item is string => item !== undefined);
  });
  const entityParts = [
    hasAny(`${primaryEntity} ${fields.join(" ")}`, ["member", "user", "person", "contact"])
      ? "avatar"
      : undefined,
    fields.some((field) => hasAny(field, ["status", "role", "state"])) ? "badge" : undefined,
  ].filter((item): item is string => item !== undefined);
  return uniqueStrings([...roleParts, ...entityParts]);
}

function iconQueries(state: KotikitGraphState): string[] {
  return uniqueStrings(
    [...meaningfulParts(state), ...semanticCompanionParts(state)]
      .flatMap(iconSemanticsForPart)
      .flatMap(iconSearchTokens)
  );
}

function iconMatchesForParts(parts: string[], icons: LocalIconRef[]): IconMatch[] {
  return parts.flatMap((part) => {
    const semantic = iconSemanticsForPart(part)[0];
    if (semantic === undefined) return [];
    const icon = bestIconForSemantic(semantic, icons);
    if (icon === undefined) return [];
    return [
      {
        requestedPart: part,
        semantic,
        iconName: icon.name,
        iconKey: icon.key,
        reason: "Local design-system icon matches the planned UI affordance.",
      },
    ];
  });
}

function bestIconForSemantic(semantic: string, icons: LocalIconRef[]): LocalIconRef | undefined {
  const queries = iconSearchTokens(semantic);
  return icons
    .map((icon) => ({
      icon,
      score: tokenSet(icon.name).some((token) => queries.includes(token)) ? 1 : 0,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => a.icon.name.localeCompare(b.icon.name))[0]?.icon;
}

function iconSemanticsForPart(part: string): string[] {
  const tokens = tokenSet(part);
  return [
    tokens.includes("search") ? "search" : undefined,
    tokens.includes("filter") || tokens.includes("select") || tokens.includes("toolbar")
      ? "filter"
      : undefined,
    tokens.includes("primary") || tokens.includes("action") ? "primary-action" : undefined,
    tokens.includes("error") || tokens.includes("alert") ? "error" : undefined,
    tokens.includes("permission") || tokens.includes("access") ? "lock" : undefined,
    tokens.includes("menu") || tokens.includes("overflow") || tokens.includes("more")
      ? "more"
      : undefined,
  ].filter((item): item is string => item !== undefined);
}

function iconSearchTokens(semantic: string): string[] {
  if (semantic === "primary-action") return ["plus", "add", "create", "new"];
  if (semantic === "error") return ["alert", "error", "warning"];
  if (semantic === "lock") return ["lock", "permission", "access"];
  if (semantic === "more") return ["more", "menu", "overflow"];
  return [semantic];
}

function semanticAliasesForPart(part: string): string[] {
  const tokens = tokenSet(part);
  return [
    tokens.includes("action") ? "button" : undefined,
    tokens.includes("error") ? "alert" : undefined,
    tokens.includes("permission") || tokens.includes("access") ? "alert" : undefined,
    tokens.includes("navigation") ? "nav" : undefined,
    tokens.includes("row") && tokens.includes("action") ? "menu" : undefined,
  ].filter((item): item is string => item !== undefined);
}

function fitReportRefs(report: FitReport): string[] {
  return [
    ...report.exactMatches.map((match) => `exact: ${match.requestedPart} -> ${match.componentKey}`),
    ...report.substitutes.map(
      (match) => `substitute: ${match.requestedPart} -> ${match.componentKey}`
    ),
    ...report.wrapCandidates.map(
      (match) => `wrap: ${match.requestedPart} -> ${match.componentKey}`
    ),
    ...report.missingComponents.map((gap) => `missing: ${gap.requestedPart}`),
    ...report.iconMatches.map((match) => `icon: ${match.requestedPart} -> ${match.iconKey}`),
  ];
}

function reusePlanPayload(report: FitReport): Artifact["payload"] {
  return {
    schemaVersion: ArtifactSchemaVersionByType["design-system-reuse-plan"],
    summary: `Reuse ${counted(report.exactMatches.length, "exact component")}, validate ${counted(report.substitutes.length, "substitute")}, wrap ${counted(report.wrapCandidates.length, "close candidate")}, draft ${counted(report.missingComponents.length, "gap")}.`,
    refs: [
      ...report.exactMatches.map(
        (match) => `reuse: ${match.requestedPart} -> ${match.componentKey}`
      ),
      ...report.substitutes.map(
        (match) => `substitute: ${match.requestedPart} -> ${match.componentKey}`
      ),
      ...report.wrapCandidates.map(
        (match) => `wrap: ${match.requestedPart} -> ${match.componentKey}`
      ),
      ...report.missingComponents.map((gap) => `draft: ${gap.requestedPart}`),
      ...report.iconMatches.map((match) => `icon: ${match.requestedPart} -> ${match.iconKey}`),
    ],
    data: {
      exactMatches: report.exactMatches.length,
      substitutes: report.substitutes.length,
      wrapCandidates: report.wrapCandidates.length,
      missingComponents: report.missingComponents.length,
      iconMatches: report.iconMatches.length,
    },
  };
}

function usageReportPayload(state: KotikitGraphState): Artifact["payload"] {
  const parts = recordArray(recordFrom(state.uiComposition).parts);
  const reused = parts.filter((part) => part.source === "existing-component");
  const screenDrafts = parts.filter((part) => part.source === "screen-draft");
  const drafted = parts.filter((part) => part.source === "draft-component");
  const primitives = parts.filter((part) => part.source === "approved-primitive");
  const applyReport = recordFrom(state.applyReport);
  const nodes = recordArray(applyReport.nodes);
  const iconRefs = uniqueStrings([
    ...stringArray(applyReport.iconRefs),
    ...nodes.flatMap((node) => stringArray(node.iconRefs)),
    ...nodes.flatMap((node) => {
      const iconKey = stringField(node, "iconKey");
      return iconKey === undefined ? [] : [iconKey];
    }),
  ]);

  return {
    schemaVersion: ArtifactSchemaVersionByType["design-system-usage-report"],
    summary: `Reused ${counted(reused.length, "design-system component")}, kept ${counted(screenDrafts.length, "screen-draft part")}, used ${counted(drafted.length, "draft component")}, used ${counted(iconRefs.length, "icon")}, kept ${counted(primitives.length, "primitive exception")}.`,
    refs: [
      ...reused.flatMap((part) => usageRef("reused", part)),
      ...screenDrafts.flatMap((part) => screenDraftUsageRef(part)),
      ...drafted.flatMap((part) => usageRef("drafted", part)),
      ...iconRefs.map((ref) => `icon: ${ref}`),
      ...primitives.flatMap((part) => {
        const name = stringField(part, "name");
        return name === undefined ? [] : [`primitive: ${name}`];
      }),
    ],
    data: {
      reusedComponents: reused.length,
      screenDraftParts: screenDrafts.length,
      draftComponents: drafted.length,
      iconRefs: iconRefs.length,
      primitiveExceptions: primitives.length,
    },
  };
}

function screenDraftUsageRef(part: Record<string, unknown>): string[] {
  const name = stringField(part, "name");
  return name === undefined ? [] : [`screen-draft: ${name}`];
}

function usageRef(prefix: string, part: Record<string, unknown>): string[] {
  const name = stringField(part, "name");
  const componentKey = stringField(part, "componentKey");
  return name === undefined || componentKey === undefined
    ? []
    : [`${prefix}: ${name} -> ${componentKey}`];
}

function counted(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
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
      sourcePolicy: LOCAL_SOURCE_POLICY,
      summary: "No design-system fit report has been built yet.",
      exactMatches: [],
      substitutes: [],
      wrapCandidates: [],
      missingComponents: [],
      iconMatches: [],
      variableGaps: [],
      variableRefs: [],
      repeatedPatterns: [],
    };
  }
  return {
    schemaVersion: "DesignSystemFitReport/v1",
    source: value.source === "local-cache-with-remote-fallback" ? value.source : "local-cache",
    sourcePolicy: LOCAL_SOURCE_POLICY,
    summary: typeof value.summary === "string" ? value.summary : "Design-system fit report.",
    exactMatches: arrayFrom<FitMatch>(value.exactMatches),
    substitutes: arrayFrom<FitMatch>(value.substitutes),
    wrapCandidates: arrayFrom<WrapCandidate>(value.wrapCandidates),
    missingComponents: arrayFrom<FitGap>(value.missingComponents),
    approvedPrimitiveExceptions: stringArray(value.approvedPrimitiveExceptions),
    variableGaps: arrayFrom<VariableGap>(value.variableGaps),
    variableRefs: variableRefsFrom(value.variableRefs),
    iconMatches: arrayFrom<IconMatch>(value.iconMatches),
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

function uniqueVariables(variables: LocalVariableRef[]): LocalVariableRef[] {
  const byKey = new Map<string, LocalVariableRef>();
  variables.forEach((variable) => {
    const key = variable.id ?? variable.key ?? `${variable.kind}:${variable.name}`;
    if (!byKey.has(key)) byKey.set(key, variable);
  });
  return Array.from(byKey.values());
}

function uniqueIcons(icons: LocalIconRef[]): LocalIconRef[] {
  const byKey = new Map<string, LocalIconRef>();
  icons.forEach((icon) => {
    if (!byKey.has(icon.key)) byKey.set(icon.key, icon);
  });
  return Array.from(byKey.values());
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function hasAny(value: string, candidates: string[]): boolean {
  const tokens = tokenSet(value);
  return candidates.some((candidate) =>
    tokenSet(candidate).some((token) => tokens.includes(token))
  );
}

function optionalString(value: unknown): string[] {
  return typeof value === "string" && value.trim().length > 0 ? [value] : [];
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

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayFrom<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
