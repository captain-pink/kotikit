import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const readText = (path: string): string => readFileSync(path, "utf-8");

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface KnipConfig {
  $schema?: string;
  ignoreBinaries?: string[];
  workspaces?: Record<
    string,
    {
      entry?: string[];
      project?: string[];
    }
  >;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T;

describe("dead-code tooling config", () => {
  it("wires Knip as an explicit analysis and cleanup workflow", () => {
    const pkg = readJson<PackageJson>(join(repoRoot, "package.json"));
    const knip = readJson<KnipConfig>(join(repoRoot, "knip.json"));

    expect(pkg.devDependencies?.knip).toBeString();
    expect(pkg.scripts).toMatchObject({
      "check:unused": "knip",
      "fix:unused": "knip --fix --format",
      "fix:unused:files": "knip --fix --allow-remove-files --format",
    });

    expect(knip.$schema).toBe("https://unpkg.com/knip@6/schema.json");
    expect(knip.ignoreBinaries).toEqual(expect.arrayContaining(["show"]));
    expect(knip.workspaces?.["."]?.entry).toEqual(
      expect.arrayContaining([
        "index.ts",
        "scripts/*.ts",
        "src/**/test/**/*.test.ts",
        "test/**/*.test.ts",
      ])
    );
    expect(knip.workspaces?.["."]?.project).toEqual(
      expect.arrayContaining(["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"])
    );
    expect(knip.workspaces?.["figma-plugin"]?.entry).toEqual(
      expect.arrayContaining([
        "code.ts",
        "ui/index.html",
        "src/test/**/*.test.ts",
        "ui/test/**/*.test.ts",
      ])
    );
    expect(knip.workspaces?.["figma-plugin"]?.project).toEqual(
      expect.arrayContaining(["**/*.{ts,tsx}"])
    );
  });
});

describe("git hook tooling config", () => {
  it("runs staged-file checks and typecheck before commits", () => {
    const preCommit = readText(join(repoRoot, ".husky", "pre-commit"));

    expect(preCommit).toContain("bun run lint:staged");
    expect(preCommit).toContain("bun run typecheck");
  });
});
