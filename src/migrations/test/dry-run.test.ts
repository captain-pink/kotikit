import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
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
  it("leaves retired spec files untouched and outside migration counts", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const specPath = join(root, ".kotikit", "specs", "members", "spec.json");
    mkdirSync(join(root, ".kotikit", "specs", "members"), { recursive: true });
    writeFileSync(specPath, '{"title":"Members"}');
    const before = readFileSync(specPath, "utf-8");

    const report = await runMigrationDryRun(root);

    expect(report.ok).toBe(true);
    expect(report.wouldUpdate).toBe(0);
    expect(report.blocking).toBe(0);
    expect(report.inventory.checked).toBe(1);
    expect(readFileSync(specPath, "utf-8")).toBe(before);
  });
});

describe("formatMigrationDryRunReport", () => {
  it("reports only active config and a no-write guarantee", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    mkdirSync(join(root, ".kotikit", "specs", "legacy"), { recursive: true });
    writeFileSync(join(root, ".kotikit", "specs", "legacy", "spec.json"), "{");

    const text = formatMigrationDryRunReport(await runMigrationDryRun(root));

    expect(text).toContain("kotikit migrate --dry-run: ok");
    expect(text).toContain("Checked: 1 kotikit JSON artifact(s)");
    expect(text).toContain("Would update lazily: 0 older readable file(s)");
    expect(text).not.toContain(".kotikit/specs/legacy/spec.json");
    expect(text).toContain("No files changed.");
  });
});
