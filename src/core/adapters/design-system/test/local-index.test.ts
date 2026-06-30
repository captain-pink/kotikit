import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initComponentsDb, upsertComponent } from "../../../../db/components-db.js";
import { initIconsDb, upsertIcon } from "../../../../db/icons-db.js";
import { openDb } from "../../../../db/sqlite.js";
import { nowIso } from "../../../../util/ids.js";
import {
  componentJsonPath,
  componentsDbPath,
  iconsDbPath,
  variablesJsonPath,
} from "../../../../util/paths.js";
import {
  buildLocalDesignSystemContext,
  getLocalComponent,
  getLocalVariables,
  searchLocalComponents,
  searchLocalIcons,
} from "../local-index.js";

const tmpDirs: string[] = [];

afterAll(() => {
  tmpDirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("local design-system adapter", () => {
  it("returns compact component refs from the local SQLite cache", () => {
    const root = mkProject();
    seedComponents(root, [
      {
        name: "Button",
        key: "button-key",
        fileKey: "file-a",
        props: "Variant Size State",
      },
    ]);

    const result = searchLocalComponents(root, "button", { limit: 10 });

    expect(result).toMatchObject({
      status: "ready",
      source: "local-cache",
      results: [{ name: "Button", path: "components/button.json", key: "button-key" }],
    });
    expect(result.results[0]).not.toHaveProperty("variants");
    expect(result.results[0]).not.toHaveProperty("properties");
  });

  it("reads one component JSON only when the caller asks for it", () => {
    const root = mkProject();
    seedComponents(root, [
      {
        name: "Data Table",
        key: "table-key",
        fileKey: "file-a",
        props: "Density Sortable",
      },
    ]);

    const component = getLocalComponent(root, "components/data-table.json");

    expect(component).toMatchObject({
      name: "Data Table",
      key: "table-key",
      properties: { Density: { type: "VARIANT" } },
    });
  });

  it("omits icon SVG payloads unless explicitly requested", () => {
    const root = mkProject();
    seedIcons(root, [
      {
        name: "arrow-right",
        key: "icon-key",
        svg: "<svg><path d='M0 0h10v10H0z'/></svg>",
      },
    ]);

    const compact = searchLocalIcons(root, "arrow*", { limit: 5 });
    const expanded = searchLocalIcons(root, "arrow*", { limit: 5, includeSvg: true });

    expect(compact.results[0]).toEqual({
      name: "arrow-right",
      key: "icon-key",
      signal: "prefix",
      fileKey: "file-icons",
    });
    expect(compact.results[0]).not.toHaveProperty("svg");
    expect(expanded.results[0]).toHaveProperty("svg", "<svg><path d='M0 0h10v10H0z'/></svg>");
  });

  it("returns a friendly setup action when the local cache is missing", () => {
    const result = searchLocalComponents(mkProject(), "button");

    expect(result).toEqual({
      status: "needs-sync",
      source: "local-cache",
      results: [],
      setupAction: {
        message: "Your design system has not been synced yet.",
        tool: "kotikit_sync_ds",
        hint: "Sync the Figma design-system file to create design-system/components.db.",
      },
    });
  });

  it("loads local variables and compact cache context", () => {
    const root = mkProject();
    seedComponents(root, [{ name: "Button", key: "button-key", fileKey: "file-a", props: "" }]);
    seedIcons(root, [{ name: "search", key: "search-key" }]);
    writeVariables(root);

    const variables = getLocalVariables(root, { kind: "color" });
    const context = buildLocalDesignSystemContext(root);

    expect(variables).toMatchObject({
      status: "ready",
      entries: [{ name: "Color/Primary", kind: "color", source: "variable" }],
    });
    expect(context).toMatchObject({
      status: "ready",
      componentsAvailable: true,
      iconsAvailable: true,
      variablesAvailable: true,
    });
  });
});

function mkProject(): string {
  const root = mkdtempSync(join(tmpdir(), "kotikit-local-ds-"));
  tmpDirs.push(root);
  return root;
}

function seedComponents(
  root: string,
  components: { name: string; key: string; fileKey: string; props: string }[]
): void {
  const db = openDb(componentsDbPath(root));
  initComponentsDb(db);
  components.forEach((component) => {
    const slug = component.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    upsertComponent(db, {
      name: component.name,
      path: `components/${slug}.json`,
      key: component.key,
      fileKey: component.fileKey,
      props: component.props,
    });
    const path = componentJsonPath(root, slug);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          name: component.name,
          key: component.key,
          fileKey: component.fileKey,
          path: `components/${slug}.json`,
          variants: [{ propertyName: "State", values: ["Default"] }],
          properties: { Density: { type: "VARIANT" } },
          updatedAt: nowIso(),
        },
        null,
        2
      )
    );
  });
  db.close();
}

function seedIcons(root: string, icons: { name: string; key: string; svg?: string }[]): void {
  const db = openDb(iconsDbPath(root));
  initIconsDb(db);
  icons.forEach((icon) => {
    upsertIcon(db, {
      name: icon.name,
      key: icon.key,
      signal: "prefix",
      fileKey: "file-icons",
      svg: icon.svg,
    });
  });
  db.close();
}

function writeVariables(root: string): void {
  const path = variablesJsonPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "var-color-primary",
          name: "Color/Primary",
          kind: "color",
          source: "variable",
          value: "#0055ff",
        },
        {
          id: "var-space-200",
          name: "Space/200",
          kind: "spacing",
          source: "variable",
          value: 8,
        },
      ],
      collisions: [],
    })
  );
}
