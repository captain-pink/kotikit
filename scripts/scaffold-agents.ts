#!/usr/bin/env bun

import { resolve } from "node:path";
import { parseAgentSelection, scaffoldAgents } from "../src/setup/scaffold-agents.js";

interface CliOptions {
  targetRoot: string;
  kotikitRoot: string;
  agents: ReturnType<typeof parseAgentSelection>;
  ensureEnv: boolean;
  installSkills: boolean;
  preserveSkills: boolean;
  help: boolean;
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[], defaults: { cwd: string; kotikitRoot: string }): CliOptions {
  const opts: CliOptions = {
    targetRoot: defaults.cwd,
    kotikitRoot: defaults.kotikitRoot,
    agents: ["claude", "codex"],
    ensureEnv: true,
    installSkills: true,
    preserveSkills: false,
    help: false,
  };

  argv.forEach((arg, index) => {
    if (
      argv[index - 1] === "--target" ||
      argv[index - 1] === "--kotikit-root" ||
      argv[index - 1] === "--agents"
    ) {
      return;
    }
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      return;
    }
    if (arg === "--no-env") {
      opts.ensureEnv = false;
      return;
    }
    if (arg === "--no-skill") {
      opts.installSkills = false;
      return;
    }
    if (arg === "--preserve-skills") {
      opts.preserveSkills = true;
      return;
    }
    if (arg === "--target") {
      opts.targetRoot = readFlagValue(argv, index, "--target");
      return;
    }
    if (arg.startsWith("--target=")) {
      opts.targetRoot = arg.slice("--target=".length);
      return;
    }
    if (arg === "--kotikit-root") {
      opts.kotikitRoot = readFlagValue(argv, index, "--kotikit-root");
      return;
    }
    if (arg.startsWith("--kotikit-root=")) {
      opts.kotikitRoot = arg.slice("--kotikit-root=".length);
      return;
    }
    if (arg === "--agents") {
      opts.agents = parseAgentSelection(readFlagValue(argv, index, "--agents"));
      return;
    }
    if (arg.startsWith("--agents=")) {
      opts.agents = parseAgentSelection(arg.slice("--agents=".length));
      return;
    }
    throw new Error(`Unknown option: ${arg}`);
  });
  return opts;
}

function helpText(): string {
  return [
    "Usage: bun run scaffold:agents -- --target /path/to/react-project [options]",
    "",
    "Options:",
    "  --agents claude|codex|both|claude,codex  Agent configs to write. Default: both.",
    "  --kotikit-root /path/to/kotikit          Kotikit repo root. Default: this repo.",
    "  --no-env                                Do not create or append FIGMA_TOKEN= in .env.",
    "  --no-skill                              Do not install kotikit skills into the target project.",
    "  --preserve-skills                       Keep changed copied skills instead of backing them up and refreshing.",
    "  --help                                  Show this help.",
  ].join("\n");
}

function printList(label: string, values: string[]): void {
  if (values.length === 0) return;
  console.log(`${label}:`);
  console.log(values.map((value) => `  - ${value}`).join("\n"));
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
    ensureEnv: opts.ensureEnv,
    installSkills: opts.installSkills,
    preserveSkills: opts.preserveSkills,
  });

  console.log("kotikit agent scaffold complete.");
  printList("Written", result.written);
  printList("Skipped", result.skipped);
  printList("Notes", result.notes);
  console.log("");
  console.log("Next: restart your assistant and confirm the kotikit_* MCP tools are listed.");
  if (opts.agents.includes("claude")) {
    console.log(
      `For Claude Code, open the target project (${opts.targetRoot}), approve the project MCP server if prompted, then run /mcp and /kotikit-auto.`
    );
    console.log("For design review, run /kotikit-design-review.");
  }
  if (opts.agents.includes("codex")) {
    console.log(
      "For Codex, start a new session in the target project and run /mcp, kotikit:auto, or kotikit:design-review."
    );
  }
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown scaffold error";
  console.error(`kotikit agent scaffold failed: ${message}`);
  process.exit(1);
}
