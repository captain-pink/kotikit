import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initRegistryDb,
  upsertRegistry,
  getRegistry,
  searchRegistry,
  clearRegistry,
} from "./registry-db.js";

describe("registry-db", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initRegistryDb(db);
  });

  it("init creates the registry table", () => {
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='registry'").all();
    expect(rows.length).toBe(1);
  });

  it("upsert + get round-trips", () => {
    upsertRegistry(db, { name: "Button", codePath: "src/components/ui/button.tsx", status: "code-only" });
    expect(getRegistry(db, "Button")).toEqual({
      name: "Button",
      codePath: "src/components/ui/button.tsx",
      status: "code-only",
    });
  });

  it("getRegistry returns null for missing name", () => {
    expect(getRegistry(db, "DoesNotExist")).toBeNull();
  });

  it("upsert by name overwrites prior row (status updates)", () => {
    upsertRegistry(db, { name: "Button", codePath: "p1", status: "code-only" });
    upsertRegistry(db, { name: "Button", codePath: "p2", status: "synced" });
    const got = getRegistry(db, "Button");
    expect(got?.codePath).toBe("p2");
    expect(got?.status).toBe("synced");
    // Still only one row total
    const count = (db.query("SELECT count(*) as n FROM registry").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("searchRegistry matches by exact name", () => {
    upsertRegistry(db, { name: "Button", codePath: "p", status: "code-only" });
    upsertRegistry(db, { name: "Card", codePath: "p", status: "code-only" });
    const results = searchRegistry(db, "Button");
    expect(results.map(r => r.name)).toEqual(["Button"]);
  });

  it("searchRegistry matches by prefix (LIKE 'But%')", () => {
    upsertRegistry(db, { name: "Button", codePath: "p", status: "code-only" });
    upsertRegistry(db, { name: "Buttonish", codePath: "p", status: "code-only" });
    upsertRegistry(db, { name: "Card", codePath: "p", status: "code-only" });
    const results = searchRegistry(db, "But");
    expect(results.map(r => r.name).sort()).toEqual(["Button", "Buttonish"]);
  });

  it("searchRegistry respects the limit", () => {
    for (let i = 0; i < 10; i++) {
      upsertRegistry(db, { name: `Component${i}`, codePath: "p", status: "code-only" });
    }
    expect(searchRegistry(db, "Component", 3)).toHaveLength(3);
  });

  it("rejects invalid status via CHECK constraint", () => {
    expect(() => {
      db.prepare(`INSERT INTO registry (name, code_path, status) VALUES (?, ?, ?)`)
        .run("Bad", "p", "invalid-status");
    }).toThrow();
  });

  it("clearRegistry removes all rows", () => {
    upsertRegistry(db, { name: "Button", codePath: "p", status: "code-only" });
    clearRegistry(db);
    expect(searchRegistry(db, "B")).toEqual([]);
  });
});
