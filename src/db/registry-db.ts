import type { Database } from "bun:sqlite";

export type RegistryKind = "screen" | "component";
export type RegistryStatus = "code-only" | "design-only" | "synced";

export interface RegistryRow {
  kind: RegistryKind;
  name: string;
  dsPath: string | null;    // component-side path: "components/button.json", null for screens
  codePath: string | null;  // code-side path, null when nothing is generated yet
  status: RegistryStatus;
}

/**
 * Idempotent migration.
 *
 * v0 → v1:
 *  - Ensure the Phase 3 baseline table exists (for fresh DBs).
 *  - Recreate with (kind, name) PK, adding ds_path column.
 *  - Copy all existing rows as kind='screen', ds_path=NULL.
 *  - Set user_version = 1.
 *
 * v1 → no-op.
 */
export function initRegistryDb(db: Database): void {
  db.exec("BEGIN");

  const { user_version: version } = db.query("PRAGMA user_version").get() as {
    user_version: number;
  };

  if (version === 0) {
    // Ensure Phase 3 baseline exists so the INSERT...SELECT below works on fresh DBs.
    db.exec(`
      CREATE TABLE IF NOT EXISTS registry (
        name      TEXT PRIMARY KEY,
        code_path TEXT,
        status    TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced'))
      );
    `);

    // Create the new v1 shape.
    db.exec(`
      CREATE TABLE registry_new (
        kind      TEXT NOT NULL CHECK (kind IN ('screen','component')),
        name      TEXT NOT NULL,
        ds_path   TEXT,
        code_path TEXT,
        status    TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced')),
        PRIMARY KEY (kind, name)
      );
    `);

    // Copy existing rows; all pre-existing rows are screens.
    db.exec(`
      INSERT INTO registry_new (kind, name, ds_path, code_path, status)
      SELECT 'screen', name, NULL, code_path, status FROM registry;
    `);

    db.exec("DROP TABLE registry;");
    db.exec("ALTER TABLE registry_new RENAME TO registry;");

    // user_version must be set outside of a transaction BEGIN/COMMIT in bun:sqlite.
    // We commit first, then set user_version.
    db.exec("COMMIT");
    db.exec("PRAGMA user_version = 1");
    return;
  }

  // v1 or higher: no-op.
  db.exec("COMMIT");
}

/** Insert or replace a row by (kind, name). */
export function upsertRegistry(db: Database, row: RegistryRow): void {
  db.prepare(`
    INSERT INTO registry (kind, name, ds_path, code_path, status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, name) DO UPDATE SET
      ds_path   = excluded.ds_path,
      code_path = excluded.code_path,
      status    = excluded.status;
  `).run(row.kind, row.name, row.dsPath, row.codePath, row.status);
}

/** Get a row by (kind, name), or null. */
export function getRegistry(
  db: Database,
  kind: RegistryKind,
  name: string
): RegistryRow | null {
  const r = db
    .prepare(
      `SELECT kind, name, ds_path as dsPath, code_path as codePath, status
       FROM registry WHERE kind = ? AND name = ?`
    )
    .get(kind, name) as RegistryRow | undefined;
  return r ?? null;
}

/**
 * Search registry with optional filters.
 *
 * Builds a conditional WHERE clause at call time to avoid named-parameter
 * complexity with bun:sqlite. All active conditions use positional `?` bindings.
 *
 * Default limit: 25.
 */
export function searchRegistry(
  db: Database,
  opts: {
    query?: string;
    kind?: RegistryKind;
    status?: RegistryStatus;
    limit?: number;
  }
): RegistryRow[] {
  const limit = opts.limit ?? 25;
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (opts.query !== undefined) {
    conditions.push("name LIKE ?");
    bindings.push(`${opts.query}%`);
  }
  if (opts.kind !== undefined) {
    conditions.push("kind = ?");
    bindings.push(opts.kind);
  }
  if (opts.status !== undefined) {
    conditions.push("status = ?");
    bindings.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT kind, name, ds_path as dsPath, code_path as codePath, status
    FROM registry
    ${where}
    ORDER BY name
    LIMIT ?
  `;

  bindings.push(limit);

  return db.prepare(sql).all(...bindings) as RegistryRow[];
}

/** Remove all rows. Test helper / future re-sync use. */
export function clearRegistry(db: Database): void {
  db.exec("DELETE FROM registry;");
}
