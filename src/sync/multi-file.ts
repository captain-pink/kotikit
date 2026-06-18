import type { FigmaClient } from "./figma-client.js";
import { syncOneFile } from "./sync-engine.js";
import {
  readCheckpoint, writeCheckpoint, clearCheckpoint,
  type Checkpoint, type FileCheckpoint,
} from "./checkpoint.js";
import { stderrProgressEmitter, formatMs, type ProgressEmitter, type FileContext } from "./progress.js";
import { writeVariablesJson, type VariablesJson } from "./variables.js";
import { writeManifest, type SyncManifest } from "./manifest.js";
import {
  componentsDbPath, iconsDbPath, syncReportPath, componentJsonPath,
  designSystemDir, registryDbPath,
} from "../util/paths.js";
import { openDb } from "../db/sqlite.js";
import { initComponentsDb, upsertComponent } from "../db/components-db.js";
import { initIconsDb } from "../db/icons-db.js";
import { initRegistryDb, getRegistry, upsertRegistryDsRow } from "../db/registry-db.js";
import { nowIso, slugifyComponentName } from "../util/ids.js";
import { buildPropsString } from "./component-shape.js";
import type { ComponentJson } from "./component-shape.js";
import type { NormalizationDiagnostics } from "./normalize-design-system.js";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { Database } from "bun:sqlite";

export interface SyncAllOpts {
  root: string;
  files: { key: string; name: string }[];
  client: FigmaClient;
  /** Live progress emitter. Defaults to stderrProgressEmitter. */
  progress?: ProgressEmitter;
}

export interface SyncReport {
  ranAt: string;
  files: { key: string; name: string; componentCount: number; iconCount: number }[];
  conflicts: SyncManifest["conflicts"];
  variableCollisions: { name: string; keptSource: "variable" | "style" }[];
  skipped: { fileKey: string; stage: string; reason: string }[];
  normalizationDiagnostics: NormalizationDiagnostics[];
  registryUpdates: { added: number; updated: number };
}

/**
 * Local "added vs updated" classifier — checks for an existing row before
 * delegating the actual write to the canonical upsertRegistryDsRow helper.
 */
function upsertDsRow(db: Database, input: { name: string; dsPath: string }): "added" | "updated" {
  const existed = getRegistry(db, "component", input.name) !== null;
  upsertRegistryDsRow(db, input);
  return existed ? "updated" : "added";
}

async function writeComponentJson(root: string, json: ComponentJson): Promise<void> {
  const slug = slugifyComponentName(json.name);
  const path = componentJsonPath(root, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(json, null, 2) + "\n", "utf-8");
}

async function writeReport(root: string, report: SyncReport): Promise<void> {
  const path = syncReportPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
}

/**
 * Sync every configured Figma file into one local design-system snapshot.
 * Order matters: later-listed files override earlier ones on name collision.
 */
