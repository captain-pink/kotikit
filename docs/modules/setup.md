# Setup

## What it does

The setup module owns source-checkout scaffolding for agent config files. It is
not the runtime MCP server; it is a developer/onboarding helper that writes the
files a target workspace or app project needs before Claude Code or Codex can
call kotikit when plugin installation is unavailable or inconvenient.

Assistant plugin wrappers in `plugins/codex/kotikit` and
`plugins/claude/kotikit` are the preferred setup path when the assistant
supports local plugins and `kotikit-mcp` is available on `PATH`. The scaffold
remains the compatibility path for local development, source checkouts, and
manual MCP setup.

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

The scaffold command resolves two roots: the target workspace/project and the
kotikit repository. The target can be any local workspace where kotikit may
write `.kotikit/`, `design-system/`, and `.env`; it does not need to be an app
project. The scaffold verifies that `src/mcp/server.ts` exists in the kotikit
root, then writes agent-specific setup:

- Claude Code: project-scoped `.mcp.json`, preserving existing `mcpServers`
  entries and upserting the `kotikit` server with a long per-tool timeout for
  large Figma syncs.
- Codex: `.codex/config.toml`, replacing only the
  `[mcp_servers.kotikit]` section or appending it if missing.
- Agent skills: copies the portable `kotikit-auto` and
  `kotikit-design-review` workflows into the target project unless different
  local skills already exist. Claude Code receives `.claude/skills/...` for
  `/kotikit-auto` and `/kotikit-design-review`; Codex receives
  `.agents/skills/...` for `kotikit:auto` and `kotikit:design-review`. The
  installer replaces the known outdated generated `kotikit-auto` skill that
  points at `docs/agent_workflow.md`, because that path does not exist inside
  target projects.
- Claude Code commands: writes `.claude/commands/kotikit-auto.md` and
  `.claude/commands/kotikit-design-review.md` so the slash commands reliably
  load the copied skills. Existing command files with local changes are
  preserved.
- Figma token placeholder: creates `.env` with `FIGMA_TOKEN=` or appends that
  key when `.env` exists without it. This token is for local design-system sync
  and REST-backed design/comment review, not for draft creation through Figma
  remote MCP auth.
- Co-author metadata: when requested, updates an existing
  `.kotikit/config.json` with `git.coAuthor`.

All file writes are atomic: write a temp file next to the destination, then
rename it into place. Existing unrelated config is preserved.

Claude Code sets `CLAUDE_PROJECT_DIR` when it launches stdio MCP servers.
Kotikit's root resolver uses that value by default, so a project-scoped
`.mcp.json` works even if Claude starts the server process from a different
working directory.

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
