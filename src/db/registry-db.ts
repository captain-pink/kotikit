import type { Database } from "bun:sqlite";

export interface RegistryRow {
  name: string;            // component or screen name, e.g. "Button" or "Cart"
  codePath: string;        // relative-to-project-root path of the code file
  status: "code-only" | "design-only" | "synced";
}

/** Create the registry table if it does not exist. */
export function initRegistryDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry (
      name      TEXT PRIMARY KEY,
      code_path TEXT,
      status    TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced'))
    );
  `);
}

/** Insert or replace a row by name. Caller may wrap several upserts in a transaction. */
export function upsertRegistry(db: Database, row: RegistryRow): void {
  db.prepare(`
    INSERT INTO registry (name, code_path, status)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      code_path = excluded.code_path,
      status    = excluded.status;
  `).run(row.name, row.codePath, row.status);
}

/** Get a row by exact name, or null. */
export function getRegistry(db: Database, name: string): RegistryRow | null {
  const row = db.prepare(`SELECT name, code_path as codePath, status FROM registry WHERE name = ?`).get(name) as RegistryRow | undefined;
  return row ?? null;
}

/**
 * Prefix-match search by name (LIKE 'query%').
 * No FTS5 — single-column registry doesn't justify it for Phase 3.
 * Default limit 25.
 */
export function searchRegistry(
  db: Database,
  queryTerm: string,
  limit: number = 25
): RegistryRow[] {
  const pattern = `${queryTerm}%`;
  const rows = db.prepare(`
    SELECT name, code_path as codePath, status
    FROM registry
    WHERE name LIKE ?
    ORDER BY name
    LIMIT ?
  `).all(pattern, limit) as RegistryRow[];
  return rows;
}

/** Remove all rows. Test helper / future re-sync use. */
export function clearRegistry(db: Database): void {
  db.exec(`DELETE FROM registry;`);
}
