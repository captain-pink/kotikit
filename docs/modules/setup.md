# Setup

## What it does

The setup module owns local scaffolding for agent config files. It is not the
runtime MCP server; it is a developer/onboarding helper that writes the files a
target React project needs before Claude Code or Codex can call kotikit.

## Public surface

**Agent scaffold** (`src/setup/scaffold-agents.ts`)
- `scaffoldAgents(opts)` - writes or updates local agent setup for a target
  project; returns `{ written, skipped, notes }`
- `parseAgentSelection(value)` - parses `claude`, `codex`, `both`, or
  `claude,codex`
- `upsertCodexConfig(existing, kotikitRoot, targetRoot)` - updates only the
  `[mcp_servers.kotikit]` TOML block and preserves other sections

**CLI wrapper** (`scripts/scaffold-agents.ts`)
- `bun run scaffold:agents -- --target <target-project> --agents both`

## How it works

The scaffold command resolves two roots: the target React project and the
kotikit repository. It verifies that `src/mcp/server.ts` exists in the kotikit
root, then writes agent-specific setup:

- Claude Code: `.claude/mcp.json`, preserving existing `mcpServers` entries
  and upserting the `kotikit` server.
- Codex: `.codex/config.toml`, replacing only the
  `[mcp_servers.kotikit]` section or appending it if missing.
- Codex skill: copies `.agents/skills/kotikit-auto/SKILL.md` into the target
  project unless a different local skill already exists.
- Figma token placeholder: creates `.env` with `FIGMA_TOKEN=` or appends that
  key when `.env` exists without it.
- Co-author metadata: when requested, updates an existing
  `.kotikit/config.json` with `git.coAuthor`.

All file writes are atomic: write a temp file next to the destination, then
rename it into place. Existing unrelated config is preserved.

## When to extend it

- Adding dry-run support - return planned writes and diffs without touching the
  filesystem.
- Adding interactive prompts - keep prompt handling in the CLI wrapper and keep
  `scaffoldAgents` deterministic.
- Publishing `create-kotikit` - reuse this module for file generation, then add
  package-manager detection, Bun checks, and smoke validation.

## Related

- [config](./config.md) - `.kotikit/config.json` and `git.coAuthor`
- [mcp](./mcp.md) - server entrypoint and MCP initialization instructions
- [git](./git.md) - generated commit footers use the configured co-author
