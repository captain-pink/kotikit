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
import { SyncPausedError } from "./errors.js";

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
  /** Optional pause check used by MCP handlers to return before client timeouts. */
  shouldPause?: () => boolean;
  /** Counts included when shouldPause requests a checkpointed pause. */
  pauseContext?: { filesCompleted: number; totalFiles: number };
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
  const {
    root: _root,
    client,
    fileKey,
    fileName,
    componentsDb,
    iconsDb,
    onStage,
    progress,
    fileCtx,
    shouldPause,
    pauseContext,
  } = opts;
  void _root;

  const skipped: { stage: string; reason: string }[] = [];

  // Stage outputs are intentionally kept in memory for one invocation only.
  // A resumed file therefore re-runs these idempotent fetches instead of
  // skipping work whose output was lost when the prior process stopped.
  let pageNameByNodeId: Record<string, string> = {};
  let publishedComponents: Awaited<ReturnType<FigmaClient["getComponents"]>> = [];
  let componentSets: Awaited<ReturnType<FigmaClient["getComponentSets"]>> = [];
  let styles: Awaited<ReturnType<FigmaClient["getStyles"]>> = [];
  let localVariables: Awaited<ReturnType<FigmaClient["getLocalVariables"]>> = null;
  let nodeDetailsById: Record<string, Awaited<ReturnType<FigmaClient["getNodes"]>>[string]> = {};

  deleteComponentsByFileKey(componentsDb, fileKey);
  deleteIconsByFileKey(iconsDb, fileKey);

  // ── Stage 1: metadata ───────────────────────────────────────────────────
  {
    const metadataStart = Date.now();
    if (progress && fileCtx) progress.stage(fileCtx, "metadata");
    try {
      const file = await client.getDocument(fileKey, 1);
      // Depth 1 returns page nodes only. Component page names primarily come
      // from /components containing_frame.pageName.
      const pages = file.document?.children ?? [];
      for (const page of pages) {
        if (page.id && page.name) {
          pageNameByNodeId[page.id] = page.name;
        }
      }
    } catch {
      pageNameByNodeId = {};
    }
    if (progress && fileCtx) progress.stageDone(fileCtx, "metadata", formatMs(Date.now() - metadataStart));
    await onStage?.("metadata");
    if (shouldPause?.()) {
      throw new SyncPausedError(
        pauseContext?.filesCompleted ?? 0,
        pauseContext?.totalFiles ?? 1,
        "metadata"
      );
    }
  }

  // ── Stage 2: components ─────────────────────────────────────────────────
  {
    if (progress && fileCtx) progress.stage(fileCtx, "components");
    publishedComponents = await client.getComponents(fileKey);
    if (progress && fileCtx) progress.stageDone(fileCtx, "components", `${publishedComponents.length} returned`);
    await onStage?.("components");
  }

  // ── Stage 3: component_sets ─────────────────────────────────────────────
  {
    if (progress && fileCtx) progress.stage(fileCtx, "component_sets");
    componentSets = await client.getComponentSets(fileKey);
    if (progress && fileCtx) progress.stageDone(fileCtx, "component_sets", `${componentSets.length} returned`);
    await onStage?.("component_sets");
  }

  // ── Diagnostic: unpublished libraries ──────────────────────────────────
  // Figma draft generation needs published/importable component keys. If a
  // file has no published components or component sets, do not treat its local
  // document tree as a usable design system.
  if (publishedComponents.length === 0 && componentSets.length === 0) {
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
  {
    if (progress && fileCtx) progress.stage(fileCtx, "styles");
    styles = await client.getStyles(fileKey);
    if (progress && fileCtx) progress.stageDone(fileCtx, "styles", `${styles.length}`);
    await onStage?.("styles");
  }

  // ── Stage 5: variables ──────────────────────────────────────────────────
  {
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
  {
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
    const WAVE = 3;
    const batches = Array.from(
      { length: Math.ceil(allIds.length / BATCH) },
      (_, index) => allIds.slice(index * BATCH, index * BATCH + BATCH)
    );
    const nodeDetailsStart = Date.now();
    let processed = 0;
    for (let waveStart = 0; waveStart < batches.length; waveStart += WAVE) {
      const wave = batches.slice(waveStart, waveStart + WAVE);
      const nodeDetailsResults = await Promise.all(
        wave.map((batch) => client.getNodes(fileKey, batch))
      );
      for (const nodes of nodeDetailsResults) {
        Object.assign(nodeDetailsById, nodes);
        processed = Math.min(processed + BATCH, allIds.length);
        await onStage?.("node_details", { processed, batchSize: BATCH });
        if (progress && fileCtx) {
          progress.stageProgress(fileCtx, "node_details", {
            processed,
            total: allIds.length,
            label: processed >= allIds.length ? formatMs(Date.now() - nodeDetailsStart) : undefined,
          });
        }
        if (shouldPause?.()) {
          throw new SyncPausedError(
            pauseContext?.filesCompleted ?? 0,
            pauseContext?.totalFiles ?? 1,
            "node_details"
          );
        }
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
  {
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
