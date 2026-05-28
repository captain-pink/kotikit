import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb, withTransaction } from "./sqlite.js";

describe("openDb", () => {
  it("creates parent directories when missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kotikit-sqlite-"));
    const dbPath = join(tmp, "nested", "deeper", "test.db");
    const db = openDb(dbPath);
    db.close();
    expect(existsSync(dbPath)).toBe(true);
    rmSync(tmp, { recursive: true });
  });

  it("sets journal_mode to WAL", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kotikit-sqlite-"));
    const dbPath = join(tmp, "test.db");
    const db = openDb(dbPath);
    const result = db.query("PRAGMA journal_mode;").get() as { journal_mode: string };
    expect(result.journal_mode.toLowerCase()).toBe("wal");
    db.close();
    rmSync(tmp, { recursive: true });
  });
});

describe("withTransaction", () => {
  it("commits on success", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kotikit-sqlite-"));
    const db = openDb(join(tmp, "test.db"));
    db.exec("CREATE TABLE t (x INTEGER)");
    withTransaction(db, () => {
      db.exec("INSERT INTO t VALUES (1)");
      db.exec("INSERT INTO t VALUES (2)");
    });
    const rows = db.query("SELECT count(*) as n FROM t").get() as { n: number };
    expect(rows.n).toBe(2);
    db.close();
    rmSync(tmp, { recursive: true });
  });

  it("rolls back on throw", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kotikit-sqlite-"));
    const db = openDb(join(tmp, "test.db"));
    db.exec("CREATE TABLE t (x INTEGER)");
    expect(() => {
      withTransaction(db, () => {
        db.exec("INSERT INTO t VALUES (1)");
        throw new Error("boom");
      });
    }).toThrow("boom");
    const rows = db.query("SELECT count(*) as n FROM t").get() as { n: number };
    expect(rows.n).toBe(0);
    db.close();
    rmSync(tmp, { recursive: true });
  });

  it("returns the callback value on success", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kotikit-sqlite-"));
    const db = openDb(join(tmp, "test.db"));
    const result = withTransaction(db, () => 42);
    expect(result).toBe(42);
    db.close();
    rmSync(tmp, { recursive: true });
  });
});
