# kotikit

kotikit is currently a design-first workflow for designers using Claude Code,
Codex, or another MCP-capable assistant. You describe a screen, the agent asks
the right questions, kotikit saves a precise spec, syncs your Figma design
system, then helps create and refine Figma drafts from that shared context.

Design-to-code is coming in a later version once the design creation workflow is
stable. The guided `kotikit-auto` flow should not be used to generate app code
yet.

---

## Who this is for

Designers who use Claude Code or Codex, have a Figma design system, and want a
guided way to plan screens, compose Figma drafts, review comments, and preserve
design decisions locally. You do not need to know React, git commands, or
anything about the terminal beyond copy-paste.

---

## Prerequisites

- **Bun** — a fast JavaScript runtime (one install command below).
- **An MCP-capable AI coding assistant** — Claude Code or Codex.
  - Claude Code: [install it from the VS Code Marketplace.](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code)
  - Codex: install the Codex CLI or IDE extension and sign in.
- **A Figma personal access token** — open Figma, go to Settings → Account → Personal access
  tokens, and create one with the "File read" scope. Copy it somewhere safe.
- **A local project folder** — kotikit stores specs, design-system indexes,
  review notes, and design memory next to your work. A React project is fine,
  but the guided workflow does not generate app code yet. If you do not have a
  folder yet, a minimal Vite project works:

  ```bash
  bun create vite my-app --template react-ts
  cd my-app && bun install
  ```

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

This config belongs to YOUR TARGET PROJECT (the local workspace you are using), not in
`~/kotikit`.

Claude Code and Codex both speak MCP, but they read different config files.

**Recommended local setup**: run the scaffold command from the kotikit repo:

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-react-project --agents both
```

This writes or updates `.mcp.json` for Claude Code, `.codex/config.toml`, installs the
`kotikit-auto` skill for both assistants, and creates `.env` with a `FIGMA_TOKEN=`
placeholder if needed.

For a Claude Code-only laptop setup, run:

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-react-project --agents claude
```

Then open Claude Code from the target project, approve the project MCP server if prompted,
and run `/mcp`. You should see the `kotikit` server with the `kotikit_*` tools. The
scaffold also installs `.claude/skills/kotikit-auto/SKILL.md`, so you can run
`/kotikit-auto` in Claude Code for the same guided workflow that Codex gets from
`kotikit:auto`.

If you already scaffolded an older `kotikit-auto` skill that points at
`docs/agent_workflow.md`, rerun the command after pulling the latest kotikit. The scaffold
command replaces that known-broken skill with the portable self-contained version.

For Codex-only projects where `.kotikit/config.json` already exists and you want
generated save-point footers to say Codex, run:

```bash
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-react-project --agents codex --co-author codex
```

For both Claude Code and Codex, the scaffold command leaves an existing `git.coAuthor`
unchanged because that value is project-wide.

**Manual setup**: if you prefer to write config files yourself, use the blocks below.

**Claude Code**: create (or open) `.mcp.json` inside your target project and add:

```json
{
  "mcpServers": {
    "kotikit": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/Users/YOUR_USERNAME/kotikit/src/mcp/server.ts"],
      "timeout": 900000
    }
  }
}
```

Replace `YOUR_USERNAME` with your macOS username (run `whoami` in Terminal if unsure). The
`timeout` value is milliseconds and lets long Figma design-system syncs finish instead of
being killed early. Claude Code also supports an equivalent command from inside the target
project:

```bash
claude mcp add --scope project --transport stdio kotikit -- bun run /Users/YOUR_USERNAME/kotikit/src/mcp/server.ts
```

If the command form is used, add `"timeout": 900000` to `.mcp.json` afterwards for large
design-system syncs.

**Codex**: create (or open) `.codex/config.toml` inside your trusted target project and add:

```toml
[mcp_servers.kotikit]
command = "bun"
args = ["run", "/Users/YOUR_USERNAME/kotikit/src/mcp/server.ts"]
cwd = "/Users/YOUR_USERNAME/path/to/your-react-project"
startup_timeout_sec = 20
tool_timeout_sec = 900
```

Replace both paths. The `cwd` value must point at your target React project so kotikit reads
the right `.env`, `.kotikit/config.json`, and generated-code folders. The longer tool timeout
lets large Figma design-system syncs finish under API rate limits instead of being killed by
Codex at two minutes. If you prefer global Codex config, put the same block in
`~/.codex/config.toml`.

