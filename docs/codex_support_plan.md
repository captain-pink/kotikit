# Codex Support Plan

This document describes the minimum work required to make kotikit work well in
Codex in addition to Claude Code. The goal is local testability first: a
developer should be able to connect Codex to the existing kotikit MCP server,
run the same workflows, and verify that the generated specs, code, gates, and
commits behave correctly.

The current architecture is already close. Kotikit is a standard stdio MCP
server, so Codex can call the existing tools without a transport rewrite. The
missing work is product surface and identity: Codex needs setup instructions,
workflow guidance, and correct commit attribution.

## Principles

- Keep the MCP server agent-neutral. Tool names, schemas, return shapes, and
  handlers should not depend on Claude Code or Codex.
- Put workflow guidance in surfaces each agent actually reads.
- Prefer shareable repository or package artifacts over private per-user setup.
- Keep Claude support intact while adding Codex support.
- Make every step locally testable before building a future installer.

## Codex Surfaces This Plan Uses

Codex has several durable instruction and integration surfaces. Use the
smallest one that matches the scope:

- `.codex/config.toml` or `~/.codex/config.toml` for MCP server setup.
- `AGENTS.md` for repository conventions such as build commands and review
  expectations.
- `.agents/skills/*/SKILL.md` for reusable workflows that Codex can discover
  and invoke.
- MCP server `instructions` for cross-tool workflow hints that should travel
  with the server.
- Codex plugins for future installable distribution of skills plus MCP config.

Do not use Codex custom prompts as the primary solution. They are local-only
and are not the right distribution surface for a product workflow.

## Step 1: Document Codex MCP Setup

Status: implemented for local testing.

Add a Codex setup path to `README.md` and any developer setup docs. The setup
must explain that Codex reads MCP servers from `config.toml`, not from
Claude Code's `.mcp.json`.

Recommended user-facing config:

```toml
[mcp_servers.kotikit]
command = "bun"
args = ["run", "/absolute/path/to/kotikit/src/mcp/server.ts"]
cwd = "/absolute/path/to/target-react-project"
startup_timeout_sec = 20
tool_timeout_sec = 900
```

Implementation details:

- Keep the Claude Code setup block, but split the install section into
  "Claude Code" and "Codex" subsections.
- Tell users to place project-scoped Codex config in `.codex/config.toml` only
  for trusted projects. Otherwise, use `~/.codex/config.toml`.
- Include `cwd`. Kotikit resolves Codex projects from `process.cwd()` and by
  walking for `.kotikit`, so the Codex server process must start from the
  target React app, not from the kotikit repository. Claude Code sets
  `CLAUDE_PROJECT_DIR`, which kotikit also honors.
- Include a verification command: in Codex, run `/mcp` and confirm that the
  `kotikit_*` tools are listed.
- Document that `FIGMA_TOKEN` still belongs in the target project's `.env`,
  because kotikit loads that file from the resolved project root.

Local test checklist:

- Add the config above to a disposable target React project.
- Start a new Codex session in that project.
- Run `/mcp` and confirm the kotikit server starts.
- Ask Codex to call `kotikit_config_status`.
- Confirm the tool reports the target project root, not the kotikit repo.

## Step 2: Add a Codex Workflow Surface

Status: implemented for local testing.

`CLAUDE.md` is not a reliable Codex surface. Codex reads `AGENTS.md`, skills,
plugins, MCP server instructions, and configured MCP tools. The `kotikit:auto`
workflow needs to exist in a Codex-native form.

Recommended implementation:

1. Extract the current orchestration rules from `CLAUDE.md` into an
   agent-neutral document, for example `docs/agent_workflow.md`.
2. Keep `CLAUDE.md` as the Claude Code wrapper that points to the shared
   workflow.
3. Add a repo-scoped Codex skill:

   ```text
   .agents/skills/kotikit-auto/SKILL.md
   ```

4. The skill should trigger on requests such as:

   - "kotikit:auto"
   - "run kotikit auto"
   - "build a screen with kotikit"
   - "sync my Figma design system"
   - "generate React code from my Figma components"

