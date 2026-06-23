import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type AgentKind = "claude" | "codex";
export type CoAuthorMode = "auto" | "none" | "claude" | "codex";

export interface ScaffoldAgentsOptions {
  targetRoot: string;
  kotikitRoot: string;
  agents?: readonly AgentKind[];
  coAuthorMode?: CoAuthorMode;
  ensureEnv?: boolean;
  installSkills?: boolean;
  /** @deprecated Use installSkills. Kept for existing scaffold callers. */
  installCodexSkill?: boolean;
}

export interface ScaffoldAgentsResult {
  written: string[];
  skipped: string[];
  notes: string[];
}

interface CoAuthor {
  name: string;
  email: string;
}

const CLAUDE_CO_AUTHOR: CoAuthor = {
  name: "Claude Code",
  email: "noreply@anthropic.com",
};

const CODEX_CO_AUTHOR: CoAuthor = {
  name: "Codex",
  email: "noreply@openai.com",
};

const CODEX_STARTUP_TIMEOUT_SEC = 20;
const CODEX_TOOL_TIMEOUT_SEC = 900;
const CLAUDE_TOOL_TIMEOUT_MS = 900_000;

function isNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content);
  await rename(tmpPath, path);
}

async function assertReadableFile(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error(`${label} is not a file: ${path}`);
    }
  } catch (err) {
    if (isNotFound(err)) {
      throw new Error(`${label} does not exist: ${path}`);
    }
    throw err;
  }
}

function uniqueAgents(agents: readonly AgentKind[] | undefined): AgentKind[] {
  const requested = agents ?? ["claude", "codex"];
  return requested.filter((agent, index) => requested.indexOf(agent) === index);
}

export function parseAgentSelection(value: string | undefined): AgentKind[] {
  if (value === undefined || value === "both") return ["claude", "codex"];
  const agents = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const invalid = agents.filter((agent) => agent !== "claude" && agent !== "codex");
  if (invalid.length > 0 || agents.length === 0) {
    throw new Error("agents must be one of: claude, codex, both, claude,codex");
  }
  return uniqueAgents(agents as AgentKind[]);
}

function coAuthorForMode(mode: CoAuthorMode, agents: readonly AgentKind[]): CoAuthor | null {
  if (mode === "none") return null;
  if (mode === "claude") return CLAUDE_CO_AUTHOR;
  if (mode === "codex") return CODEX_CO_AUTHOR;
  if (agents.length === 1 && agents[0] === "codex") return CODEX_CO_AUTHOR;
  return null;
}

function serverPath(kotikitRoot: string): string {
  return join(kotikitRoot, "src", "mcp", "server.ts");
}

function buildClaudeConfig(existing: string | null, kotikitRoot: string): string {
  const parsed = existing === null ? {} : JSON.parse(existing);
  const root =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  const mcpServers =
    "mcpServers" in root && typeof root.mcpServers === "object" && root.mcpServers !== null
      ? root.mcpServers
      : {};
  return `${JSON.stringify(
    {
      ...root,
      mcpServers: {
        ...mcpServers,
        kotikit: {
          type: "stdio",
          command: "bun",
          args: ["run", serverPath(kotikitRoot)],
          timeout: CLAUDE_TOOL_TIMEOUT_MS,
        },
      },
    },
    null,
    2
  )}\n`;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildCodexBlock(kotikitRoot: string, targetRoot: string): string {
  return [
    "[mcp_servers.kotikit]",
    'command = "bun"',
    `args = ["run", ${tomlString(serverPath(kotikitRoot))}]`,
    `cwd = ${tomlString(targetRoot)}`,
    `startup_timeout_sec = ${CODEX_STARTUP_TIMEOUT_SEC}`,
    `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}`,
  ].join("\n");
}

function isTomlSection(line: string): boolean {
  return /^\s*\[[^\]]+\]\s*$/.test(line);
}

