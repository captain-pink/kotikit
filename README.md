# kotikit

kotikit turns your Figma design system into real, working React code through a conversation
with an AI coding assistant such as Claude Code or Codex. You describe a screen, the agent
asks the right questions, kotikit saves a precise spec, then pulls your Figma components,
generates React code, and saves everything as you go. No code to write. No developer to chase.

---

## Who this is for

Designers who use Claude Code or Codex, have a Figma design system, and want to ship screens
as React components without writing code by hand. You do not need to know React, git commands,
or anything about the terminal beyond copy-paste.

---

## Prerequisites

- **Bun** — a fast JavaScript runtime (one install command below).
- **An MCP-capable AI coding assistant** — Claude Code or Codex.
  - Claude Code: [install it from the VS Code Marketplace.](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code)
  - Codex: install the Codex CLI or IDE extension and sign in.
- **A Figma personal access token** — open Figma, go to Settings → Account → Personal access
  tokens, and create one with the "File read" scope. Copy it somewhere safe.
- **A target React project** — kotikit generates code into a React project on your machine.
  If you do not have one yet, create it now:

  ```bash
  bun create vite my-app --template react-ts
  cd my-app && bun install
  ```

  Your target project also needs Tailwind CSS configured and the following runtime deps
  installed (kotikit's generated components use them):

  ```bash
  bun add class-variance-authority clsx tailwind-merge
  ```

  If you already have a React project, just add those three packages to it.
- **Your project should be a folder tracked by version control** — if you are not sure, open
  your project folder in Terminal and run `git init`. That is all you need.
  If version control asks you for a name and email (e.g. "Please tell me who you are"), run:

  ```bash
  git config user.email "you@example.com" && git config user.name "Your Name"
  ```

---

## Install (5 minutes)

Follow these steps in order. Every code block is copy-paste.

**1. Install Bun** (skip if you already have it):

```bash
curl -fsSL https://bun.sh/install | bash
```

Close and reopen Terminal after this finishes so the `bun` command is available.

**2. Clone kotikit next to your project** (or wherever you keep tools):

```bash
git clone https://github.com/captain-pink/kotikit.git ~/kotikit
```

**3. Install kotikit's dependencies:**

```bash
cd ~/kotikit && bun install
```

**4. Add kotikit to your assistant's MCP config.**

This config belongs to YOUR TARGET PROJECT (the React app you are building), not in
`~/kotikit`.

Claude Code and Codex both speak MCP, but they read different config files.

**Recommended local setup**: run the scaffold command from the kotikit repo:

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-react-project --agents both
```

This writes or updates `.claude/mcp.json`, `.codex/config.toml`, installs the Codex
`kotikit-auto` skill into the target project, and creates `.env` with a `FIGMA_TOKEN=`
placeholder if needed.

If you already scaffolded an older `kotikit-auto` skill that points at
`docs/agent_workflow.md`, rerun the command after pulling the latest kotikit. The scaffold
command replaces that known-broken skill with the portable self-contained version.

For Codex-only projects where `.kotikit/config.json` already exists and you want generated
commit footers to say Codex, run:

```bash
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-react-project --agents codex --co-author codex
```

For both Claude Code and Codex, the scaffold command leaves an existing `git.coAuthor`
unchanged because that value is project-wide.

**Manual setup**: if you prefer to write config files yourself, use the blocks below.

**Claude Code**: create (or open) `.claude/mcp.json` inside your target project and add:

```json
{
  "mcpServers": {
    "kotikit": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/Users/YOUR_USERNAME/kotikit/src/mcp/server.ts"]
    }
  }
}
```

Replace `YOUR_USERNAME` with your macOS username (run `whoami` in Terminal if unsure).

MCP config file paths vary between Claude Code versions. If the block above does not work,
see the [Claude Code MCP documentation](https://docs.anthropic.com/claude-code/mcp) for the
canonical location for your version.

**Codex**: create (or open) `.codex/config.toml` inside your trusted target project and add:

```toml
[mcp_servers.kotikit]
command = "bun"
args = ["run", "/Users/YOUR_USERNAME/kotikit/src/mcp/server.ts"]
cwd = "/Users/YOUR_USERNAME/path/to/your-react-project"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Replace both paths. The `cwd` value must point at your target React project so kotikit reads
the right `.env`, `.kotikit/config.json`, and generated-code folders. If you prefer global
Codex config, put the same block in `~/.codex/config.toml`.

Codex can also use the repo-scoped skill at `.agents/skills/kotikit-auto/SKILL.md`. If you
are running Codex from the target React project rather than this repo, symlink or copy that
skill folder into the target project's `.agents/skills/` directory so `kotikit:auto` is
discoverable there.

When Codex runs the `kotikit-auto` skill, first-time setup passes a Codex co-author identity
to kotikit automatically. If you initialize manually and want generated commits to say Codex
instead of the backward-compatible Claude Code default, set this inside the existing `git`
block in `.kotikit/config.json`:

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