Claude Code and Codex can also use the repo-scoped skill at
`.agents/skills/kotikit-auto/SKILL.md`. If you are setting up manually, copy that file to
the product-specific skill location:

- Claude Code: `.claude/skills/kotikit-auto/SKILL.md`, then run `/kotikit-auto`.
- Codex: `.agents/skills/kotikit-auto/SKILL.md`, then run `kotikit:auto`.

When Codex runs the `kotikit-auto` skill, first-time setup passes a Codex
co-author identity to kotikit automatically. If you initialize manually and want
local save-points to say Codex instead of the backward-compatible Claude Code
default, set this inside the existing `git` block in `.kotikit/config.json`:

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

After restarting, ask your assistant to list MCP tools. In Claude Code or Codex, run `/mcp`.
You should see the `kotikit_*` tools listed. If nothing appears, double-check the configured
paths and confirm Bun is installed on that machine.

---

## Your first hour with kotikit

### 30 seconds: sync your design system

Open your assistant in your project and type:

> *"Check if kotikit is set up here."*

If kotikit is not yet configured for this project, the assistant will walk you through a short setup
conversation — about two minutes, no technical knowledge required.

Then type:

> *"Sync my Figma design system."*

The assistant will ask for your Figma file URL (or you can paste it during
setup). It pulls published components, icons, styles, and available variables
from Figma into a local search index that kotikit uses while composing Figma
drafts. You will see a count like "Sync complete: 48 components, 312 icons."

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

Confirm or ask for changes. Once the spec is saved, choose **Create or refine
the Figma design** from the menu. The assistant will start the local Figma
plugin bridge, ask you to open a target draft in Figma, and apply the design
plan step by step using your synced design system where possible.

---

### 2 minutes: review Figma comments

After you or a teammate leave comments on the Figma draft, type:

> *"Review the Figma comments for the Members screen."*

kotikit reads comments through the Figma API, maps comments on known nodes back
to the generated design plan, and helps the assistant make focused refinements.
Repeated feedback can become reusable design preferences for future screens.

---

### 1 minute: import variables on non-Enterprise plans

If `sync_ds` says Figma variables require an Enterprise plan, use the plugin
fallback:

1. Ask your assistant: *"Start the kotikit Figma plugin bridge."*
2. Open the source design-system file in Figma.
3. Run Plugins -> Development -> kotikit.
4. Paste the bridge URL.
5. Click **Sync Variables From Open File**.

This imports variables through Figma's Plugin API from your active session and
stores them in `design-system/variables.json` for future design work.

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

Ask your assistant: **"Start the kotikit Figma plugin bridge."**

The assistant calls `kotikit_bridge_start`, prepares the plugin build if needed,
patches the plugin manifest for the chosen local port, and gives you a one-time
connection address. Copy it exactly as printed.

Manual fallback for kotikit developers:

```bash
cd /path/to/your-react-project
bun run /path/to/kotikit/src/mcp/server.ts --bridge
```

In Figma: Plugins → Development → kotikit → paste that address into the Connect dialog.

<details>
<summary>What's actually happening (for the curious)</summary>

The bridge runs a local WebSocket server. The address it prints looks like
`ws://localhost:53124?token=abc123` — a secure, local-only URL that includes a one-time
token so only your Figma session can connect. Nothing leaves your machine.
If the assistant started the bridge, ask it to stop the bridge when you are done; closing
Claude Code or Codex normally stops the MCP process too.

</details>

**What the plugin currently does:**

- Connects your Figma file to the running kotikit session.
- Shows a compact setup/review checklist backed by the same kotikit MCP tools your assistant uses.
- Runs `kotikit_doctor` through the bridge so you can spot setup issues without leaving Figma.
- Syncs local variables from the open design-system file into `design-system/variables.json`
  when Figma's REST Variables API is unavailable on your plan.
- Loads the latest design review report, including open/fixed comments and pending replies.
- Enables browserless review-comment lookup: the assistant can call `kotikit_design_review_comments` to fetch Figma comments and map comments on known nodes back to the relevant generated frame or component.
- Records compact design adjustments and review reports in `.kotikit/design-review.db`.
- Learns project design preference candidates from repeated feedback, supports dismiss/edit/deactivate lifecycle controls, then uses active promoted preferences in future design context.

**Import variables on a Professional plan:**

Run `kotikit_sync_ds` first. If the sync says variables are blocked by Figma's REST API,
use the plugin fallback:

