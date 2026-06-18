import type { Database } from "bun:sqlite";
import type { FigmaClient } from "./figma-client.js";
import type { FileCheckpoint } from "./checkpoint.js";
import type { ComponentJson } from "./component-shape.js";
import type { VariablesJson } from "./variables.js";
import { buildPropsString } from "./component-shape.js";
import {
  buildNormalizationDiagnostics,
  normalizePublishedDesignSystem,
  type NormalizationDiagnostics,
} from "./normalize-design-system.js";
import { deleteComponentsByFileKey, upsertComponent } from "../db/components-db.js";
import { deleteIconsByFileKey, upsertIcon } from "../db/icons-db.js";
import { withTransaction } from "../db/sqlite.js";
import { mergeVariables } from "./variables.js";
import type { ProgressEmitter, FileContext } from "./progress.js";
import { formatMs } from "./progress.js";

export interface SyncOneFileOpts {
  root: string;
  client: FigmaClient;
  fileKey: string;
  fileName: string;
  componentsDb: Database;
  iconsDb: Database;
  resumeFrom?: FileCheckpoint;
  /** Optional progress reporter — called after each stage completes. */
  onStage?: (stage: FileCheckpoint["stage"], cursor?: FileCheckpoint["cursor"]) => void | Promise<void>;
  /** Optional live progress emitter — writes to stderr, zero token cost. */
  progress?: ProgressEmitter;
  /** File context for progress emitter (index, total, display name). */
  fileCtx?: FileContext;
}

export interface SyncOneFileResult {
  fileKey: string;
  fileName: string;
  componentCount: number;
  iconCount: number;
  variables: VariablesJson;
  /** Non-icon components, ready for the orchestrator to write to disk. */
  componentJsons: ComponentJson[];
  /** Page name lookup for diagnostics. */
  pageNameByNodeId: Record<string, string>;
  /** Stages skipped with reason — surfaces to the sync report. */
  skipped: { stage: string; reason: string }[];
  /** Compact normalizer quality metrics for sync reports. */
  normalizationDiagnostics: NormalizationDiagnostics | null;
}

/**
 * Run one Figma file through the sync pipeline.
 * Writes to the two SQLite DBs (the caller has the transaction).
 * Does NOT write per-component JSONs, variables.json, or manifest.json.
 * Those are returned for the multi-file orchestrator to write at the end.
 */
