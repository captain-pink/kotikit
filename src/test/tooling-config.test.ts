import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
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

describe("token measurement tooling", () => {
  it("does not measure removed public choreography tools", () => {
    const script = readText(join(repoRoot, "scripts", "measure-tokens.ts"));
    const removedToolFragments = [
      "kotikit_workflow_",
      "kotikit_brainstorm_",
      "kotikit_spec_",
      "kotikit_flow_create",
      "kotikit_component_plan_create",
      "kotikit_figma_target_bind",
      "kotikit_plan_design",
      "kotikit_design_get_screen",
      "kotikit_design_apply_step",
      "kotikit_design_review_",
      "kotikit_design_comment_",
      "kotikit_design_memory_",
    ];

    for (const fragment of removedToolFragments) {
      expect(script).not.toContain(fragment);
    }
  });
});

describe("live documentation", () => {
  const liveDocPaths = [
    "README.md",
    "docs/architecture.md",
    "docs/development.md",
    "docs/figma.md",
    "docs/getting-started.md",
    "docs/tools.md",
    "docs/troubleshooting.md",
    "docs/workflows.md",
    ".agents/skills/kotikit-auto/SKILL.md",
    "plugins/README.md",
    ...readdirSync(join(repoRoot, "docs", "modules"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/modules/${name}`),
  ];

  const liveDocs = (): string =>
    liveDocPaths.map((path) => readText(join(repoRoot, path))).join("\n\n");

  it("describes the graph facade instead of removed choreography tools", () => {
    const docs = liveDocs();
    const removedToolFragments = [
      "kotikit_workflow_",
      "kotikit_brainstorm_",
      "kotikit_spec_",
      "kotikit_flow_create",
      "kotikit_component_plan_create",
      "kotikit_figma_target_bind",
      "kotikit_plan_design",
      "kotikit_design_get_screen",
      "kotikit_design_apply_step",
      "kotikit_design_review_start",
      "kotikit_design_review_comments",
    ];
    const removedWorkflowPhrases = [
      "workflow controller",
      "workflow pointer",
      "next allowed step",
      "What next? menu",
    ];

    for (const fragment of [...removedToolFragments, ...removedWorkflowPhrases]) {
      expect(docs).not.toContain(fragment);
    }

    expect(docs).toContain("kotikit_start");
    expect(docs).toContain("kotikit_answer");
    expect(docs).toContain("kotikit_get_artifact");
  });

  it("keeps setup and Figma guidance designer-first", () => {
    const docs = liveDocs();

    expect(docs).toContain("plugins are preferred");
    expect(docs).toContain("scaffold remains");
    expect(docs).toContain("not required for draft creation");
    expect(docs).toContain("primary token-efficient grounding");
    expect(docs).toContain("Design-to-code is removed from the core workflow");
  });

  it("documents incremental Figma apply instead of one-shot state dumping", () => {
    const docs = [
      readText(join(repoRoot, "README.md")),
      readText(join(repoRoot, "docs", "workflows.md")),
      readText(join(repoRoot, "docs", "figma.md")),
      readText(join(repoRoot, ".agents", "skills", "kotikit-auto", "SKILL.md")),
    ].join("\n");

    expect(docs).toContain("incremental Figma");
    expect(docs).toContain("one screen state at a time");
    expect(docs).toContain("canvas plan");
    expect(docs).not.toContain("dump all states");
  });
});

describe("git hook tooling config", () => {
  it("runs staged-file checks and typecheck before commits", () => {
    const preCommit = readText(join(repoRoot, ".husky", "pre-commit"));

    expect(preCommit).toContain("bun run lint:staged");
    expect(preCommit).toContain("bun run typecheck");
  });
});
