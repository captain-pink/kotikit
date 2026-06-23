import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/load.js";
import { isGitRepo } from "../git/auto-commit.js";
import type { BridgeStatus } from "../mcp/bridge/manager.js";
import { readComponentPlan } from "../planning/component-plan-store.js";
import { readDesignPlan } from "../planning/design-plan-store.js";
import { readFlowManifest, readScreenSpec } from "../spec/engine.js";
import type { ScreenComponent, ScreenSpec } from "../spec/schema.js";
import { hasCheckpoint } from "../sync/checkpoint.js";
import { resolveFigmaToken } from "../sync/figma-token.js";
import { readVariablesJson } from "../sync/variable-resolver.js";
import {
  configPath,
  designApplyLogPath,
  flowManifestPath,
  manifestPath,
  syncReportPath,
} from "../util/paths.js";
import type {
  WorkflowApplyProgress,
  WorkflowBridgeSnapshot,
  WorkflowSnapshot,
  WorkflowTargetSnapshot,
} from "./workflow-schema.js";

interface CollectWorkflowSnapshotInput {
  root: string;
  scope?: string;
  screen?: string | null;
  bridgeStatus?: BridgeStatus;
}

const fileExists = (path: string): boolean => existsSync(path);

const readJsonIfExists = async (path: string): Promise<unknown | null> => {
  if (!fileExists(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
};

const variablesSkippedInReport = async (root: string): Promise<boolean> => {
  const raw = await readJsonIfExists(syncReportPath(root));
  if (typeof raw !== "object" || raw === null || !("skipped" in raw)) return false;
  const skipped = (raw as { skipped?: unknown }).skipped;
  if (!Array.isArray(skipped)) return false;
  return skipped.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { stage?: unknown }).stage === "variables"
  );
};

const hasSyncedManifest = async (root: string): Promise<boolean> => {
  const raw = await readJsonIfExists(manifestPath(root));
  if (typeof raw !== "object" || raw === null) return false;
  const files = (raw as { files?: unknown }).files;
  return Array.isArray(files);
};

const bridgeSnapshotFor = (status: BridgeStatus | undefined): WorkflowBridgeSnapshot => ({
  running: status?.running ?? false,
  staleConfig: status?.staleConfig ?? false,
});

const isMissingArtifact = (err: unknown): boolean =>
  err instanceof Error && err.name === "KotikitError";

const readSpecIfExists = async (
  root: string,
  scope: string,
  screen: string | null
): Promise<ScreenSpec | null> => {
  try {
    return await readScreenSpec(root, scope, screen);
  } catch (err) {
    if (isMissingArtifact(err)) return null;
    throw err;
  }
};

const flowExistsFor = (root: string, scope: string): boolean =>
  fileExists(flowManifestPath(root, scope));

const hasDraftTargetFor = async (
  root: string,
  scope: string,
  screen: string | null,
  spec: ScreenSpec
): Promise<boolean> => {
  if (spec.figmaTarget !== undefined) return true;
  if (screen === null) return false;
  try {
    const flow = await readFlowManifest(root, scope);
    return flow.figmaTarget !== undefined;
  } catch (err) {
    if (isMissingArtifact(err)) return false;
    throw err;
  }
};

const unresolvedComponentNames = (components: ScreenComponent[]): string[] =>
  components
    .filter(
      (component) =>
        component.dsKey === undefined &&
        (component.resolution === undefined || component.resolution.kind !== "inline-draft")
    )
    .filter((component) => component.resolution?.kind !== "create-draft-component")
    .map((component) => component.name);

const createDraftComponentNames = (components: ScreenComponent[]): string[] =>
  components
    .filter(
      (component) =>
        component.resolution?.kind === "create-draft-component" &&
        component.resolution.status !== "approved"
    )
    .map((component) => component.name);

const inlineDraftComponentNames = (components: ScreenComponent[]): string[] =>
  components
    .filter(
      (component) =>
        component.resolution?.kind === "inline-draft" && component.resolution.status !== "approved"
    )
    .map((component) => component.name);

const readApplyProgress = async (
  root: string,
  scope: string,
  screen: string | null,
  total: number
): Promise<WorkflowApplyProgress> => {
  if (total === 0) return { applied: 0, total, complete: false };
  const path = designApplyLogPath(root, scope, screen);
  if (!fileExists(path)) return { applied: 0, total, complete: false };
  const applied = (await readFile(path, "utf-8"))
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  return {
    applied,
    total,
    complete: applied >= total,
  };
};

const collectTargetSnapshot = async (
  root: string,
  scope: string | undefined,
  screen: string | null | undefined
): Promise<WorkflowTargetSnapshot | undefined> => {
  if (scope === undefined) return undefined;
  const screenSlug = screen ?? null;
  const spec = await readSpecIfExists(root, scope, screenSlug);
  if (spec === null) {
    return {
      scope,
      screen: screenSlug,
      specExists: false,
      flowExists: flowExistsFor(root, scope),
      hasDraftTarget: false,
      hasDesignPlan: false,
      unresolvedComponents: [],
      componentCreationRequired: [],
      inlineDraftRequired: [],
      applyProgress: { applied: 0, total: 0, complete: false },
    };
  }

  const designPlan = await readDesignPlan(root, scope, screenSlug);
  const componentPlan = await readComponentPlan(root, scope, screenSlug);
  const stepCount = designPlan?.steps.length ?? 0;
  return {
    scope,
    screen: screenSlug,
    specExists: true,
    flowExists: flowExistsFor(root, scope),
    hasDraftTarget: await hasDraftTargetFor(root, scope, screenSlug, spec),
    hasDesignPlan: designPlan !== null,
    unresolvedComponents: unresolvedComponentNames(spec.components),
    componentCreationRequired:
      componentPlan === null
        ? createDraftComponentNames(spec.components)
        : componentPlan.steps
            .filter((step) => step.kind === "create-draft-component")
            .map((step) => step.componentName),
    inlineDraftRequired: inlineDraftComponentNames(spec.components),
    applyProgress: await readApplyProgress(root, scope, screenSlug, stepCount),
  };
};

export async function collectWorkflowSnapshot(
  input: CollectWorkflowSnapshotInput
): Promise<WorkflowSnapshot> {
  const config = await loadConfig(input.root);
  const variables = await readVariablesJson(input.root);
  const activeTarget = await collectTargetSnapshot(input.root, input.scope, input.screen);
  return {
    initialized: fileExists(configPath(input.root)),
    isGitRepo: await isGitRepo(input.root),
    hasFigmaToken: (await resolveFigmaToken(input.root, config)) !== undefined,
    figmaFilesCount: config?.figma.designSystemFiles.length ?? 0,
    designSystem: {
      configured: (config?.figma.designSystemFiles.length ?? 0) > 0,
      synced: await hasSyncedManifest(input.root),
      hasVariables: variables !== null && variables.entries.length > 0,
      variablesSkipped: await variablesSkippedInReport(input.root),
      hasSyncCheckpoint: await hasCheckpoint(input.root),
    },
    bridge: bridgeSnapshotFor(input.bridgeStatus),
    ...(activeTarget !== undefined ? { activeTarget } : {}),
  };
}
