import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentSelection, scaffoldAgents } from "../scaffold-agents";

let tmp: string;
let targetRoot: string;
let kotikitRoot: string;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function currentKotikitSkill(name: string = "kotikit-auto"): string {
  return readFileSync(
    join(import.meta.dir, "..", "..", "..", ".agents", "skills", name, "SKILL.md"),
    "utf8"
  );
}

function seedKotikitRoot(): void {
  mkdirSync(join(kotikitRoot, "src", "mcp"), { recursive: true });
  writeFileSync(join(kotikitRoot, "src", "mcp", "server.ts"), "export {};\n");
  ["kotikit-auto", "kotikit-design-review"].forEach((name) => {
    mkdirSync(join(kotikitRoot, ".agents", "skills", name), { recursive: true });
    writeFileSync(
      join(kotikitRoot, ".agents", "skills", name, "SKILL.md"),
      currentKotikitSkill(name)
    );
  });
}

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-scaffold-agents-test-${Date.now()}-${Math.random()}`);
  targetRoot = join(tmp, "target");
  kotikitRoot = join(tmp, "kotikit");
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(kotikitRoot, { recursive: true });
  seedKotikitRoot();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("scaffoldAgents", () => {
  it("parses agent selections", () => {
    expect(parseAgentSelection(undefined)).toEqual(["claude", "codex"]);
    expect(parseAgentSelection("both")).toEqual(["claude", "codex"]);
    expect(parseAgentSelection("codex")).toEqual(["codex"]);
    expect(parseAgentSelection("claude,codex")).toEqual(["claude", "codex"]);
  });

  it("rejects invalid agent selections", () => {
    expect(() => parseAgentSelection("cursor")).toThrow("agents must be one of");
  });

  it("ships a portable self-contained kotikit-auto skill", () => {
    const skill = currentKotikitSkill();
    expect(skill).toContain("This skill assumes the kotikit MCP server is configured");
    expect(skill).toContain("kotikit_config_status");
    expect(skill).toContain("kotikit_config_init");
    expect(skill).toContain("kotikit_start");
    expect(skill).toContain("kotikit_answer");
    expect(skill).toContain("kotikit_get_artifact");
    expect(skill).toContain("Claude Code");
    expect(skill).toContain("Codex");
    expect(skill).toContain("Do not generate code or scaffold code components");
    expect(skill).toContain("Design-to-code is not part");
    expect(skill).toContain("create or refine the Figma design");
    expect(skill).toContain("target workspace");
    expect(skill).not.toContain("target React project");
    expect(skill).not.toContain("their-react-project");
    expect(skill).not.toContain("Framework. Default to React");
    expect(skill).not.toContain("Generate code");
    expect(skill).not.toContain("kotikit_workflow_");
    expect(skill).not.toContain("kotikit_brainstorm_");
    expect(skill).not.toContain("kotikit_spec_");
    expect(skill).not.toContain("../../../docs");
    expect(skill).not.toContain("docs/agent_workflow");
  });

  it("ships a portable focused kotikit design-review skill", () => {
    const skill = currentKotikitSkill("kotikit-design-review");
    expect(skill).toContain("kotikit_review_figma_target");
    expect(skill).toContain("kotikit_get_artifact");
    expect(skill).toContain("explicit designer approval");
    expect(skill).toContain("Design Director");
    expect(skill).not.toContain("kotikit_workflow_");
    expect(skill).not.toContain("kotikit_design_review_start");
    expect(skill).not.toContain("../../../docs");
  });

  it("writes Claude project MCP config while preserving existing servers", async () => {
    writeFileSync(
      join(targetRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          browser: { command: "npx", args: ["browser-mcp"] },
        },
      })
    );

    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["claude"],
    });

    const config = readJson(join(targetRoot, ".mcp.json")) as {
      mcpServers: Record<
        string,
        { command: string; args: string[]; type?: string; timeout?: number }
      >;
    };
    const installedSkill = readFileSync(
      join(targetRoot, ".claude", "skills", "kotikit-auto", "SKILL.md"),
      "utf8"
    );
    const installedReviewSkill = readFileSync(
      join(targetRoot, ".claude", "skills", "kotikit-design-review", "SKILL.md"),
      "utf8"
    );
    const autoCommand = readFileSync(
      join(targetRoot, ".claude", "commands", "kotikit-auto.md"),
      "utf8"
    );
    const reviewCommand = readFileSync(
      join(targetRoot, ".claude", "commands", "kotikit-design-review.md"),
      "utf8"
    );
    expect(config.mcpServers.browser.command).toBe("npx");
    expect(config.mcpServers.kotikit).toEqual({
      type: "stdio",
      command: "bun",
      args: ["run", join(kotikitRoot, "src", "mcp", "server.ts")],
      timeout: 900000,
    });
    expect(installedSkill).toBe(currentKotikitSkill());
    expect(installedReviewSkill).toBe(currentKotikitSkill("kotikit-design-review"));
    expect(installedSkill).toContain("Use this self-contained skill");
    expect(autoCommand).toContain(".claude/skills/kotikit-auto/SKILL.md");
    expect(autoCommand).toContain("kotikit-auto");
    expect(reviewCommand).toContain(".claude/skills/kotikit-design-review/SKILL.md");
    expect(reviewCommand).toContain("kotikit-design-review");
    expect(result.written).toContain(join(targetRoot, ".mcp.json"));
    expect(result.written).toContain(
      join(targetRoot, ".claude", "skills", "kotikit-auto", "SKILL.md")
    );
    expect(result.written).toContain(
      join(targetRoot, ".claude", "skills", "kotikit-design-review", "SKILL.md")
    );
    expect(result.written).toContain(join(targetRoot, ".claude", "commands", "kotikit-auto.md"));
    expect(result.written).toContain(
      join(targetRoot, ".claude", "commands", "kotikit-design-review.md")
    );
    expect(result.notes.join("\n")).toContain("Claude Code project MCP config");
  });

  it("preserves existing Claude command files with local changes", async () => {
    const commandPath = join(targetRoot, ".claude", "commands", "kotikit-auto.md");
    const localCommand = "Local command instructions.\n";
    mkdirSync(join(targetRoot, ".claude", "commands"), { recursive: true });
    writeFileSync(commandPath, localCommand);

    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["claude"],
    });

    expect(readFileSync(commandPath, "utf8")).toBe(localCommand);
    expect(result.skipped).toContain(commandPath);
    expect(result.notes.join("\n")).toContain(
      "Skipped existing Claude Code command with local changes"
    );
  });

  it("leaves legacy .claude/mcp.json untouched and notes the current Claude path", async () => {
    const legacyPath = join(targetRoot, ".claude", "mcp.json");
    mkdirSync(join(targetRoot, ".claude"), { recursive: true });
    writeFileSync(legacyPath, '{"mcpServers":{"old":{"command":"node"}}}\n');

    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["claude"],
    });

    expect(readFileSync(legacyPath, "utf8")).toBe('{"mcpServers":{"old":{"command":"node"}}}\n');
    expect(readFileSync(join(targetRoot, ".mcp.json"), "utf8")).toContain('"kotikit"');
    expect(result.notes.join("\n")).toContain("legacy Claude config");
  });

  it("replaces an outdated scaffolded Claude skill that points at missing docs", async () => {
    const skillPath = join(targetRoot, ".claude", "skills", "kotikit-auto", "SKILL.md");
    mkdirSync(join(targetRoot, ".claude", "skills", "kotikit-auto"), { recursive: true });
    writeFileSync(skillPath, "Before acting, read `docs/agent_workflow.md` when available.\n");

    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["claude"],
    });

    const installedSkill = readFileSync(skillPath, "utf8");
    expect(installedSkill).toBe(currentKotikitSkill());
    expect(installedSkill).not.toContain("docs/agent_workflow");
    expect(result.written).toContain(skillPath);
    expect(result.notes.join("\n")).toContain("Replaced outdated Claude Code skill");
  });

  it("preserves an existing Claude skill with local changes", async () => {
    const skillPath = join(targetRoot, ".claude", "skills", "kotikit-auto", "SKILL.md");
    const localSkill = "Local project-specific kotikit workflow.\n";
    mkdirSync(join(targetRoot, ".claude", "skills", "kotikit-auto"), { recursive: true });
    writeFileSync(skillPath, localSkill);

    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["claude"],
    });

    expect(readFileSync(skillPath, "utf8")).toBe(localSkill);
    expect(result.skipped).toContain(skillPath);
    expect(result.notes.join("\n")).toContain(
      "Skipped existing Claude Code skill with local changes"
    );
  });

  it("writes Codex config, installs the Codex skill, and creates a Figma token placeholder", async () => {
    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
    });

    const codexConfig = readFileSync(join(targetRoot, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("[mcp_servers.kotikit]");
    expect(codexConfig).toContain(
      `args = ["run", "${join(kotikitRoot, "src", "mcp", "server.ts")}"]`
    );
    expect(codexConfig).toContain(`cwd = "${targetRoot}"`);
    expect(codexConfig).toContain("tool_timeout_sec = 900");
    const installedSkill = readFileSync(
      join(targetRoot, ".agents", "skills", "kotikit-auto", "SKILL.md"),
      "utf8"
    );
    const installedReviewSkill = readFileSync(
      join(targetRoot, ".agents", "skills", "kotikit-design-review", "SKILL.md"),
      "utf8"
    );
    expect(installedSkill).toBe(currentKotikitSkill());
    expect(installedReviewSkill).toBe(currentKotikitSkill("kotikit-design-review"));
    expect(installedSkill).not.toContain("../../../docs");
    expect(readFileSync(join(targetRoot, ".env"), "utf8")).toBe("FIGMA_TOKEN=\n");
    expect(result.written).toContain(join(targetRoot, ".codex", "config.toml"));
  });

  it("replaces an outdated scaffolded Codex skill that points at missing docs", async () => {
    const skillPath = join(targetRoot, ".agents", "skills", "kotikit-auto", "SKILL.md");
    mkdirSync(join(targetRoot, ".agents", "skills", "kotikit-auto"), { recursive: true });
    writeFileSync(
      skillPath,
      "Before acting, read `../../../docs/agent_workflow.md` when available.\n"
    );

    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
    });

    const installedSkill = readFileSync(skillPath, "utf8");
    expect(installedSkill).toBe(currentKotikitSkill());
    expect(installedSkill).not.toContain("../../../docs");
    expect(result.written).toContain(skillPath);
    expect(result.notes.join("\n")).toContain("Replaced outdated Codex skill");
  });

  it("replaces only the existing Codex kotikit block", async () => {
    mkdirSync(join(targetRoot, ".codex"), { recursive: true });
    writeFileSync(
      join(targetRoot, ".codex", "config.toml"),
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.other]",
        'command = "node"',
        "",
        "[mcp_servers.kotikit]",
        'command = "old"',
        'args = ["old"]',
        "tool_timeout_sec = 120",
        "",
        "[profiles.work]",
        'model = "gpt-5-codex"',
        "",
      ].join("\n")
    );

    await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
    });

    const codexConfig = readFileSync(join(targetRoot, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain('model = "gpt-5"');
    expect(codexConfig).toContain("[mcp_servers.other]");
    expect(codexConfig).toContain("[profiles.work]");
    expect(codexConfig).not.toContain('command = "old"');
    expect(codexConfig).not.toContain("tool_timeout_sec = 120");
    expect(codexConfig).toContain("tool_timeout_sec = 900");
    expect(codexConfig).toContain(`cwd = "${targetRoot}"`);
  });

  it("appends FIGMA_TOKEN to an existing .env without exposing or replacing existing values", async () => {
    writeFileSync(join(targetRoot, ".env"), "APP_ENV=local\n");

    await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["claude"],
    });

    expect(readFileSync(join(targetRoot, ".env"), "utf8")).toBe("APP_ENV=local\nFIGMA_TOKEN=\n");
  });

  it("updates an existing kotikit config with Codex co-author when requested", async () => {
    mkdirSync(join(targetRoot, ".kotikit"), { recursive: true });
    writeFileSync(
      join(targetRoot, ".kotikit", "config.json"),
      JSON.stringify({
        defaults: { breakpoints: [375], themes: ["light"] },
        git: { autoCommit: true },
      })
    );

    await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
      coAuthorMode: "codex",
    });

    const config = readJson(join(targetRoot, ".kotikit", "config.json")) as {
      git: { coAuthor: { name: string; email: string } };
    };
    expect(config.git.coAuthor).toEqual({
      name: "Codex",
      email: "noreply@openai.com",
    });
  });
});