export function upsertCodexConfig(
  existing: string | null,
  kotikitRoot: string,
  targetRoot: string
): string {
  const block = buildCodexBlock(kotikitRoot, targetRoot);
  if (existing === null || existing.trim().length === 0) return `${block}\n`;

  const lines = existing.replace(/\s+$/, "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "[mcp_servers.kotikit]");
  if (start === -1) return `${lines.join("\n")}\n\n${block}\n`;

  const nextSectionOffset = lines.slice(start + 1).findIndex(isTomlSection);
  const end = nextSectionOffset === -1 ? lines.length : start + 1 + nextSectionOffset;
  return `${[...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)].join("\n")}\n`;
}

function envWithFigmaToken(existing: string | null): string | null {
  if (existing === null) return "FIGMA_TOKEN=\n";
  if (/^\s*(?:export\s+)?FIGMA_TOKEN\s*=/m.test(existing)) return null;
  const separator = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}FIGMA_TOKEN=\n`;
}

function configWithCoAuthor(existing: string, coAuthor: CoAuthor): string {
  const parsed = JSON.parse(existing);
  const root =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  const git = "git" in root && typeof root.git === "object" && root.git !== null ? root.git : {};
  return `${JSON.stringify(
    {
      ...root,
      git: {
        ...git,
        coAuthor,
      },
    },
    null,
    2
  )}\n`;
}

async function writeClaudeConfig(
  result: ScaffoldAgentsResult,
  targetRoot: string,
  kotikitRoot: string
): Promise<void> {
  const path = join(targetRoot, ".mcp.json");
  await writeTextAtomic(path, buildClaudeConfig(await readTextIfExists(path), kotikitRoot));
  result.written.push(path);
  result.notes.push(
    `Claude Code project MCP config written to ${path}. Open Claude Code in the target project and approve kotikit if prompted.`
  );

  const legacyPath = join(targetRoot, ".claude", "mcp.json");
  if ((await readTextIfExists(legacyPath)) !== null) {
    result.notes.push(
      `Existing legacy Claude config left unchanged: ${legacyPath}. Current Claude Code project MCP config lives at ${path}.`
    );
  }
}

async function writeCodexConfig(
  result: ScaffoldAgentsResult,
  targetRoot: string,
  kotikitRoot: string
): Promise<void> {
  const path = join(targetRoot, ".codex", "config.toml");
  await writeTextAtomic(
    path,
    upsertCodexConfig(await readTextIfExists(path), kotikitRoot, targetRoot)
  );
  result.written.push(path);
}

const KOTIKIT_SKILL_NAMES = ["kotikit-auto", "kotikit-design-review"] as const;
type KotikitSkillName = (typeof KOTIKIT_SKILL_NAMES)[number];

function kotikitSkillSourcePath(kotikitRoot: string, name: KotikitSkillName): string {
  return join(kotikitRoot, ".agents", "skills", name, "SKILL.md");
}

function kotikitSkillTargetPath(
  targetRoot: string,
  agent: AgentKind,
  name: KotikitSkillName
): string {
  if (agent === "claude") {
    return join(targetRoot, ".claude", "skills", name, "SKILL.md");
  }
  return join(targetRoot, ".agents", "skills", name, "SKILL.md");
}

function agentLabel(agent: AgentKind): string {
  return agent === "claude" ? "Claude Code" : "Codex";
}

function isOutdatedKotikitAutoSkill(existing: string): boolean {
  return (
    existing.includes("../../../docs/agent_workflow.md") ||
    existing.includes("docs/agent_workflow.md")
  );
}

async function installKotikitSkill(
  result: ScaffoldAgentsResult,
  targetRoot: string,
  kotikitRoot: string,
  agent: AgentKind,
  name: KotikitSkillName
): Promise<void> {
  const sourcePath = kotikitSkillSourcePath(kotikitRoot, name);
  const targetPath = kotikitSkillTargetPath(targetRoot, agent, name);
  const label = agentLabel(agent);
  await assertReadableFile(sourcePath, `${label} skill source`);
  const source = await readFile(sourcePath, "utf8");
  const existing = await readTextIfExists(targetPath);

  if (existing !== null && existing !== source) {
    if (name === "kotikit-auto" && isOutdatedKotikitAutoSkill(existing)) {
      await writeTextAtomic(targetPath, source);
      result.written.push(targetPath);
      result.notes.push(`Replaced outdated ${label} skill: ${targetPath}`);
      return;
    }

    result.skipped.push(targetPath);
    result.notes.push(`Skipped existing ${label} skill with local changes: ${targetPath}`);
    return;
  }

  if (existing === source) {
    result.skipped.push(targetPath);
    return;
  }

  await writeTextAtomic(targetPath, source);
  result.written.push(targetPath);
}

async function ensureEnvFile(result: ScaffoldAgentsResult, targetRoot: string): Promise<void> {
  const path = join(targetRoot, ".env");
  const next = envWithFigmaToken(await readTextIfExists(path));
  if (next === null) {
    result.skipped.push(path);
    return;
  }
  await writeTextAtomic(path, next);
  result.written.push(path);
}

async function updateCoAuthor(
  result: ScaffoldAgentsResult,
  targetRoot: string,
  coAuthor: CoAuthor | null
): Promise<void> {
  if (coAuthor === null) return;

  const path = join(targetRoot, ".kotikit", "config.json");
  const existing = await readTextIfExists(path);
  if (existing === null) {
    result.skipped.push(path);
    result.notes.push("Skipped git.coAuthor because .kotikit/config.json does not exist yet.");
    return;
  }

  await writeTextAtomic(path, configWithCoAuthor(existing, coAuthor));
  result.written.push(path);
}

export async function scaffoldAgents(
  options: ScaffoldAgentsOptions
): Promise<ScaffoldAgentsResult> {
  const targetRoot = resolve(options.targetRoot);
  const kotikitRoot = resolve(options.kotikitRoot);
  const agents = uniqueAgents(options.agents);
  const result: ScaffoldAgentsResult = { written: [], skipped: [], notes: [] };

  await assertReadableFile(serverPath(kotikitRoot), "kotikit MCP server");

  await Promise.all([
    agents.includes("claude")
      ? writeClaudeConfig(result, targetRoot, kotikitRoot)
      : Promise.resolve(),
    agents.includes("codex")
      ? writeCodexConfig(result, targetRoot, kotikitRoot)
      : Promise.resolve(),
  ]);

  const installSkills = options.installSkills ?? options.installCodexSkill ?? true;
  if (installSkills) {
    await Promise.all(
      agents.flatMap((agent) =>
        KOTIKIT_SKILL_NAMES.map((name) =>
          installKotikitSkill(result, targetRoot, kotikitRoot, agent, name)
        )
      )
    );
  }

  if (options.ensureEnv ?? true) {
    await ensureEnvFile(result, targetRoot);
  }

  await updateCoAuthor(result, targetRoot, coAuthorForMode(options.coAuthorMode ?? "auto", agents));

  return result;
}