**5. Set up your Figma token.**

Create or open `.env` in your target project root (the same folder as `package.json`) and
set this value:

```
FIGMA_TOKEN=figd_...your_token_here...
```

Replace the placeholder with the token you copied from Figma. If you used `scaffold:agents`,
the `.env` file may already exist with `FIGMA_TOKEN=` ready to fill in. This file is
automatically ignored by git so your token stays private.

**6. Restart your assistant.**

- Claude Code: Cmd+Shift+P -> "Developer: Reload Window" in VS Code.
- Codex: start a new Codex session in your target project.

After restarting, ask your assistant to list MCP tools. In Codex, run `/mcp`. You should see
the `kotikit_*` tools listed. If nothing appears, double-check the configured paths.

---

## Your first hour with kotikit

### 30 seconds: sync your design system

Open your assistant in your project and type:

> *"Check if kotikit is set up here."*

If kotikit is not yet configured for this project, the assistant will walk you through a short setup
conversation — about two minutes, no technical knowledge required.

Then type:

> *"Sync my Figma design system."*

The assistant will ask for your Figma file URL (or you can paste it during setup). It pulls every
component from Figma into a local snapshot that kotikit uses to generate code. You will see
a count like "Sync complete: 48 components, 312 icons."

You only need to sync again when your Figma components change.

---

### 3 minutes: build your first screen

Type:

> *"I want to build a login screen."*

The assistant starts a conversation. It will ask you about:

- Who uses this screen and what they are trying to do.
- What the user sees first, and what they can do from there.
- What happens when something goes wrong (wrong password, no account yet).
- Any edge cases specific to your product.

Answer naturally — full sentences or bullet points, whichever feels easier. The assistant will keep
asking until the picture is complete. When it is, the assistant summarizes the screen back to you:

> "Here is what I have: a login screen for returning users, with an email and password field,
> a 'Forgot password' link, and a primary 'Log in' button. On failure, an inline error
> appears below the password field without clearing the email. On success, the user lands on
> the dashboard. Does this look right?"

Confirm (or ask for changes), and kotikit saves the spec. Then type:

> *"Write the code for the login screen."*

The assistant generates a production-ready React component using your Figma components, with
accessibility, keyboard navigation, and error handling included. It saves the file and records
a save-point automatically.

---

### 1 minute: generate React versions of my Figma components

If you want React component files generated directly from your Figma components (without
designing a full screen first), type:

> *"Generate React versions of my Figma components."*

The assistant will walk through your unscaffolded Figma components in small batches, generate a
TypeScript + CVA component file for each one, and save them to your components folder.

---

### 1 minute: run the drift audit

After you have been building for a while, type:

> *"Run a drift audit."*

kotikit compares every component in your Figma design system against the code files it knows
about, and gives you a short report:

```
Audit complete: 14 entries
  11 synced-ok
   1 mismatched  (Button — Figma has "size" axis, code does not)
   2 design-only (Card, Avatar — in Figma but not yet in code)
```

"Synced-ok" means Figma and code agree. "Mismatched" means a variant axis exists on one side
but not the other — the report tells you exactly which axis. "Design-only" means kotikit has
not scaffolded those components yet.

For each `synced-mismatched` row, open the named component file, add or rename the variant
prop to match what the report says Figma has, then re-run the audit to confirm the fix.

---

## Working with the Figma plugin

kotikit ships a Figma plugin that connects your Figma session to the same kotikit MCP server
running locally.

**Build and install the plugin (one-time):**

```bash
cd ~/kotikit && bun run plugin:build
```

Then in Figma: Plugins → Development → Import plugin from manifest → pick
`~/kotikit/figma-plugin/manifest.json`.

**Start the bridge before using the plugin:**

```bash
cd ~/kotikit && bun run bridge
```

Your terminal will print a one-time connection address. Copy it exactly as printed.

In Figma: Plugins → Development → kotikit → paste that address into the Connect dialog.

<details>
<summary>What's actually happening (for the curious)</summary>

The bridge runs a local WebSocket server. The address it prints looks like
`ws://localhost:53124?token=abc123` — a secure, local-only URL that includes a one-time
token so only your Figma session can connect. Nothing leaves your machine.

</details>

**What the plugin currently does:**

- Connects your Figma file to the running kotikit session.
- Lets you inspect the link between a Figma component and its code counterpart.

**What is coming:** A full plan-checklist view inside the plugin — click a screen in Figma,
see the spec and implementation status without leaving Figma. See `NEXT_STEPS.md` for the
full list.

---

## Keeping conversations cheap

Your assistant has a conversation budget. kotikit is designed to stay well inside it — tool responses
are kept lean by default, and large design system dictionaries are never loaded into a
conversation all at once.

Practical tips that help:

