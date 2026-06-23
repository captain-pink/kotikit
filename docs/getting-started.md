# Getting Started

This guide gets kotikit connected to a local target project so Claude Code or
Codex can call the `kotikit_*` MCP tools.

## What You Need

- Bun installed locally.
- A local clone of this repository.
- Claude Code, Codex, or another MCP-capable assistant.
- Figma's assistant plugin/integration for your assistant installed from inside
  Figma, for example the Claude Code or Codex integration. This is separate
  from kotikit's local Figma plugin.
- A Figma personal access token with file read access.
- A target project folder where kotikit can write `.kotikit/`,
  `design-system/`, and `.env`.

The target project can be a clean React/Vite project even though guided
design-to-code is not enabled yet:

```bash
bun create vite my-app --template react-ts
cd my-app
bun install
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

## 3. Scaffold Assistant Config

Run this from the kotikit repo. The `--target` path should point to the project
where you want to use kotikit.

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
- `.env` with a `FIGMA_TOKEN=` placeholder if needed.

It preserves unrelated assistant config and skips copied skills with local
changes.

## 4. Install The Figma Assistant Plugin

Open Figma and install the assistant integration for the tool you use, such as
Claude Code or Codex. Figma now exposes these integrations directly from the
Figma app, so use Figma's in-app plugin/integration install flow rather than
copying files manually.

This assistant integration is not the same as the kotikit local Figma plugin:

- Figma's assistant integration lets your assistant connect to Figma in the
  normal Figma-supported way.
- kotikit's local Figma plugin applies kotikit design plans and exports
  variables through the local bridge.

## 5. Add Your Figma Token

Create a Figma personal access token in Figma account settings, then put it in
the target project's `.env` file:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

For design-system sync, file read access is required. For posting review
comments, `file_comments:write` is required. Comment review needs
`file_comments:read`.

## 6. Restart The Assistant

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
