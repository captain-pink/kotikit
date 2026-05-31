import type { Database } from "bun:sqlite";
import type { FigmaClient } from "./figma-client.js";
import type { FileCheckpoint } from "./checkpoint.js";
import type { ComponentJson } from "./component-shape.js";
import type { VariablesJson } from "./variables.js";
import type { FigmaPublishedComponent, FigmaComponentSet, FigmaTreeNode } from "./figma-types.js";
import { detectIconSignal } from "./icon-detect.js";
import { buildComponentJson, buildPropsString } from "./component-shape.js";
import { upsertComponent } from "../db/components-db.js";
import { upsertIcon } from "../db/icons-db.js";
import { mergeVariables } from "./variables.js";

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
}

/**
 * Walk a Figma document tree and extract COMPONENT + COMPONENT_SET nodes.
 * Used when /components returns empty (unpublished libraries / free-plan files).
 *
 * Returns the same shapes that FigmaClient.getComponents / getComponentSets return
 * so downstream code (icon classification, component-shape mapping) works unchanged.
 */
function extractComponentsFromTree(
  document: { children?: FigmaTreeNode[] } | undefined,
  pageNameByNodeId: Record<string, string>
): {
  components: FigmaPublishedComponent[];
  componentSets: FigmaComponentSet[];
} {
  const components: FigmaPublishedComponent[] = [];
  const componentSets: FigmaComponentSet[] = [];

  const pages = document?.children ?? [];
  for (const page of pages) {
    const pageName = page.name ?? "";
    if (page.id && page.name) pageNameByNodeId[page.id] = page.name;

    const walk = (node: FigmaTreeNode): void => {
      if (!node) return;
      if (node.id && page.name) {
        pageNameByNodeId[node.id] = page.name;
      }

      if (node.type === "COMPONENT_SET" && node.id && node.name) {
        componentSets.push({
          key: node.id,
          node_id: node.id,
          name: node.name,
          ...(node.description ? { description: node.description } : {}),
          ...(node.componentPropertyDefinitions
            ? { componentPropertyDefinitions: node.componentPropertyDefinitions as Record<string, never> }
            : {}),
        } as FigmaComponentSet);
        // Don't recurse INTO a component set's child variants — they're variants, not separate components.
        return;
      }

      if (node.type === "COMPONENT" && node.id && node.name) {
        // Any COMPONENT we reach here is standalone (we stop at COMPONENT_SET above).
        components.push({
          key: node.id,
          node_id: node.id,
          name: node.name,
          ...(node.description ? { description: node.description } : {}),
          containing_frame: { pageName },
        } as FigmaPublishedComponent);
      }

      // Recurse into children for non-component-set nodes.
      for (const child of node.children ?? []) {
        walk(child);
      }
    };

    for (const child of page.children ?? []) {
      walk(child);
    }
  }

  return { components, componentSets };
}

/**
 * Run one Figma file through the sync pipeline.
 * Writes to the two SQLite DBs (the caller has the transaction).
 * Does NOT write per-component JSONs, variables.json, or manifest.json.
 * Those are returned for the multi-file orchestrator to write at the end.
 */
