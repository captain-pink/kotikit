import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { newScreenSpec } from "../../spec/schema.js";
import { formatMigrationDryRunReport, runMigrationDryRun } from "../dry-run.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-migrate-dry-run-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("runMigrationDryRun", () => {
  it("reports lazy upgrades without modifying older readable artifacts", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const spec = newScreenSpec({ title: "Members", description: "Manage members" });
    const { schemaVersion: _schemaVersion, ...legacySpec } = spec;
    const specPath = join(root, ".kotikit", "specs", "members", "spec.json");
    mkdirSync(join(root, ".kotikit", "specs", "members"), { recursive: true });
    writeFileSync(specPath, JSON.stringify(legacySpec, null, 2));
    const before = readFileSync(specPath, "utf-8");

    const report = await runMigrationDryRun(root);

    expect(report.ok).toBe(true);
    expect(report.wouldUpdate).toBe(1);
    expect(report.blocking).toBe(0);
    expect(readFileSync(specPath, "utf-8")).toBe(before);
  });
});

describe("formatMigrationDryRunReport", () => {
  it("prints counts, sample files, and a no-write guarantee", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const spec = newScreenSpec({ title: "Legacy", description: "Old shape" });
    const { schemaVersion: _schemaVersion, ...legacySpec } = spec;
    mkdirSync(join(root, ".kotikit", "specs", "legacy"), { recursive: true });
    writeFileSync(
      join(root, ".kotikit", "specs", "legacy", "spec.json"),
      JSON.stringify(legacySpec, null, 2)
    );

    const text = formatMigrationDryRunReport(await runMigrationDryRun(root));

    expect(text).toContain("kotikit migrate --dry-run: ok");
    expect(text).toContain("Checked: 2 kotikit JSON artifact(s)");
    expect(text).toContain("Would update lazily: 1 older readable file(s)");
    expect(text).toContain(".kotikit/specs/legacy/spec.json");
    expect(text).toContain("No files changed.");
  });
});