export async function syncAllFiles(opts: SyncAllOpts): Promise<SyncReport> {
  const { root, files, client, progress = stderrProgressEmitter } = opts;
  const syncStart = Date.now();

  await mkdir(designSystemDir(root), { recursive: true });

  progress.syncStart(files.length);

  // Open databases (separate files; both kept open through the whole sync).
  const componentsDb: Database = openDb(componentsDbPath(root));
  const iconsDb: Database = openDb(iconsDbPath(root));
  initComponentsDb(componentsDb);
  initIconsDb(iconsDb);

  // Read or seed the checkpoint.
  const existing = await readCheckpoint(root);
  const checkpoint: Checkpoint = existing ?? {
    version: 1,
    startedAt: nowIso(),
    files: files.map((f) => ({ fileKey: f.key, stage: "metadata" as const })),
  };

  // Track which files have a resume point already in the checkpoint.
  const fileEntryByKey: Map<string, FileCheckpoint> = new Map();
  for (const fc of checkpoint.files) fileEntryByKey.set(fc.fileKey, fc);

  type FileResult = Awaited<ReturnType<typeof syncOneFile>>;
  const fileResults: FileResult[] = [];

  const skipped: SyncReport["skipped"] = [];
  const normalizationDiagnostics: NormalizationDiagnostics[] = [];
  const manifestFiles: SyncReport["files"] = [];

  // Track which names have already been written by an earlier file.
  const writtenByName: Map<string, { fileKey: string; key: string }> = new Map();

  // Conflict tracker: name → { winnerFileKey, losers }
  const conflictByName: Map<string, SyncManifest["conflicts"][number]> = new Map();

  let registryAdded = 0;
  let registryUpdated = 0;

  const regDb = openDb(registryDbPath(root));
  initRegistryDb(regDb);

  const persistFileResult = async (result: FileResult): Promise<void> => {
    const writesCtx: FileContext = {
      index: files.findIndex((f) => f.key === result.fileKey) + 1,
      total: files.length,
      name: result.fileName,
    };
    const writesStart = Date.now();
    progress.stage(writesCtx, "writes", "writing component JSONs + registry rows...");

    for (const json of result.componentJsons) {
      const prior = writtenByName.get(json.name);
      if (prior) {
        const conflict = conflictByName.get(json.name) ?? {
          name: json.name,
          winnerFileKey: result.fileKey,
          losers: [] as Array<{ fileKey: string; key: string }>,
        };
        conflict.winnerFileKey = result.fileKey;
        conflict.losers.push({ fileKey: prior.fileKey, key: prior.key });
        conflictByName.set(json.name, conflict);
      }

      upsertComponent(componentsDb, {
        name: json.name,
        path: json.path,
        key: json.key,
        fileKey: result.fileKey,
        props: buildPropsString(json),
      });

      await writeComponentJson(root, json);
      writtenByName.set(json.name, { fileKey: result.fileKey, key: json.key });

      const action = upsertDsRow(regDb, { name: json.name, dsPath: json.path });
      if (action === "added") registryAdded++;
      else registryUpdated++;
    }

    progress.stageDone(writesCtx, "writes", `${formatMs(Date.now() - writesStart)}`);
  };

  // Drive sync per file in declared order.
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const resumeFrom = fileEntryByKey.get(file.key);

    // Skip files already completed in a prior run.
    if (resumeFrom?.stage === "done") continue;

    const fileCtx: FileContext = { index: i + 1, total: files.length, name: file.name };
    progress.fileStart(fileCtx);
    const fileStart = Date.now();

    // Progress reporter — updates the checkpoint after each stage.
    const writeFileCheckpoint = async (
      stage: FileCheckpoint["stage"],
      cursor?: FileCheckpoint["cursor"]
    ): Promise<void> => {
      const fc: FileCheckpoint = {
        fileKey: file.key,
        stage,
        ...(cursor ? { cursor } : {}),
      };
      const idx = checkpoint.files.findIndex((e) => e.fileKey === file.key);
      if (idx >= 0) checkpoint.files[idx] = fc;
      else checkpoint.files.push(fc);
      await writeCheckpoint(root, checkpoint);
    };

    const onStage = async (
      stage: FileCheckpoint["stage"],
      cursor?: FileCheckpoint["cursor"]
    ): Promise<void> => {
      if (stage === "done") return;
      await writeFileCheckpoint(stage, cursor);
    };

    const result = await syncOneFile({
      root,
      client,
      fileKey: file.key,
      fileName: file.name,
      componentsDb,
      iconsDb,
      ...(resumeFrom ? { resumeFrom } : {}),
      onStage,
      progress,
      fileCtx,
    });

    for (const s of result.skipped) {
      skipped.push({ fileKey: file.key, stage: s.stage, reason: s.reason });
    }
    if (result.normalizationDiagnostics !== null) {
      normalizationDiagnostics.push(result.normalizationDiagnostics);
    }

    await persistFileResult(result);
    await writeFileCheckpoint("done");
    fileResults.push(result);

    manifestFiles.push({
      key: result.fileKey,
      name: result.fileName,
      componentCount: result.componentCount,
      iconCount: result.iconCount,
    });

    progress.fileDone(fileCtx, {
      componentCount: result.componentCount,
      iconCount: result.iconCount,
      elapsedMs: Date.now() - fileStart,
    });
  }

  // ── Merge variables across files ─────────────────────────────────────────
  // Strategy: later file's variables win on collision.
  const allEntriesByName: Map<string, VariablesJson["entries"][number]> = new Map();
  const variableCollisions: VariablesJson["collisions"] = [];

  for (const result of fileResults) {
    for (const entry of result.variables.entries) {
      if (allEntriesByName.has(entry.name)) {
        variableCollisions.push({ name: entry.name, keptSource: entry.source });
      }
      allEntriesByName.set(entry.name, entry);
    }
    // Carry within-file collisions through.
    for (const c of result.variables.collisions) variableCollisions.push(c);
  }

  const mergedVariables: VariablesJson = {
    version: 1,
    entries: Array.from(allEntriesByName.values()),
    collisions: variableCollisions,
  };

  await writeVariablesJson(root, mergedVariables);

  // ── Write manifest ──────────────────────────────────────────────────────
  const conflicts: SyncManifest["conflicts"] = Array.from(conflictByName.values());
  const manifest: SyncManifest = {
    version: 1,
    lastSyncAt: nowIso(),
    files: manifestFiles,
    conflicts,
  };
  await writeManifest(root, manifest);

  // ── Mark every file done in the checkpoint then clear it ────────────────
  for (const file of files) {
    const idx = checkpoint.files.findIndex((e) => e.fileKey === file.key);
    if (idx >= 0) checkpoint.files[idx] = { fileKey: file.key, stage: "done" };
  }
  await writeCheckpoint(root, checkpoint);
  await clearCheckpoint(root);

  // ── Sync report ─────────────────────────────────────────────────────────
  const report: SyncReport = {
    ranAt: nowIso(),
    files: manifest.files,
    conflicts,
    variableCollisions,
    skipped,
    normalizationDiagnostics,
    registryUpdates: { added: registryAdded, updated: registryUpdated },
  };
  await writeReport(root, report);

  // Close DBs.
  componentsDb.close();
  iconsDb.close();
  regDb.close();

  const totalComponents = fileResults.reduce((sum, r) => sum + r.componentCount, 0);
  const totalIcons = fileResults.reduce((sum, r) => sum + r.iconCount, 0);
  progress.syncDone({
    fileCount: files.length,
    componentTotal: totalComponents,
    iconTotal: totalIcons,
    conflictCount: conflicts.length,
    elapsedMs: Date.now() - syncStart,
  });

  return report;
}