- Run sync_ds in its own conversation, not mixed in with design work.
- Brainstorm one screen per session, then start a fresh chat.
- Scaffold in batches of three to five components, not all at once.
- Run the drift audit at the end of a session, not the start.

For the full explanation of what costs tokens and how to control it, see `docs/TOKENS.md`.

---

## Composing with Chrome DevTools MCP

After kotikit commits your generated code, you can ask your assistant to visually validate it. If
you have [Chrome DevTools MCP](https://github.com/modelcontextprotocol/servers) installed
alongside kotikit, type:

> *"Open localhost:6006 and take a screenshot of the login screen."*

The assistant will open your Storybook or dev server and validate the rendered output against what
you described. Chrome DevTools MCP is a separate tool that the assistant orchestrates alongside
kotikit — kotikit handles the spec and code, Chrome DevTools MCP handles the live browser.
Neither one depends on the other.

---

## Troubleshooting

**1. "Your Figma token is missing or invalid."**

kotikit could not find or use your Figma personal access token.

Fix: make sure you completed Install step 5 — a `.env` file in your target project root
(next to `package.json`) containing `FIGMA_TOKEN=figd_...your_token_here...`. The token
needs the "File read" scope from Figma Settings → Account → Personal access tokens.

If your team uses 1Password, you can instead set the token field in `.kotikit/config.json`
to `op://vault-name/item-name/field-name` and kotikit will fetch it via the 1Password CLI.

---

**2. "Cannot find module 'class-variance-authority'" (or clsx / tailwind-merge)**

The runtime dependencies kotikit's generated components rely on are not installed in your
target project.

Fix: in your target project folder, run:

```bash
bun add class-variance-authority clsx tailwind-merge
```

This is covered in the Prerequisites section — if you skipped it, add these three packages
and the generated components will compile.

---

**3. "Some required gate tools aren't installed in your project."**

The code quality checks kotikit runs before saving code need a few dev tools in your project.

Fix: in your project folder, run:

```bash
bun add -d typescript eslint eslint-plugin-jsx-a11y prettier vitest
```

Then try again.

---

**4. "No registry yet — run sync_ds first."**

kotikit tried to audit or scaffold but has not synced your design system yet.

Fix: type *"Sync my Figma design system."* in your assistant. After sync completes, try the
audit or scaffold command again.

---

**5. "Storybook not detected — story files skipped."**

This is a notice, not an error. kotikit looked for Storybook in your project and did not
find it, so it skipped generating `.stories.tsx` files.

Fix: if you want story files, install Storybook (`npx storybook@latest init`) and run the
scaffold command again. If you do not use Storybook, you can ignore this message entirely.

---

**6. "That file path is outside your scaffold directory."**

kotikit refused to write a file outside the components folder it is configured to use.

Fix: do not move generated component files to a different location before saving them.
If you need the components folder to be somewhere else, update the `codeComponentsDir` path
in your kotikit config by asking your assistant: *"Change my components folder to src/ui."*

---

**7. Sync returned 0 components even though my Figma file has them**

Figma's published-component API only returns components from files that have been
explicitly published as a team library — and library publishing requires a paid Figma
plan. kotikit handles this automatically by falling back to walking the file's document
tree and extracting every `COMPONENT` and `COMPONENT_SET` node directly. You should see
a sync report entry like `"Library not published — fell back to document tree
extraction."` confirming the fallback ran.

Fix: nothing to do — if you still get 0 components after the fallback, the file likely
has no components yet, or your Figma token does not have access to it. Re-check by
visiting the file in a browser while signed in to the same Figma account whose token
you used.

---

**8. "Figma Variables API requires an Enterprise plan"**

This is a notice, not an error. Figma's Variables endpoint is gated to Enterprise plans;
kotikit detects the 403 and skips it gracefully. Your color, text, and effect **styles**
were still synced normally — only variable-based tokens are unavailable.

Fix: if you need variable-style design tokens on a Free or Professional plan, define them
manually in a `tokens.json` file (or use [Style Dictionary](https://amzn.github.io/style-dictionary/))
and import them in your project.

---

## Where to learn more

- `docs/tools.md` — every kotikit MCP tool, with examples.
- `docs/agent_workflow.md` — the shared Claude Code / Codex workflow for `kotikit:auto`.
- `docs/codex_support_plan.md` — the Codex support implementation plan and local test checklist.
- `docs/coding_guidelines.md` — coding standards for agents and engineers extending kotikit.
- `docs/modules/setup.md` — how the local agent scaffold command works.
- `docs/modules/` — how each piece of kotikit works under the hood (for engineers or
  curious designers).
- `docs/TOKENS.md` — keeping conversations cheap: what costs tokens and how to reduce it.
- `NEXT_STEPS.md` — what is coming in future versions.
- `planning/` — the build-by-build design rationale (written for engineers; skippable).

---

## License

MIT.
