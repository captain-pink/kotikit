import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initIconsDb,
  clearIcons,
  upsertIcon,
  searchIcons,
  getIconSvg,
} from "./icons-db.js";

describe("icons-db", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initIconsDb(db);
  });

  it("inits the FTS5 table", () => {
    const rows = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='icons'"
    ).all();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("upserts and searches by prefix", () => {
    upsertIcon(db, { name: "arrow-right", key: "k1", signal: "prefix", fileKey: "f1", svg: "<svg/>" });
    upsertIcon(db, { name: "arrow-left",  key: "k2", signal: "prefix", fileKey: "f1", svg: "<svg/>" });
    upsertIcon(db, { name: "home",        key: "k3", signal: "page",   fileKey: "f1", svg: "<svg/>" });

    const results = searchIcons(db, "arrow*");
    expect(results.map(r => r.name).sort()).toEqual(["arrow-left", "arrow-right"]);
    expect(results.find(r => r.name === "home")).toBeUndefined();
  });

  it("search results do NOT include svg", () => {
    upsertIcon(db, { name: "arrow-right", key: "k1", signal: "prefix", fileKey: "f1", svg: "<svg>X</svg>" });
    const results = searchIcons(db, "arrow*");
    expect(results[0]).toBeDefined();
    expect((results[0] as { svg?: string }).svg).toBeUndefined();
  });

  it("getIconSvg returns the stored svg", () => {
    upsertIcon(db, { name: "arrow-right", key: "k1", signal: "prefix", fileKey: "f1", svg: "<svg>X</svg>" });
    expect(getIconSvg(db, "arrow-right")).toBe("<svg>X</svg>");
  });

  it("getIconSvg returns null for missing icon", () => {
    expect(getIconSvg(db, "does-not-exist")).toBeNull();
  });

  it("getIconSvg returns null for icon with no svg payload", () => {
    upsertIcon(db, { name: "no-svg-icon", key: "k", signal: "page", fileKey: "f" });
    expect(getIconSvg(db, "no-svg-icon")).toBeNull();
  });

  it("preserves the signal column on round-trip", () => {
    upsertIcon(db, { name: "a-page-icon",   key: "k", signal: "page",   fileKey: "f" });
    upsertIcon(db, { name: "b-prefix-icon", key: "k", signal: "prefix", fileKey: "f" });
    upsertIcon(db, { name: "c-slash-icon",  key: "k", signal: "slash",  fileKey: "f" });
    const r = searchIcons(db, "icon");
    const byName = Object.fromEntries(r.map(x => [x.name, x.signal]));
    expect(byName["a-page-icon"]).toBe("page");
    expect(byName["b-prefix-icon"]).toBe("prefix");
    expect(byName["c-slash-icon"]).toBe("slash");
  });

  it("clearIcons removes all rows", () => {
    upsertIcon(db, { name: "x", key: "k", signal: "page", fileKey: "f" });
    clearIcons(db);
    expect(searchIcons(db, "x")).toEqual([]);
  });

  it("CamelCase token matching: 'arrow' finds 'ArrowRight'", () => {
    upsertIcon(db, { name: "ArrowRight", key: "k", signal: "page", fileKey: "f" });
    const results = searchIcons(db, "arrow");
    expect(results.some(r => r.name === "ArrowRight")).toBe(true);
  });
});
