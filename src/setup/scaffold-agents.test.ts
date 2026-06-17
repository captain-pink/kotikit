import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseAgentSelection, scaffoldAgents } from "./scaffold-agents";

let tmp: string;
let targetRoot: string;
let kotikitRoot: string;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function seedKotikitRoot(): void {
  mkdirSync(join(kotikitRoot, "src", "mcp"), { recursive: true });
  writeFileSync(join(kotikitRoot, "src", "mcp", "server.ts"), "export {};\n");
  mkdirSync(join(kotikitRoot, ".agents", "skills", "kotikit-auto"), { recursive: true });
  writeFileSync(
    join(kotikitRoot, ".agents", "skills", "kotikit-auto", "SKILL.md"),
    "# Kotikit Auto\n"
  );
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

  it("writes Claude MCP config while preserving existing servers", async () => {
    const claudeDir = join(targetRoot, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "mcp.json"),
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

    const config = readJson(join(targetRoot, ".claude", "mcp.json")) as {
      mcpServers: Record<string, { command: string; args: string[]; type?: string }>;
    };
    expect(config.mcpServers.browser.command).toBe("npx");
    expect(config.mcpServers.kotikit).toEqual({
      type: "stdio",
      command: "bun",
      args: ["run", join(kotikitRoot, "src", "mcp", "server.ts")],
    });
    expect(result.written).toContain(join(targetRoot, ".claude", "mcp.json"));
  });

  it("writes Codex config, installs the Codex skill, and creates a Figma token placeholder", async () => {
    const result = await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
    });

    const codexConfig = readFileSync(join(targetRoot, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("[mcp_servers.kotikit]");
    expect(codexConfig).toContain(`args = ["run", "${join(kotikitRoot, "src", "mcp", "server.ts")}"]`);
    expect(codexConfig).toContain(`cwd = "${targetRoot}"`);
    expect(readFileSync(join(targetRoot, ".agents", "skills", "kotikit-auto", "SKILL.md"), "utf8")).toBe(
      "# Kotikit Auto\n"
    );
    expect(readFileSync(join(targetRoot, ".env"), "utf8")).toBe("FIGMA_TOKEN=\n");
    expect(result.written).toContain(join(targetRoot, ".codex", "config.toml"));
  });

  it("replaces only the existing Codex kotikit block", async () => {
    mkdirSync(join(targetRoot, ".codex"), { recursive: true });
    writeFileSync(
      join(targetRoot, ".codex", "config.toml"),
      [
        "model = \"gpt-5\"",
        "",
        "[mcp_servers.other]",
        "command = \"node\"",
        "",
        "[mcp_servers.kotikit]",
        "command = \"old\"",
        "args = [\"old\"]",
        "",
        "[profiles.work]",
        "model = \"gpt-5-codex\"",
        "",
      ].join("\n")
    );

    await scaffoldAgents({
      targetRoot,
      kotikitRoot,
      agents: ["codex"],
    });

    const codexConfig = readFileSync(join(targetRoot, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("model = \"gpt-5\"");
    expect(codexConfig).toContain("[mcp_servers.other]");
    expect(codexConfig).toContain("[profiles.work]");
    expect(codexConfig).not.toContain("command = \"old\"");
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
        project: { framework: "react", codeComponentsDir: "src/components", tests: true },
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
