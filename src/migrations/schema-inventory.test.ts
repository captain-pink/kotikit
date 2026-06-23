import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeConfig } from "../config/load.js";
import { defaultConfig } from "../config/schema.js";
import {
  FLOW_MANIFEST_SCHEMA_VERSION,
  newFlowManifest,
  newScreenSpec,
  SCREEN_SPEC_SCHEMA_VERSION,
} from "../spec/schema.js";
import { inspectProjectSchemaVersions } from "./schema-inventory.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-schema-inventory-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("inspectProjectSchemaVersions", () => {
  it("returns per-file findings with artifact kind, status, and latest version", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());

    const legacySpec = newScreenSpec({ title: "Legacy", description: "old" });
    const { schemaVersion: _screenVersion, ...legacyShape } = legacySpec;
    const futureFlow = {
      ...newFlowManifest({
        title: "Future",
        description: "newer",
        screens: [{ id: "home", title: "Home", path: "home.spec.json" }],
      }),
      schemaVersion: 999,
    };

    mkdirSync(join(root, ".kotikit", "specs", "scope"), { recursive: true });
    writeFileSync(
      join(root, ".kotikit", "specs", "scope", "spec.json"),
      JSON.stringify(legacyShape)
    );
    writeFileSync(
      join(root, ".kotikit", "specs", "scope", "flow.json"),
      JSON.stringify(futureFlow)
    );
    writeFileSync(join(root, ".kotikit", "specs", "scope", "broken.spec.json"), "{");

    const inventory = await inspectProjectSchemaVersions(root);

    expect(inventory.checked).toBe(4);
    expect(inventory.current).toBe(1);
    expect(inventory.legacyOrOlder).toBe(1);
    expect(inventory.future).toBe(1);
    expect(inventory.unreadable).toBe(1);
    expect(inventory.findings).toContainEqual(
      expect.objectContaining({
        kind: "config",
        status: "current",
        latestVersion: 1,
      })
    );
    expect(inventory.findings).toContainEqual(
      expect.objectContaining({
        kind: "screen",
        status: "legacy-or-older",
        schemaVersion: null,
        latestVersion: SCREEN_SPEC_SCHEMA_VERSION,
        reason: "missing schemaVersion",
      })
    );
    expect(inventory.findings).toContainEqual(
      expect.objectContaining({
        kind: "flow",
        status: "future",
        schemaVersion: 999,
        latestVersion: FLOW_MANIFEST_SCHEMA_VERSION,
      })
    );
    expect(inventory.findings).toContainEqual(
      expect.objectContaining({
        kind: "screen",
        status: "unreadable",
        schemaVersion: null,
      })
    );
  });
});