1. Ask your assistant to start the kotikit bridge, or run:
   **"Start the kotikit Figma plugin bridge."**
2. Open the source design-system file in Figma, not a random draft file.
3. Run Plugins → Development → kotikit.
4. Paste the bridge URL your assistant returned.
5. Click **Sync Variables From Open File**.

The plugin reads Figma variables from the currently open file and sends a compact payload
to kotikit over the local bridge. kotikit then merges those variables into
`design-system/variables.json`, preserving style tokens that were already synced.

**What is coming:** richer fallback mapping for comments outside known nodes, semantic clustering of repeated feedback, and a full plan-checklist view inside the plugin. See `NEXT_STEPS.md` for the full list.

---

## Keeping conversations cheap

Your assistant has a conversation budget. kotikit is designed to stay well inside it — tool responses
are kept lean by default, and large design system dictionaries are never loaded into a
conversation all at once.

Practical tips that help:

- Run sync_ds in its own conversation, not mixed in with design work.
- Brainstorm one screen per session, then start a fresh chat.
- Review comments in focused batches instead of trying to fix every open note in
  one pass.

For the full explanation of what costs tokens and how to control it, see `docs/TOKENS.md`.

---

## Composing with Chrome DevTools MCP

Chrome DevTools MCP is not required for the current design-first workflow. It may
be useful later when design-to-code returns, but current Figma comment review and
design refinement work without a browser.

---

## Troubleshooting

**1. "Your Figma token is missing or invalid."**

kotikit could not find or use your Figma personal access token.

Fix: make sure you completed Install step 5 — a `.env` file in your target project root
(next to `package.json`) containing `FIGMA_TOKEN=figd_...your_token_here...`. The token
needs the "File read" scope from Figma Settings -> Account -> Personal access tokens.
For the standard `.env` setup, `.kotikit/config.json` does not need a `figma.token` field;
sync uses `FIGMA_TOKEN` automatically unless you configure a different token source.

If your team uses 1Password, you can instead set the token field in `.kotikit/config.json`
to `op://vault-name/item-name/field-name` and kotikit will fetch it via the 1Password CLI.

---

**2. "Some required gate tools aren't installed in your project."**

This usually matters only for experimental implementation tools. The guided
design workflow can continue without installing code gate tools.

Fix, if you intentionally use experimental implementation tools: in your project
folder, run:

```bash
bun add -d typescript eslint eslint-plugin-jsx-a11y prettier vitest
```

Then try again.

---

**3. "No registry yet — run sync_ds first."**

kotikit tried to use design-system data but has not synced your design system
yet.

Fix: type *"Sync my Figma design system."* in your assistant. After sync
completes, try the design action again.

---

**4. "Storybook not detected — story files skipped."**

This notice belongs to experimental component scaffolding. It is not relevant to
the guided design workflow.

---

**5. "That file path is outside your scaffold directory."**

This notice belongs to experimental component scaffolding. It is not relevant to
the guided design workflow.

---

**6. Sync returned 0 components even though my Figma file has them**

Figma's published-component API only returns components from files that have been
explicitly published as a team library. Kotikit needs those published/importable keys
so generated Figma drafts can instantiate your design-system components. If a file is
not published, sync will skip component extraction and report that the file is not
published as a library.

Fix: publish the design-system file as a Figma library, make sure the same account whose
token you use can access that published library, then run sync again. If it still returns
0 components, open the file in Figma with that account and confirm the file actually
contains published components.

---

**7. "Figma Variables API requires an Enterprise plan"**

This is a notice, not an error. Figma's Variables endpoint is gated to Enterprise plans;
kotikit detects the 403 and skips it gracefully. Your color, text, and effect **styles**
were still synced normally — only variable-based tokens are unavailable.

Fix: if you are on a Professional plan, open the source design-system file in Figma and
use the kotikit plugin's **Sync Variables From Open File** button. The plugin uses Figma's
Plugin API from your active Figma session, then kotikit merges the result into
`design-system/variables.json`. If you cannot open the source design-system file, you can
still proceed with synced components and styles; custom surfaces and spacing may be less
systematic until variables are imported.

---

## Where to learn more

- `docs/tools.md` — every kotikit MCP tool, with examples.
- `docs/agent_workflow.md` — the shared Claude Code / Codex workflow for
  `/kotikit-auto` and `kotikit:auto`.
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
