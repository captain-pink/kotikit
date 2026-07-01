# Getting Started

This guide gets kotikit connected to a local target workspace so Claude Code,
Codex, or another MCP-capable assistant can call the `kotikit_*` MCP tools.

## What You Need

- Bun installed locally.
- A local clone of this repository, or an installed kotikit package that exposes
  `kotikit-mcp`.
- Claude Code, Codex, or another MCP-capable assistant.
- Figma's assistant plugin/integration for your assistant installed from inside
  Figma, for example the Claude Code or Codex integration. This is separate
  from kotikit's local Figma plugin.
- A Professional, Organization, or Enterprise Figma account is recommended.
  Free/Starter accounts can hit very low API limits during design-system sync.
- A Figma personal access token with file read access if you want local
  design-system sync or REST-backed comment review.
- A published Figma design-system library if you want kotikit to compose new
  drafts from real components.
- A target workspace/project folder where kotikit can write `.kotikit/`,
  `design-system/`, and `.env`.

Why a target workspace? kotikit stores local specs, design-system indexes,
review memory, assistant config, and your `.env` token placeholder next to the
work you are asking the assistant to manage. The current guided workflow does
not require you to write code or run a web app.

For design-only experiments, a plain local folder is enough:

```bash
mkdir my-kotikit-workspace
cd my-kotikit-workspace
git init
```

## 1. Install Bun

Skip this if `bun --version` already works.

```bash
curl -fsSL https://bun.sh/install | bash
```

Close and reopen your terminal after installing Bun.

## 2. Clone kotikit

```bash
git clone https://github.com/captain-pink/kotikit.git ~/kotikit
cd ~/kotikit
bun install
```

## 3. Install The Assistant Plugin Wrapper

Use plugin installation when your assistant supports local plugins:

- Codex wrapper: `plugins/codex/kotikit`
- Claude wrapper: `plugins/claude/kotikit`

Both plugin wrappers launch the shared `kotikit-mcp` server and include a
designer-facing `kotikit` skill. Plugin installation assumes the kotikit package
is installed or linked so `kotikit-mcp` is available on `PATH`. After installing
the wrapper, restart the assistant in your target workspace and check that the
`kotikit_*` tools are available.

Use `bun run scaffold:agents` for local development, source checkouts, or manual
MCP setup in a target workspace.

## 4. Scaffold Assistant Config For Source Development

Run this from the kotikit repo. The `--target` path should point to the
workspace or app project where you want to use kotikit.

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-project --agents both
```

Use one assistant if needed:

```bash
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-project --agents claude
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-project --agents codex
```

The scaffold writes:

- `.mcp.json` for Claude Code.
- `.codex/config.toml` for Codex.
- Portable `kotikit-auto` and `kotikit-design-review` skills.
- Claude Code slash command files for `/kotikit-auto` and
  `/kotikit-design-review`.
- `.env` with a `FIGMA_TOKEN=` placeholder if needed.

It preserves unrelated assistant config and skips copied skills with local
changes.

## 5. Install The Figma Assistant Plugin

Open Figma and install the assistant integration for the tool you use, such as
Claude Code or Codex. Figma now exposes these integrations directly from the
Figma app, so use Figma's in-app plugin/integration install flow rather than
copying files manually.

This assistant integration is not the same as the kotikit local Figma plugin:

- Figma's assistant integration lets your assistant connect to Figma in the
  normal Figma-supported way. This is the path kotikit agents use to create or
  refine Figma drafts.
- kotikit's local Figma plugin only exports variables through the local bridge
  when Figma's REST Variables API is unavailable.

## 6. Add Your Figma Token For Local Sync

Figma personal access token is not required for draft creation when your
assistant is connected through Figma's remote MCP integration. Create a token
only when you want kotikit to sync a local design-system index or use
REST-backed comment review, then put it in the target workspace `.env` file:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

For design-system sync, file read access is required. For posting review
comments through REST, `file_comments:write` is required. Comment review needs
`file_comments:read`.

For best results, sync a published Figma library rather than an unpublished
draft file. kotikit may inspect some draft-file data, but Figma drafts can only
reuse design-system components when Figma exposes importable component keys from
a published library.

Figma's REST Variables API is Enterprise-only. If you need variables or tokens
on Professional or Organization plans, kotikit will guide you through starting
the local plugin and exporting variables from the open Figma file.

## 7. Restart The Assistant

Restart Claude Code or start a fresh Codex session in the target project.

Run `/mcp` and confirm the `kotikit_*` tools are listed.

Start the guided workflow:

- Claude Code: `/kotikit-auto`
- Codex: `kotikit:auto`

Start focused design review:

- Claude Code: `/kotikit-design-review`
- Codex: `kotikit:design-review`

## Updating kotikit

In the kotikit repo:

```bash
cd ~/kotikit
git pull --ff-only
bun install
```

Then refresh the copied assistant skills and config in each target project:

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-project --agents both
```

If you customized copied skills, scaffold may skip them to avoid overwriting
local changes. If you did not customize them, remove the old copied skill
folders and rerun scaffold.

## First Command

After setup, ask the assistant:

```text
kotikit:auto
```

or in Claude Code:

```text
/kotikit-auto
```

The assistant should check setup, ask what you want to build, and guide you
through the first spec.
