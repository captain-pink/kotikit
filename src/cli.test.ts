import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeConfig } from "./config/load.js";
import { defaultConfig } from "./config/schema.js";
import { newScreenSpec } from "./spec/schema.js";

const tmpDirs: string[] = [];
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, "src", "cli.ts");

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-cli-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const runCli = async (
  cwd: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

describe("kotikit CLI", () => {
  it("supports kotikit migrate --dry-run", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const spec = newScreenSpec({ title: "Legacy", description: "Old shape" });
    const { schemaVersion: _schemaVersion, ...legacySpec } = spec;
    mkdirSync(join(root, ".kotikit", "specs", "legacy"), { recursive: true });
    writeFileSync(
      join(root, ".kotikit", "specs", "legacy", "spec.json"),
      JSON.stringify(legacySpec, null, 2)
    );

    const result = await runCli(root, ["migrate", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("kotikit migrate --dry-run: ok");
    expect(result.stdout).toContain("No files changed.");
    expect(result.stderr).toBe("");
  });

  it("rejects migrate without --dry-run because writes stay lazy", async () => {
    const root = mkTmp();

    const result = await runCli(root, ["migrate"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: kotikit migrate --dry-run");
  });
});
