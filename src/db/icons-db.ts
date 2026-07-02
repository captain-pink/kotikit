import type { Database } from "bun:sqlite";
import { buildNameTokens } from "./camel-tokens.js";

type IconSignal = "page" | "prefix" | "slash";

export interface IconRow {
  name: string; // "arrow-right"
  key: string; // Figma node/component key
  svg?: string; // optional inline svg or url; UNINDEXED, lazy-read
  signal: IconSignal; // which detector matched
  fileKey: string;
}

export interface IconSearchResult {
  name: string;
  key: string;
  signal: IconSignal;
  fileKey: string;
  // svg deliberately omitted from search to keep results token-cheap
}

/** Create the FTS5 icons table if it does not exist. */
export function initIconsDb(db: Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS icons USING fts5(
      name,
      name_tokens,
      key UNINDEXED,
      svg UNINDEXED,
      signal UNINDEXED,
      file_key UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}

/** Remove all rows from the icons table. */
export function clearIcons(db: Database): void {
  db.exec("DELETE FROM icons;");
}

/** Remove icon rows that came from one Figma file. */
export function deleteIconsByFileKey(db: Database, fileKey: string): void {
  db.prepare("DELETE FROM icons WHERE file_key = ?").run(fileKey);
}

/**
 * Insert or replace an icon row by name.
 * Caller must hold a transaction across batches.
 */
export function upsertIcon(db: Database, row: IconRow): void {
  db.prepare("DELETE FROM icons WHERE name = ?").run(row.name);
  db.prepare(`
    INSERT INTO icons (name, name_tokens, key, svg, signal, file_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.name, buildNameTokens(row.name), row.key, row.svg ?? null, row.signal, row.fileKey);
}

/**
 * Search icons by name. Returns up to `limit` rows (default 50), ordered by FTS5 rank.
 * The svg column is NEVER returned by search — call getIconSvg to fetch it on demand.
 */
export function searchIcons(
  db: Database,
  queryTerm: string,
  limit: number = 50
): IconSearchResult[] {
  const rows = db
    .prepare(`
    SELECT name, key, signal, file_key as fileKey
    FROM icons
    WHERE icons MATCH ?
    ORDER BY rank
    LIMIT ?
  `)
    .all(queryTerm, limit) as IconSearchResult[];
  return rows;
}

/** Read the svg payload for one icon by name. Returns null if missing or no svg stored. */
export function getIconSvg(db: Database, name: string): string | null {
  const row = db.prepare("SELECT svg FROM icons WHERE name = ?").get(name) as {
    svg: string | null;
  } | null;
  if (!row) return null;
  return row.svg;
}
