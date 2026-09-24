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
  ambiguous?: true;
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
 * Insert or replace an icon row by published identity within its source file.
 * Caller must hold a transaction across batches.
 */
export function upsertIcon(db: Database, row: IconRow): void {
  db.prepare("DELETE FROM icons WHERE file_key = ? AND key = ?").run(row.fileKey, row.key);
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
    SELECT name, key, signal, file_key as fileKey,
      (SELECT COUNT(*) FROM icons AS peers WHERE peers.name = icons.name) AS nameCount
    FROM icons
    WHERE icons MATCH ?
    ORDER BY rank
    LIMIT ?
  `)
    .all(queryTerm, limit) as (IconSearchResult & { nameCount: number })[];
  return rows.map(({ nameCount, ...row }) => ({
    ...row,
    ...(nameCount > 1 ? { ambiguous: true as const } : {}),
  }));
}

/** Read one icon SVG by stable identity; a name alone resolves only if unique. */
export function getIconSvg(
  db: Database,
  name: string,
  fileKey?: string,
  key?: string
): string | null {
  const rows =
    fileKey === undefined || key === undefined
      ? (db.prepare("SELECT svg FROM icons WHERE name = ? LIMIT 2").all(name) as {
          svg: string | null;
        }[])
      : (db
          .prepare("SELECT svg FROM icons WHERE file_key = ? AND key = ? LIMIT 2")
          .all(fileKey, key) as { svg: string | null }[]);
  return rows.length === 1 ? rows[0].svg : null;
}
