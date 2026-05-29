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

  // ---------------------------------------------------------------------------
  // Basic schema / init
  // ---------------------------------------------------------------------------

  it("init creates the registry table", () => {
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='registry'").all();
    expect(rows.length).toBe(1);
  });

  it("upsert + get round-trips", () => {
    upsertRegistry(db, { kind: "screen", name: "Button", dsPath: null, codePath: "src/components/ui/button.tsx", status: "code-only" });
    expect(getRegistry(db, "screen", "Button")).toEqual({
      kind: "screen",
      name: "Button",
      dsPath: null,
      codePath: "src/components/ui/button.tsx",
      status: "code-only",
    });
  });

  it("getRegistry returns null for missing name", () => {
    expect(getRegistry(db, "screen", "DoesNotExist")).toBeNull();
  });

  it("upsert by (kind, name) overwrites prior row (status updates)", () => {
    upsertRegistry(db, { kind: "screen", name: "Button", dsPath: null, codePath: "p1", status: "code-only" });
    upsertRegistry(db, { kind: "screen", name: "Button", dsPath: null, codePath: "p2", status: "synced" });
    const got = getRegistry(db, "screen", "Button");
    expect(got?.codePath).toBe("p2");
    expect(got?.status).toBe("synced");
    // Still only one row total
    const count = (db.query("SELECT count(*) as n FROM registry").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("searchRegistry matches by exact name", () => {
    upsertRegistry(db, { kind: "screen", name: "Button", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "screen", name: "Card", dsPath: null, codePath: "p", status: "code-only" });
    const results = searchRegistry(db, { query: "Button" });
    expect(results.map(r => r.name)).toEqual(["Button"]);
  });

  it("searchRegistry matches by prefix (LIKE 'But%')", () => {
    upsertRegistry(db, { kind: "screen", name: "Button", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "screen", name: "Buttonish", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "screen", name: "Card", dsPath: null, codePath: "p", status: "code-only" });
    const results = searchRegistry(db, { query: "But" });
    expect(results.map(r => r.name).sort()).toEqual(["Button", "Buttonish"]);
  });

  it("searchRegistry respects the limit", () => {
    for (let i = 0; i < 10; i++) {
      upsertRegistry(db, { kind: "screen", name: `Component${i}`, dsPath: null, codePath: "p", status: "code-only" });
    }
    expect(searchRegistry(db, { query: "Component", limit: 3 })).toHaveLength(3);
  });

  it("rejects invalid status via CHECK constraint", () => {
    expect(() => {
      db.prepare(`INSERT INTO registry (kind, name, code_path, status) VALUES (?, ?, ?, ?)`)
        .run("screen", "Bad", "p", "invalid-status");
    }).toThrow();
  });

  it("clearRegistry removes all rows", () => {
    upsertRegistry(db, { kind: "screen", name: "Button", dsPath: null, codePath: "p", status: "code-only" });
    clearRegistry(db);
    expect(searchRegistry(db, { query: "B" })).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Migration tests
  // ---------------------------------------------------------------------------

  it("migration: fresh DB — user_version is 1 after init", () => {
    const freshDb = new Database(":memory:");
    initRegistryDb(freshDb);
    const { user_version } = freshDb.query("PRAGMA user_version").get() as { user_version: number };
    expect(user_version).toBe(1);
    freshDb.close();
  });

  it("migration: v0 → v1 — pre-seeded Phase 3 row survives as kind=screen", () => {
    const freshDb = new Database(":memory:");
    // Pre-seed the Phase 3 schema BEFORE calling initRegistryDb.
    freshDb.exec(`CREATE TABLE registry (
      name TEXT PRIMARY KEY,
      code_path TEXT,
      status TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced'))
    )`);
    freshDb.exec(`INSERT INTO registry (name, code_path, status) VALUES ('Cart', 'src/x/Cart.tsx', 'code-only')`);

    initRegistryDb(freshDb);

    const { user_version } = freshDb.query("PRAGMA user_version").get() as { user_version: number };
    expect(user_version).toBe(1);

    const cart = getRegistry(freshDb, "screen", "Cart");
    expect(cart).toEqual({
      kind: "screen",
      name: "Cart",
      dsPath: null,
      codePath: "src/x/Cart.tsx",
      status: "code-only",
    });
    freshDb.close();
  });

  it("migration: idempotency — calling initRegistryDb three times on a v1 DB is a no-op", () => {
    // Insert a row so we can verify row counts don't change.
    upsertRegistry(db, { kind: "screen", name: "Cart", dsPath: null, codePath: "p", status: "code-only" });

    initRegistryDb(db);
    initRegistryDb(db);

    const count = (db.query("SELECT count(*) as n FROM registry").get() as { n: number }).n;
    expect(count).toBe(1);

    const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(user_version).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // PK is now (kind, name)
  // ---------------------------------------------------------------------------

  it("(kind, name) PK — screen and component with same name coexist", () => {
    upsertRegistry(db, { kind: "screen", name: "Cart", dsPath: null, codePath: "src/screens/Cart.tsx", status: "code-only" });
    upsertRegistry(db, { kind: "component", name: "Cart", dsPath: "components/cart.json", codePath: null, status: "design-only" });

    const screenRow = getRegistry(db, "screen", "Cart");
    expect(screenRow?.kind).toBe("screen");
    expect(screenRow?.codePath).toBe("src/screens/Cart.tsx");

    const componentRow = getRegistry(db, "component", "Cart");
    expect(componentRow?.kind).toBe("component");
    expect(componentRow?.dsPath).toBe("components/cart.json");

    const count = (db.query("SELECT count(*) as n FROM registry").get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it("CHECK constraint on kind — inserting an unknown kind throws", () => {
    expect(() => {
      db.prepare(`INSERT INTO registry (kind, name, code_path, status) VALUES (?, ?, ?, ?)`)
        .run("invalid-kind", "Foo", "p", "code-only");
    }).toThrow();
  });

  // ---------------------------------------------------------------------------
  // searchRegistry filters
  // ---------------------------------------------------------------------------

  it("searchRegistry: { status: 'design-only' } returns only design-only rows", () => {
    upsertRegistry(db, { kind: "screen", name: "Alpha", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "component", name: "Beta", dsPath: "b.json", codePath: null, status: "design-only" });
    upsertRegistry(db, { kind: "component", name: "Gamma", dsPath: "g.json", codePath: null, status: "design-only" });
    upsertRegistry(db, { kind: "component", name: "Delta", dsPath: "d.json", codePath: "p", status: "synced" });

    const results = searchRegistry(db, { status: "design-only" });
    expect(results.map(r => r.name).sort()).toEqual(["Beta", "Gamma"]);
    expect(results.every(r => r.status === "design-only")).toBe(true);
  });

  it("searchRegistry: { kind: 'component' } returns only components", () => {
    upsertRegistry(db, { kind: "screen", name: "CheckoutFlow", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "component", name: "Button", dsPath: "b.json", codePath: null, status: "design-only" });
    upsertRegistry(db, { kind: "component", name: "Card", dsPath: "c.json", codePath: null, status: "design-only" });

    const results = searchRegistry(db, { kind: "component" });
    expect(results.map(r => r.name).sort()).toEqual(["Button", "Card"]);
    expect(results.every(r => r.kind === "component")).toBe(true);
  });

  it("searchRegistry: combined kind + status uses AND logic", () => {
    upsertRegistry(db, { kind: "component", name: "Button", dsPath: "b.json", codePath: null, status: "design-only" });
    upsertRegistry(db, { kind: "component", name: "Card", dsPath: "c.json", codePath: "p", status: "synced" });
    upsertRegistry(db, { kind: "screen", name: "Cart", dsPath: null, codePath: "p", status: "design-only" });

    const results = searchRegistry(db, { kind: "component", status: "design-only" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Button");
  });

  it("searchRegistry: no query — returns all rows (subject to other filters)", () => {
    upsertRegistry(db, { kind: "screen", name: "Cart", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "component", name: "Button", dsPath: "b.json", codePath: null, status: "design-only" });
    upsertRegistry(db, { kind: "component", name: "Card", dsPath: "c.json", codePath: "p", status: "synced" });

    const results = searchRegistry(db, {});
    expect(results).toHaveLength(3);
  });

  it("searchRegistry: with query — prefix match still works", () => {
    upsertRegistry(db, { kind: "screen", name: "Cart", dsPath: null, codePath: "p", status: "code-only" });
    upsertRegistry(db, { kind: "component", name: "Button", dsPath: "b.json", codePath: null, status: "design-only" });
    upsertRegistry(db, { kind: "component", name: "ButtonIcon", dsPath: "bi.json", codePath: null, status: "design-only" });

    const results = searchRegistry(db, { query: "But" });
    expect(results.map(r => r.name).sort()).toEqual(["Button", "ButtonIcon"]);
  });
});