export async function syncOneFile(opts: SyncOneFileOpts): Promise<SyncOneFileResult> {
  const { root: _root, client, fileKey, fileName, componentsDb, iconsDb, resumeFrom, onStage, progress, fileCtx } = opts;
  void _root;

  const startStage = resumeFrom?.stage;
  const skipped: { stage: string; reason: string }[] = [];

  // Cache intermediate state across stages (this all lives inside one call,
  // so resume only matters when starting fresh; if resume points beyond stage N,
  // we skip the work of fetching for stage N).
  let pageNameByNodeId: Record<string, string> = {};
  let pageIds: string[] = [];
  let publishedComponents: Awaited<ReturnType<FigmaClient["getComponents"]>> = [];
  let componentSets: Awaited<ReturnType<FigmaClient["getComponentSets"]>> = [];
  let styles: Awaited<ReturnType<FigmaClient["getStyles"]>> = [];
  let localVariables: Awaited<ReturnType<FigmaClient["getLocalVariables"]>> = null;
  let nodeDetailsById: Record<string, Awaited<ReturnType<FigmaClient["getNodes"]>>[string]> = {};

  if (resumeFrom === undefined || resumeFrom.stage === "metadata") {
    deleteComponentsByFileKey(componentsDb, fileKey);
    deleteIconsByFileKey(iconsDb, fileKey);
  }

  // helper to decide whether a stage runs given the resume point
  const stages: FileCheckpoint["stage"][] = [
    "metadata", "components", "component_sets", "styles",
    "variables", "node_details", "icons", "done",
  ];
  const startIndex = startStage ? stages.indexOf(startStage) : 0;
  const shouldRun = (stage: FileCheckpoint["stage"]): boolean =>
    stages.indexOf(stage) >= startIndex;

  // ── Stage 1: metadata ───────────────────────────────────────────────────
  if (shouldRun("metadata")) {
    const metadataStart = Date.now();
    if (progress && fileCtx) progress.stage(fileCtx, "metadata");
    const file = await client.getFile(fileKey);
    // Build pageNameByNodeId from document.children (pages).
    const pages = file.document?.children ?? [];
    for (const page of pages) {
      if (page.id && page.name) {
        pageIds.push(page.id);
        pageNameByNodeId[page.id] = page.name;
        // Also map each direct child to its page name so component lookup works
        for (const child of page.children ?? []) {
          if (child.id) pageNameByNodeId[child.id] = page.name;
        }
      }
    }
    if (progress && fileCtx) progress.stageDone(fileCtx, "metadata", formatMs(Date.now() - metadataStart));
    await onStage?.("metadata");
  }

  // ── Stage 2: components ─────────────────────────────────────────────────
  if (shouldRun("components")) {
    if (progress && fileCtx) progress.stage(fileCtx, "components");
    publishedComponents = await client.getComponents(fileKey);
    if (progress && fileCtx) progress.stageDone(fileCtx, "components", `${publishedComponents.length} returned`);
    await onStage?.("components");
  }

  // ── Stage 3: component_sets ─────────────────────────────────────────────
  if (shouldRun("component_sets")) {
    if (progress && fileCtx) progress.stage(fileCtx, "component_sets");
    componentSets = await client.getComponentSets(fileKey);
    if (progress && fileCtx) progress.stageDone(fileCtx, "component_sets", `${componentSets.length} returned`);
    await onStage?.("component_sets");
  }

  // ── Diagnostic: unpublished libraries ──────────────────────────────────
  // Figma draft generation needs published/importable component keys. If a
  // file has no published components or component sets, do not treat its local
  // document tree as a usable design system.
  if (publishedComponents.length === 0 && componentSets.length === 0 && shouldRun("components")) {
    skipped.push({
      stage: "components",
      reason: "This Figma file is not published as a library, so its components cannot be used in generated Figma drafts.",
    });
  }

  // ── Early write: seed componentsDb with names/paths before node_details ──
  // node_details is the longest stage (~35 s for MUI3). Without this pass the
  // DB stays empty until Stage 7 finishes. Stage 7 overwrites these rows with
  // full prop data once node details are available.
  if (publishedComponents.length > 0) {
    const earlyNormalization = normalizePublishedDesignSystem({
      fileKey,
      publishedComponents,
      componentSets,
      nodeDetailsById: {},
      pageNameByNodeId,
    });

    withTransaction(componentsDb, () => {
      for (const json of earlyNormalization.components) {
        upsertComponent(componentsDb, {
          name: json.name,
          path: json.path,
          key: json.key,
          fileKey,
          props: "",
        });
      }
    });
  }

  // ── Stage 4: styles ─────────────────────────────────────────────────────
  if (shouldRun("styles")) {
    if (progress && fileCtx) progress.stage(fileCtx, "styles");
    styles = await client.getStyles(fileKey);
    if (progress && fileCtx) progress.stageDone(fileCtx, "styles", `${styles.length}`);
    await onStage?.("styles");
  }

  // ── Stage 5: variables ──────────────────────────────────────────────────
  if (shouldRun("variables")) {
    if (progress && fileCtx) progress.stage(fileCtx, "variables");
    localVariables = await client.getLocalVariables(fileKey);
    if (localVariables === null) {
      skipped.push({ stage: "variables", reason: "Enterprise-gated (403)" });
      if (progress && fileCtx) progress.stageDone(fileCtx, "variables", "skipped (Enterprise-gated 403)");
    } else {
      if (progress && fileCtx) progress.stageDone(fileCtx, "variables");
    }
    await onStage?.("variables");
  }

  // ── Stage 6: node_details ───────────────────────────────────────────────
  if (shouldRun("node_details")) {
    // Collect node ids we need: style node ids + published component node ids.
    const styleIds = styles.map((s) => s.node_id).filter((x): x is string => typeof x === "string");
    const componentNodeIds = normalizePublishedDesignSystem({
      fileKey,
      publishedComponents,
      componentSets,
      nodeDetailsById: {},
      pageNameByNodeId,
    }).nodeIdsForDetails;
    const allIds = Array.from(new Set([...styleIds, ...componentNodeIds]));

    const BATCH = 100;
    const nodeDetailsStart = Date.now();
    const startProcessed = (resumeFrom?.stage === "node_details" && resumeFrom.cursor?.processed) || 0;
    let processed = startProcessed;
    while (processed < allIds.length) {
      const batch = allIds.slice(processed, processed + BATCH);
      const nodes = await client.getNodes(fileKey, batch);
      Object.assign(nodeDetailsById, nodes);
      processed += batch.length;
      await onStage?.("node_details", { processed, batchSize: BATCH });
      if (progress && fileCtx) {
        progress.stageProgress(fileCtx, "node_details", {
          processed,
          total: allIds.length,
          label: processed >= allIds.length ? formatMs(Date.now() - nodeDetailsStart) : undefined,
        });
      }
    }
    if (allIds.length === 0) {
      await onStage?.("node_details");
    }
  }

  // ── Stage 7: icons (and classification) ─────────────────────────────────
  let iconCount = 0;
  const componentJsons: ComponentJson[] = [];
  let normalizationDiagnostics: NormalizationDiagnostics | null = null;
  if (shouldRun("icons")) {
    if (progress && fileCtx) progress.stage(fileCtx, "icons", "classifying components...");

    const normalizationInput = {
      fileKey,
      publishedComponents,
      componentSets,
      nodeDetailsById,
      pageNameByNodeId,
    };
    const normalized = normalizePublishedDesignSystem(normalizationInput);
    normalizationDiagnostics = buildNormalizationDiagnostics(normalizationInput, normalized);

    for (const icon of normalized.icons) {
      upsertIcon(iconsDb, icon);
      iconCount++;
    }

    for (const json of normalized.components) {
      componentJsons.push(json);
      upsertComponent(componentsDb, {
        name: json.name,
        path: json.path,
        key: json.key,
        fileKey,
        props: buildPropsString(json),
      });
    }

    for (const warning of normalized.warnings) {
      skipped.push({ stage: "normalize", reason: warning.message });
    }

    if (progress && fileCtx) {
      progress.stageDone(fileCtx, "icons", `${iconCount} icons, ${componentJsons.length} non-icons`);
    }
    await onStage?.("icons");
  }

  // ── Stage 8: done ───────────────────────────────────────────────────────
  await onStage?.("done");

  // Build styleDetailsByNodeId for the variables merger
  const styleDetailsByNodeId: Record<string, NonNullable<(typeof nodeDetailsById)[string]>> = {};
  for (const id of Object.keys(nodeDetailsById)) {
    const v = nodeDetailsById[id];
    if (v) styleDetailsByNodeId[id] = v;
  }
  const variables = mergeVariables({
    variables: localVariables,
    styles,
    styleDetailsByNodeId,
  });

  return {
    fileKey,
    fileName,
    componentCount: componentJsons.length,
    iconCount,
    variables,
    componentJsons,
    pageNameByNodeId,
    skipped,
    normalizationDiagnostics,
  };
}
