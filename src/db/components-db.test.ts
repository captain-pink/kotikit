import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initComponentsDb,
  clearComponents,
  deleteComponentsByFileKey,
  upsertComponent,
  searchComponents,
} from "./components-db.js";

describe("components-db", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initComponentsDb(db);
  });

  it("inits the FTS5 table", () => {
    const rows = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='components'"
    ).all();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("upserts and finds by exact name", () => {
    upsertComponent(db, {
      name: "Button",
      path: "components/button.json",
      key: "k1",
      fileKey: "f1",
      props: "Variant Size",
    });
    const results = searchComponents(db, "Button");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Button");
    expect(results[0]?.path).toBe("components/button.json");
    expect(results[0]?.key).toBe("k1");
    expect(results[0]?.fileKey).toBe("f1");
  });

  it("matches CamelCase tokens: searching 'arrow' finds IconArrowLeft", () => {
    upsertComponent(db, {
      name: "IconArrowLeft",
      path: "components/icon-arrow-left.json",
      key: "k2",
      fileKey: "f1",
      props: "",
    });
    const results = searchComponents(db, "arrow");
    expect(results.some(r => r.name === "IconArrowLeft")).toBe(true);
  });

  it("supports prefix matching with 'but*'", () => {
    upsertComponent(db, { name: "Button", path: "components/button.json", key: "k1", fileKey: "f1", props: "" });
    upsertComponent(db, { name: "Buttonish", path: "components/buttonish.json", key: "k2", fileKey: "f1", props: "" });
    upsertComponent(db, { name: "Card", path: "components/card.json", key: "k3", fileKey: "f1", props: "" });
    const results = searchComponents(db, "but*");
    expect(results.map(r => r.name).sort()).toEqual(["Button", "Buttonish"]);
  });

  it("upserts by name: second upsert with same name replaces the row", () => {
    upsertComponent(db, { name: "Button", path: "p1", key: "k1", fileKey: "f1", props: "" });
    upsertComponent(db, { name: "Button", path: "p2", key: "k2", fileKey: "f2", props: "" });
    const results = searchComponents(db, "Button");
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe("p2");
    expect(results[0]?.key).toBe("k2");
    expect(results[0]?.fileKey).toBe("f2");
  });

  it("clearComponents removes all rows", () => {
    upsertComponent(db, { name: "Button", path: "p", key: "k", fileKey: "f", props: "" });
    clearComponents(db);
    expect(searchComponents(db, "Button")).toEqual([]);
  });

  it("deleteComponentsByFileKey removes only rows from that source file", () => {
    upsertComponent(db, { name: "Button", path: "p1", key: "k1", fileKey: "f1", props: "" });
    upsertComponent(db, { name: "Card", path: "p2", key: "k2", fileKey: "f2", props: "" });

    deleteComponentsByFileKey(db, "f1");

    expect(searchComponents(db, "Button")).toEqual([]);
    expect(searchComponents(db, "Card").map(r => r.name)).toEqual(["Card"]);
  });

  it("respects the limit argument", () => {
    for (let i = 0; i < 10; i++) {
      upsertComponent(db, {
        name: `Component${i}`, path: `p${i}`, key: `k${i}`, fileKey: "f", props: "",
      });
    }
    const results = searchComponents(db, "component*", 3);
    expect(results).toHaveLength(3);
  });
});