5. The skill should tell Codex to use the `kotikit_*` MCP tools and follow the
   same six-step flow:

   - check initialization
   - ask what to build
   - brainstorm deeply
   - confirm in plain language
   - save spec or flow
   - present the "What next?" menu

Why a skill, not a custom prompt:

- Codex custom prompts are local-only and deprecated.
- Skills are shareable, discoverable, and support progressive disclosure.
- A future Codex plugin can package the same skill plus MCP configuration.

Local test checklist:

- Start Codex in this repo and verify the skill appears in `/skills`.
- Start Codex in a target project with the skill installed or symlinked.
- Ask for `kotikit:auto` and verify Codex loads the skill before tool use.
- Confirm Codex does not expose JSON, tool names, schema names, or raw file
  paths to the designer unless explicitly asked.

## Step 3: Add MCP Server Instructions

Status: implemented for local testing.

Codex reads the MCP server `instructions` field returned during
initialization. The kotikit server currently exposes tools but no server-level
workflow guidance. Add concise instructions when constructing the MCP `Server`.

Implementation target:

```ts
const server = new Server(
  { name: "kotikit", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions: KOTIKIT_MCP_INSTRUCTIONS,
  }
);
```

Recommended content:

- First 512 characters must stand alone. Codex uses this early when deciding
  how to use the server.
- State that kotikit is a local design-system-to-code workflow.
- State that tools return internal JSON and the agent must translate results
  into plain language for designers.
- State that `kotikit_get_system_prompt` should be fetched once per session
  before implementation, scaffold, or brainstorm-heavy work.
- State that design-system lookups should use search first, then fetch one
  component JSON by path, never load whole indexes.

Suggested file layout:

```text
src/mcp/instructions.ts
src/mcp/instructions.test.ts
```

Testing:

- Export `KOTIKIT_MCP_INSTRUCTIONS` and test the constant directly.
- Add an MCP initialization smoke test if the SDK test harness makes that
  practical; the goal is to verify the initialization response contains the
  instructions.
- Keep the tool-count test unchanged unless tools are added.
- Add a string-level test for the first 512 characters so future edits do not
  bury the critical workflow.

Local test checklist:

- Start Codex with the kotikit MCP server configured.
- Run `/mcp verbose` or inspect MCP server details.
- Confirm instructions are visible or reflected in Codex's behavior.
- Ask Codex to implement a screen and confirm it fetches
  `kotikit_get_system_prompt` before using `kotikit_implement_code_start`
  results to write code.

## Step 4: Make Commit Attribution Agent-Aware

Status: implemented for local testing.

`src/git/auto-commit.ts` currently hard-codes:

```text
Co-authored-by: Claude Code <noreply@anthropic.com>
```

That is wrong for Codex sessions and misleading in project history. Replace the
hard-coded footer with a configurable co-author identity while preserving the
Claude default for backward compatibility.

Recommended config shape:

```ts
git: {
  autoCommit: true,
  coAuthor: {
    name: "Claude Code" | "Codex" | string,
    email: "noreply@anthropic.com" | "noreply@openai.com" | string
  }
}
```

Implementation details:

- Extend `ConfigSchema` with an optional `git.coAuthor`.
- Default to the current Claude Code footer to avoid changing existing tests
  and user expectations without explicit migration.
- Add `coAuthor?: { name: string; email: string }` to `AutoCommitOpts`.
- Build the footer in a helper such as `formatCoAuthorFooter(coAuthor)`.
- Thread the configured co-author through spec, flow, code, scaffold, and
  design-plan commits.
- Add Codex setup docs that tell users to set:

  ```json
  {
    "git": {
      "autoCommit": true,
      "coAuthor": {
        "name": "Codex",
        "email": "noreply@openai.com"
      }
    }
  }
  ```

  The exact email can be changed later if OpenAI documents a different
  preferred co-author identity.

Testing:

