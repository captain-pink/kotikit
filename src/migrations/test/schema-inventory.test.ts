import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { inspectProjectSchemaVersions } from "../schema-inventory.js";

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
  it("checks active config and ignores retired spec files", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    mkdirSync(join(root, ".kotikit", "specs", "scope"), { recursive: true });
    writeFileSync(join(root, ".kotikit", "specs", "scope", "spec.json"), "{");
    writeFileSync(join(root, ".kotikit", "specs", "scope", "broken.spec.json"), "{");

    const inventory = await inspectProjectSchemaVersions(root);

    expect(inventory.checked).toBe(1);
    expect(inventory.current).toBe(1);
    expect(inventory.legacyOrOlder).toBe(0);
    expect(inventory.future).toBe(0);
    expect(inventory.unreadable).toBe(0);
    expect(inventory.findings).toContainEqual(
      expect.objectContaining({
        kind: "config",
        status: "current",
        latestVersion: 1,
      })
    );
  });
});
