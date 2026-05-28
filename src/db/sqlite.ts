import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

/**
 * Open a SQLite database at `path`, creating parent directories as needed.
 * Applies the standard pragmas used everywhere in kotikit:
 *   - journal_mode = WAL  (concurrent reads while writing)
 *   - synchronous = NORMAL
 *   - foreign_keys = ON
 */
export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * Run `fn` inside a single SQLite transaction.
 * Throws → ROLLBACK. Returns → COMMIT.
 * Uses bun:sqlite's `db.transaction(...)`.
 */
export function withTransaction<T>(db: Database, fn: () => T): T {
  // bun:sqlite returns a function that runs fn inside a transaction
  const tx = db.transaction(fn);
  return tx();
}