export async function syncOneFile(opts: SyncOneFileOpts): Promise<SyncOneFileResult> {
  const { root: _root, client, fileKey, fileName, componentsDb, iconsDb, resumeFrom, onStage } = opts;
  void _root;

  const startStage = resumeFrom?.stage;
  const skipped: { stage: string; reason: string }[] = [];

  // Cache intermediate state across stages (this all lives inside one call,
  // so resume only matters when starting fresh; if resume points beyond stage N,
  // we skip the work of fetching for stage N).
  let pageNameByNodeId: Record<string, string> = {};
  let publishedComponents: Awaited<ReturnType<FigmaClient["getComponents"]>> = [];
  let componentSets: Awaited<ReturnType<FigmaClient["getComponentSets"]>> = [];
  let styles: Awaited<ReturnType<FigmaClient["getStyles"]>> = [];
  let localVariables: Awaited<ReturnType<FigmaClient["getLocalVariables"]>> = null;
  let nodeDetailsById: Record<string, Awaited<ReturnType<FigmaClient["getNodes"]>>[string]> = {};

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
    const file = await client.getFile(fileKey);
    // Build pageNameByNodeId from document.children (pages).
    const pages = file.document?.children ?? [];
    for (const page of pages) {
      if (page.id && page.name) {
        pageNameByNodeId[page.id] = page.name;
        // Also map each direct child to its page name so component lookup works
        for (const child of page.children ?? []) {
          if (child.id) pageNameByNodeId[child.id] = page.name;
        }
      }
    }
    await onStage?.("metadata");
  }

  // ── Stage 2: components ─────────────────────────────────────────────────
  if (shouldRun("components")) {
    publishedComponents = await client.getComponents(fileKey);
    await onStage?.("components");
  }

  // ── Stage 3: component_sets ─────────────────────────────────────────────
  if (shouldRun("component_sets")) {
    componentSets = await client.getComponentSets(fileKey);
    await onStage?.("component_sets");
  }

  // ── Fallback: document-tree extraction ─────────────────────────────────
  // When both /components and /component_sets returned empty AND the stages
  // actually ran (not skipped due to resume), fall back to walking the file
  // document tree directly. This handles free-plan Figma files where the
  // library-publish step (Enterprise/paid feature) was never performed.
  if (publishedComponents.length === 0 && componentSets.length === 0 && shouldRun("components")) {
    const file = await client.getDocument(fileKey, 4);
    const extracted = extractComponentsFromTree(
      file.document as { children?: FigmaTreeNode[] } | undefined,
      pageNameByNodeId
    );
    if (extracted.components.length > 0 || extracted.componentSets.length > 0) {
      publishedComponents = extracted.components;
      componentSets = extracted.componentSets;
      skipped.push({
        stage: "components",
        reason: "Library not published — fell back to document tree extraction.",
      });
    }
  }

  // ── Stage 4: styles ─────────────────────────────────────────────────────
  if (shouldRun("styles")) {
    styles = await client.getStyles(fileKey);
    await onStage?.("styles");
  }

  // ── Stage 5: variables ──────────────────────────────────────────────────
  if (shouldRun("variables")) {
    localVariables = await client.getLocalVariables(fileKey);
    if (localVariables === null) {
      skipped.push({ stage: "variables", reason: "Enterprise-gated (403)" });
    }
    await onStage?.("variables");
  }

  // ── Stage 6: node_details ───────────────────────────────────────────────
  if (shouldRun("node_details")) {
    // Collect node ids we need: style node ids + published component node ids.
    const styleIds = styles.map((s) => s.node_id).filter((x): x is string => typeof x === "string");
    const componentNodeIds = publishedComponents.map((c) => c.node_id);
    const allIds = Array.from(new Set([...styleIds, ...componentNodeIds]));

    const BATCH = 100;
    const startProcessed = (resumeFrom?.stage === "node_details" && resumeFrom.cursor?.processed) || 0;
    let processed = startProcessed;
    while (processed < allIds.length) {
      const batch = allIds.slice(processed, processed + BATCH);
      const nodes = await client.getNodes(fileKey, batch);
      Object.assign(nodeDetailsById, nodes);
      processed += batch.length;
      await onStage?.("node_details", { processed, batchSize: BATCH });
    }
    if (allIds.length === 0) {
      await onStage?.("node_details");
    }
  }

  // ── Stage 7: icons (and classification) ─────────────────────────────────
  let iconCount = 0;
  const componentJsons: ComponentJson[] = [];
  if (shouldRun("icons")) {
    // Index component sets by key for lookup
    const componentSetByKey: Record<string, (typeof componentSets)[number]> = {};
    for (const cs of componentSets) componentSetByKey[cs.key] = cs;

    for (const pub of publishedComponents) {
      const pageName = pageNameByNodeId[pub.node_id] ?? pub.containing_frame?.pageName ?? "";
      const componentName = pub.name;
      const signal = detectIconSignal({ pageName, componentName });

      if (signal !== null) {
        upsertIcon(iconsDb, {
          name: componentName,
          key: pub.key,
          signal,
          fileKey,
        });
        iconCount++;
        continue;
      }

      const componentSet = pub.component_set_id ? componentSetByKey[pub.component_set_id] : undefined;
      const nodeDetail = nodeDetailsById[pub.node_id];

      const json = buildComponentJson({
        fileKey,
        publishedComponent: pub,
        componentSet,
        // The API returns { document: { componentPropertyDefinitions?: ... } };
        // component-shape expects { componentPropertyDefinitions?: ... } at the top level.
        nodeDetails: nodeDetail?.document,
      });
      componentJsons.push(json);

      upsertComponent(componentsDb, {
        name: json.name,
        path: json.path,
        key: json.key,
        fileKey,
        props: buildPropsString(json),
      });
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
  };
}
