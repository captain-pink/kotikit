import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { scaffoldAgents } from "../scaffold-agents";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const packageJson = readJson(join(repoRoot, "package.json")) as { version: string };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function expectNoUserSpecificAbsolutePaths(value: unknown): void {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  expect(content).not.toContain("/Users/");
  expect(content).not.toContain("/home/");
  expect(content).not.toContain("C:\\Users\\");
}

describe("assistant plugin wrappers", () => {
  it("ships Codex and Claude manifests that use the shared kotikit MCP server", () => {
    const cases = [
      {
        pluginRoot: join(repoRoot, "plugins", "codex", "kotikit"),
        manifestPath: join(repoRoot, "plugins", "codex", "kotikit", ".codex-plugin", "plugin.json"),
        mcpPath: join(repoRoot, "plugins", "codex", "kotikit", ".mcp.json"),
        mcpRootKey: "mcpServers",
      },
      {
        pluginRoot: join(repoRoot, "plugins", "claude", "kotikit"),
        manifestPath: join(
          repoRoot,
          "plugins",
          "claude",
          "kotikit",
          ".claude-plugin",
          "plugin.json"
        ),
        mcpPath: join(repoRoot, "plugins", "claude", "kotikit", ".mcp.json"),
        mcpRootKey: "mcpServers",
      },
    ] as const;

    cases.forEach(({ pluginRoot, manifestPath, mcpPath, mcpRootKey }) => {
      const manifest = readJson(manifestPath) as {
        name: string;
        version: string;
        skills: string;
        mcpServers: string;
      };
      const mcpConfig = readJson(mcpPath) as Record<string, Record<string, unknown>>;
      const servers = mcpConfig[mcpRootKey] as Record<
        string,
        { command: string; args?: string[]; type?: string }
      >;

      expect(manifest.name).toBe("kotikit");
      expect(basename(pluginRoot)).toBe(manifest.name);
      expect(manifest.version).toBe(packageJson.version);
      expect(manifest.skills).toBe("./skills/");
      expect(manifest.mcpServers).toBe("./.mcp.json");
      expect(servers.kotikit.command).toBe("kotikit-mcp");
      expect(servers.kotikit.type ?? "stdio").toBe("stdio");
      expect(servers.kotikit.args ?? []).toEqual([]);
      expectNoUserSpecificAbsolutePaths(manifest);
      expectNoUserSpecificAbsolutePaths(mcpConfig);
    });
  });

  it("ships designer-facing plugin launch skills", () => {
    const codexSkill = readText(
      join(repoRoot, "plugins", "codex", "kotikit", "skills", "kotikit", "SKILL.md")
    );
    const claudeSkill = readText(
      join(repoRoot, "plugins", "claude", "kotikit", "skills", "kotikit", "SKILL.md")
    );

    [codexSkill, claudeSkill].forEach((skill) => {
      expect(skill).toContain("designer-first");
      expect(skill).toContain("kotikit_config_status");
      expect(skill).toContain("kotikit:auto");
      expect(skill).toContain("Create the Figma design");
      expect(skill).toContain("kotikit_get_artifact");
      expect(skill).not.toContain("kotikit_artifact_get");
      expect(skill).not.toContain("Generate code");
      expect(skill).not.toContain("target React project");
      expectNoUserSpecificAbsolutePaths(skill);
    });
  });

  it("documents plugins as the preferred setup while keeping scaffold available", () => {
    const docs = readText(join(repoRoot, "docs", "getting-started.md"));
    const pluginReadme = readText(join(repoRoot, "plugins", "README.md"));
    const packageScripts = readJson(join(repoRoot, "package.json")) as {
      scripts: Record<string, string>;
    };

    expect(docs).toContain("Install The Assistant Plugin Wrapper");
    expect(docs).toContain("Use `bun run scaffold:agents` for local development");
    expect(docs).toContain("Figma personal access token is not required for draft creation");
    expect(pluginReadme).toContain("plugins/codex");
    expect(pluginReadme).toContain("plugins/claude");
    expect(pluginReadme).toContain("kotikit-mcp");
    expect(pluginReadme).toContain("PATH");
    expect(packageScripts.scripts["scaffold:agents"]).toBe("bun run scripts/scaffold-agents.ts");
  });
});

describe("source scaffold compatibility", () => {
  let tmp: string;
  let targetRoot: string;
  let kotikitRoot: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `kotikit-plugin-manifests-test-${Date.now()}-${Math.random()}`);
    targetRoot = join(tmp, "target");
    kotikitRoot = join(tmp, "kotikit");
    mkdirSync(join(kotikitRoot, "src", "mcp"), { recursive: true });
    writeFileSync(join(kotikitRoot, "src", "mcp", "server.ts"), "export {};\n");
    mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps the source installer available for manual MCP setup", async () => {
    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
      installSkills: false,
      ensureEnv: false,
    });

    const config = readText(join(targetRoot, ".codex", "config.toml"));
    expect(config).toContain("[mcp_servers.kotikit]");
    expect(config).toContain(join(kotikitRoot, "src", "mcp", "server.ts"));
    expect(result.notes.join("\n")).toContain("Plugin wrappers are preferred");
  });
});
