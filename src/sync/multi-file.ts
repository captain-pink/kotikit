import type { FigmaClient } from "./figma-client.js";
import { syncOneFile } from "./sync-engine.js";
import {
  readCheckpoint, writeCheckpoint, clearCheckpoint,
  type Checkpoint, type FileCheckpoint,
} from "./checkpoint.js";
import { writeVariablesJson, type VariablesJson } from "./variables.js";
import { writeManifest, type SyncManifest } from "./manifest.js";
import {
  componentsDbPath, iconsDbPath, syncReportPath, componentJsonPath,
  designSystemDir, registryDbPath,
} from "../util/paths.js";
import { openDb, withTransaction } from "../db/sqlite.js";
import { initComponentsDb, upsertComponent } from "../db/components-db.js";
import { initIconsDb } from "../db/icons-db.js";
import { initRegistryDb, getRegistry, upsertRegistry } from "../db/registry-db.js";
import { nowIso, slugifyComponentName } from "../util/ids.js";
import { buildPropsString } from "./component-shape.js";
import type { ComponentJson } from "./component-shape.js";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { Database } from "bun:sqlite";

export interface SyncAllOpts {
  root: string;
  files: { key: string; name: string }[];
  client: FigmaClient;
}

export interface SyncReport {
  ranAt: string;
  files: { key: string; name: string; componentCount: number; iconCount: number }[];
  conflicts: SyncManifest["conflicts"];
  variableCollisions: { name: string; keptSource: "variable" | "style" }[];
  skipped: { fileKey: string; stage: string; reason: string }[];
  registryUpdates: { added: number; updated: number };
}

/**
 * Merge-aware upsert for a DS component row.
 * No row              → insert {kind:"component", name, ds_path, code_path:null, status:"design-only"}.
 * Existing design-only → update ds_path, keep status.
 * Existing synced      → update ds_path ONLY; keep code_path, keep status.
 * Existing code-only   → update ds_path; if code_path is non-null, promote to "synced".
 *
 * NOTE: This helper is inlined here for Phase 4. P4-B3 will extract it into
 *       src/db/registry-db.ts as upsertRegistryDsRow.
 */
function upsertDsRow(db: Database, input: { name: string; dsPath: string }): "added" | "updated" {
  const existing = getRegistry(db, "component", input.name);
  if (!existing) {
    upsertRegistry(db, { kind: "component", name: input.name, dsPath: input.dsPath, codePath: null, status: "design-only" });
    return "added";
  }
  if (existing.status === "synced") {
    upsertRegistry(db, { ...existing, dsPath: input.dsPath });
    return "updated";
  }
  if (existing.status === "code-only") {
    const promoted = existing.codePath ? "synced" : "code-only";
    upsertRegistry(db, { ...existing, dsPath: input.dsPath, status: promoted });
    return "updated";
  }
  // design-only path
  upsertRegistry(db, { ...existing, dsPath: input.dsPath });
  return "updated";
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
  const { root, files, client } = opts;

  await mkdir(designSystemDir(root), { recursive: true });

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

  // Drive sync per file in declared order.
  for (const file of files) {
    const resumeFrom = fileEntryByKey.get(file.key);

    // Skip files already completed in a prior run.
    if (resumeFrom?.stage === "done") continue;

    // Progress reporter — updates the checkpoint after each stage.
    const onStage = async (
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

    const result = await syncOneFile({
      root,
      client,
      fileKey: file.key,
      fileName: file.name,
      componentsDb,
      iconsDb,
      ...(resumeFrom ? { resumeFrom } : {}),
      onStage,
    });

    for (const s of result.skipped) {
      skipped.push({ fileKey: file.key, stage: s.stage, reason: s.reason });
    }

    fileResults.push(result);
  }

  // ── Post-loop: write per-component JSONs + handle conflicts ──────────────
  // Track which names have already been written by an earlier file.
  const writtenByName: Map<string, { fileKey: string; key: string }> = new Map();

  // Conflict tracker: name → { winnerFileKey, losers }
  const conflictByName: Map<string, SyncManifest["conflicts"][number]> = new Map();

  for (const result of fileResults) {
    for (const json of result.componentJsons) {
      const prior = writtenByName.get(json.name);
      if (prior) {
        // Later file wins; prior entry becomes a loser.
        const conflict = conflictByName.get(json.name) ?? {
          name: json.name,
          winnerFileKey: result.fileKey,
          losers: [] as Array<{ fileKey: string; key: string }>,
        };
        conflict.winnerFileKey = result.fileKey;
        conflict.losers.push({ fileKey: prior.fileKey, key: prior.key });
        conflictByName.set(json.name, conflict);

        // Overwrite the components.db row to point at the new file.
        upsertComponent(componentsDb, {
          name: json.name,
          path: json.path,
          key: json.key,
          fileKey: result.fileKey,
          props: buildPropsString(json),
        });
      }

      // Write the JSON file (overwrites prior file's JSON if any).
      await writeComponentJson(root, json);
      writtenByName.set(json.name, { fileKey: result.fileKey, key: json.key });
    }
  }

  // ── Upsert non-icon component rows into the registry DB ─────────────────
  let registryAdded = 0;
  let registryUpdated = 0;

  const regDbPath = registryDbPath(root);
  const regDb = openDb(regDbPath);
  try {
    initRegistryDb(regDb);
    withTransaction(regDb, () => {
      for (const result of fileResults) {
        for (const json of result.componentJsons) {
          const action = upsertDsRow(regDb, { name: json.name, dsPath: json.path });
          if (action === "added") registryAdded++;
          else registryUpdated++;
        }
      }
    });
  } finally {
    regDb.close();
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
    files: fileResults.map((r) => ({
      key: r.fileKey,
      name: r.fileName,
      componentCount: r.componentCount,
      iconCount: r.iconCount,
    })),
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
    registryUpdates: { added: registryAdded, updated: registryUpdated },
  };
  await writeReport(root, report);

  // Close DBs.
  componentsDb.close();
  iconsDb.close();

  return report;
}
