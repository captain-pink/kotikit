import type { Database } from "bun:sqlite";
import { buildNameTokens } from "./camel-tokens.js";

export interface ComponentRow {
  name: string;         // "Button"
  path: string;         // "components/button.json"  (relative to design-system/)
  key: string;          // Figma component-set key
  fileKey: string;      // source Figma file key
  props: string;        // space-separated property names ("Variant State Size Icon")
}

export interface ComponentSearchResult {
  name: string;
  path: string;
  key: string;
  fileKey: string;
}

/** Create the FTS5 components table if it does not exist. */
export function initComponentsDb(db: Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS components USING fts5(
      name,
      name_tokens,
      path UNINDEXED,
      key UNINDEXED,
      file_key UNINDEXED,
      props,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}

/** Remove all rows from the components table. */
export function clearComponents(db: Database): void {
  db.exec("DELETE FROM components;");
}

/** Remove component rows that came from one Figma file. */
export function deleteComponentsByFileKey(db: Database, fileKey: string): void {
  db.prepare("DELETE FROM components WHERE file_key = ?").run(fileKey);
}

/**
 * Insert or replace a component row by name.
 * FTS5 virtual tables do not support INSERT OR REPLACE, so we DELETE then INSERT.
 * Caller must hold a transaction for atomicity across multiple upserts.
 */
export function upsertComponent(db: Database, row: ComponentRow): void {
  db.prepare("DELETE FROM components WHERE name = ?").run(row.name);
  db.prepare(`
    INSERT INTO components (name, name_tokens, path, key, file_key, props)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    row.name,
    buildNameTokens(row.name),
    row.path,
    row.key,
    row.fileKey,
    row.props
  );
}

/**
 * Search components by name. Returns up to `limit` rows (default 25),
 * ordered by FTS5 rank. The query is treated as an FTS5 match expression,
 * so callers can pass "but*", "button", or "arrow OR cart".
 */
export function searchComponents(
  db: Database,
  queryTerm: string,
  limit: number = 25
): ComponentSearchResult[] {
  const rows = db.prepare(`
    SELECT name, path, key, file_key as fileKey
    FROM components
    WHERE components MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(queryTerm, limit) as ComponentSearchResult[];
  return rows;
}