- Existing Claude footer tests should still pass with default config.
- Add unit tests for `formatCoAuthorFooter`.
- Add one integration test proving a Codex configured co-author appears in a
  generated commit body.
- Add a test that invalid empty name/email values are rejected by config
  parsing.

Local test checklist:

- Configure a target project with Codex co-author identity.
- Run a spec-create flow through Codex.
- Inspect `git log --format=%B -1`.
- Confirm the footer says Codex, not Claude Code.

## Step 5: Neutralize Shared Docs and Tool Language

Status: implemented for local testing.

Shared documentation and source comments should say "agent", "AI coding
assistant", or "model" when the behavior is not Claude-specific. Keep
Claude-specific files explicit, but do not let shared docs imply that only
Claude can run kotikit.

Implementation details:

- Update `README.md` introduction to mention Claude Code and Codex.
- Update `docs/tools.md`: "what Claude calls" should become "what the agent
  calls".
- Update `docs/modules/mcp.md`: stdio transport is used by Claude Code and
  Codex; the bridge is still used by the Figma plugin.
- Update `docs/modules/planning.md`, `docs/modules/codegen.md`, and inline
  comments where "Claude" means "the agent".
- Keep historical planning docs unchanged unless they are actively used as
  current docs. They are phase records, not the live product surface.
- Keep `CLAUDE.md` Claude-specific.
- Add a Codex-specific quickstart link from `README.md` to this document.

Testing:

- Run a focused text scan:

  ```bash
  rg -n "Claude|claude|Codex|codex" README.md docs src test
  ```

- Review each remaining Claude mention and classify it as either:
  - intentionally Claude-specific, or
  - should be neutralized.

Local test checklist:

- A Codex user can follow the README without reading Claude-specific setup.
- A Claude Code user can still follow the README without ambiguity.
- Tool descriptions remain accurate and not overfitted to one agent.

## Step 6: Future Autoinstaller

Status: local MVP exists; production-quality installer remains future work.

The local MVP command is:

```bash
bun run scaffold:agents -- --target /absolute/path/to/target-react-project --agents both
```

It writes local Claude Code and Codex MCP config, installs the portable
kotikit-auto skill for selected agents, and creates or updates a `.env` Figma
token placeholder. The production installer should build on that proven
behavior and add a polished, reversible setup flow.

Recommended command:

```bash
bunx create-kotikit
```

Installer responsibilities:

- Detect the target React project.
- Confirm Bun is installed.
- Install kotikit dependencies or use a published package.
- Ask which agent surfaces to configure:
  - Claude Code
  - Codex
  - both
- Write project-scoped `.mcp.json` when Claude Code is selected.
- Write `.codex/config.toml` or print a global config block when Codex is
  selected.
- Offer to install or link the kotikit-auto skill for the selected agents.
- Offer to configure `git.coAuthor` for the selected agent.
- Create `.env` with a placeholder `FIGMA_TOKEN=` line if missing.
- Run a smoke check that calls `kotikit_config_status`.

Installer constraints:

- Never overwrite existing agent config without showing the diff or asking for
  confirmation.
- Never print secret values.
- Never auto-install project dependencies beyond kotikit without explicit
  approval.
- Use atomic writes for config files.
- Keep the generated setup reversible.

Future tests:

- Fixture target projects for Claude-only, Codex-only, and both.
- Snapshot tests for generated config files.
- E2E smoke test that starts the MCP server from generated Codex config.
- Failure tests for missing Bun, existing conflicting config, and missing
  Figma token.

## Definition of Done

- Codex can list and call kotikit MCP tools locally.
- Codex can run the auto workflow from a shareable skill or equivalent
  Codex-native surface.
- The MCP server exposes useful initialization instructions.
- Commits created from Codex sessions do not claim Claude Code authorship.
- Shared docs describe Claude Code and Codex without conflating them.
- Claude Code behavior remains supported.
- Tests cover new config, commit attribution, and MCP instructions.
- Each implementation task lands as an atomic conventional commit.
