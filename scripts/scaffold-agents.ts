#!/usr/bin/env bun

import { resolve } from "path";
import { parseAgentSelection, scaffoldAgents, type CoAuthorMode } from "../src/setup/scaffold-agents.js";

interface CliOptions {
  targetRoot: string;
  kotikitRoot: string;
  agents: ReturnType<typeof parseAgentSelection>;
  coAuthorMode: CoAuthorMode;
  ensureEnv: boolean;
  installSkills: boolean;
  help: boolean;
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseCoAuthorMode(value: string | undefined): CoAuthorMode {
  if (value === undefined) return "auto";
  if (value === "auto" || value === "none" || value === "claude" || value === "codex") return value;
  throw new Error("--co-author must be one of: auto, none, claude, codex");
}

function parseArgs(argv: string[], defaults: { cwd: string; kotikitRoot: string }): CliOptions {
  const seed: CliOptions = {
    targetRoot: defaults.cwd,
    kotikitRoot: defaults.kotikitRoot,
    agents: ["claude", "codex"],
    coAuthorMode: "auto",
    ensureEnv: true,
    installSkills: true,
    help: false,
  };

  return argv.reduce<CliOptions>((opts, arg, index) => {
    if (argv[index - 1] === "--target" || argv[index - 1] === "--kotikit-root" || argv[index - 1] === "--agents" || argv[index - 1] === "--co-author") {
      return opts;
    }
    if (arg === "--help" || arg === "-h") return { ...opts, help: true };
    if (arg === "--no-env") return { ...opts, ensureEnv: false };
    if (arg === "--no-skill") return { ...opts, installSkills: false };
    if (arg === "--target") return { ...opts, targetRoot: readFlagValue(argv, index, "--target") };
    if (arg.startsWith("--target=")) return { ...opts, targetRoot: arg.slice("--target=".length) };
    if (arg === "--kotikit-root") return { ...opts, kotikitRoot: readFlagValue(argv, index, "--kotikit-root") };
    if (arg.startsWith("--kotikit-root=")) return { ...opts, kotikitRoot: arg.slice("--kotikit-root=".length) };
    if (arg === "--agents") return { ...opts, agents: parseAgentSelection(readFlagValue(argv, index, "--agents")) };
    if (arg.startsWith("--agents=")) return { ...opts, agents: parseAgentSelection(arg.slice("--agents=".length)) };
    if (arg === "--co-author") return { ...opts, coAuthorMode: parseCoAuthorMode(readFlagValue(argv, index, "--co-author")) };
    if (arg.startsWith("--co-author=")) return { ...opts, coAuthorMode: parseCoAuthorMode(arg.slice("--co-author=".length)) };
    throw new Error(`Unknown option: ${arg}`);
  }, seed);
}

function helpText(): string {
  return [
    "Usage: bun run scaffold:agents -- --target /path/to/react-project [options]",
    "",
    "Options:",
    "  --agents claude|codex|both|claude,codex  Agent configs to write. Default: both.",
    "  --kotikit-root /path/to/kotikit          Kotikit repo root. Default: this repo.",
    "  --co-author auto|none|claude|codex       Update existing .kotikit/config.json co-author. Default: auto.",
    "  --no-env                                Do not create or append FIGMA_TOKEN= in .env.",
    "  --no-skill                              Do not install kotikit-auto skills into the target project.",
    "  --help                                  Show this help.",
  ].join("\n");
}

function printList(label: string, values: string[]): void {
  if (values.length === 0) return;
  console.log(`${label}:`);
  values.map((value) => `  - ${value}`).forEach((line) => console.log(line));
}

async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2), {
    cwd: process.cwd(),
    kotikitRoot: resolve(import.meta.dir, ".."),
  });

  if (opts.help) {
    console.log(helpText());
    return;
  }

  const result = await scaffoldAgents({
    targetRoot: opts.targetRoot,
    kotikitRoot: opts.kotikitRoot,
    agents: opts.agents,
    coAuthorMode: opts.coAuthorMode,
    ensureEnv: opts.ensureEnv,
    installSkills: opts.installSkills,
  });

  console.log("kotikit agent scaffold complete.");
  printList("Written", result.written);
  printList("Skipped", result.skipped);
  printList("Notes", result.notes);
  console.log("");
  console.log("Next: restart your assistant and confirm the kotikit_* MCP tools are listed.");
  if (opts.agents.includes("claude")) {
    console.log(`For Claude Code, open the target project (${opts.targetRoot}), approve the project MCP server if prompted, then run /mcp and /kotikit-auto.`);
  }
  if (opts.agents.includes("codex")) {
    console.log("For Codex, start a new session in the target project and run /mcp or kotikit:auto.");
  }
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown scaffold error";
  console.error(`kotikit agent scaffold failed: ${message}`);
  process.exit(1);
}
