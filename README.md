# kotikit

kotikit turns your Figma design system into real, working React code — through a conversation
with Claude. You describe a screen, Claude asks the right questions, kotikit saves a precise
spec. Then kotikit pulls your Figma components, generates the screen as React code, and saves
everything as you go. No code to write. No developer to chase.

---

## Who this is for

Designers who use [Claude Code](https://claude.com/claude-code) in VS Code, have a Figma
design system, and want to ship screens as React components without writing the code by hand.
You do not need to know React, git commands, or anything about the terminal beyond copy-paste.

---

## Prerequisites

- **Bun** — a fast JavaScript runtime (one install command below).
- **Claude Code** — the AI coding assistant that runs inside VS Code.
  [Install it from the VS Code Marketplace.](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code)
- **A Figma personal access token** — open Figma, go to Settings → Account → Personal access
  tokens, and create one with the "File read" scope. Copy it somewhere safe.
- **Your project should be a folder tracked by version control** — if you are not sure, open
  your project folder in Terminal and run `git init`. That is all you need.

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

**4. Add kotikit to Claude Code's MCP config.**

Create (or open) the file `.claude/mcp.json` in your project folder and add the block below.
If the `.claude/` folder does not exist yet, create it first.

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

**5. Restart Claude Code** (Cmd+Shift+P → "Developer: Reload Window" in VS Code).

That is it. Open your project in VS Code and Claude Code will now have kotikit available.

---

## Your first hour with kotikit

### 30 seconds: sync your design system

Open Claude Code in your project and type:

> *"Check if kotikit is set up here."*

If kotikit is not yet configured for this project, Claude will walk you through a short setup
conversation — about two minutes, no technical knowledge required.

Then type:

> *"Sync my Figma design system."*

Claude will ask for your Figma file URL (or you can paste it during setup). It pulls every
component from Figma into a local snapshot that kotikit uses to generate code. You will see
a count like "Sync complete: 48 components, 312 icons."

You only need to sync again when your Figma components change.

---

### 3 minutes: build your first screen

Type:

> *"I want to build a login screen."*

Claude starts a conversation. It will ask you about:

- Who uses this screen and what they are trying to do.
- What the user sees first, and what they can do from there.
- What happens when something goes wrong (wrong password, no account yet).
- Any edge cases specific to your product.

Answer naturally — full sentences or bullet points, whichever feels easier. Claude will keep
asking until the picture is complete. When it is, Claude summarizes the screen back to you:

> "Here is what I have: a login screen for returning users, with an email and password field,
> a 'Forgot password' link, and a primary 'Log in' button. On failure, an inline error
> appears below the password field without clearing the email. On success, the user lands on
> the dashboard. Does this look right?"

Confirm (or ask for changes), and kotikit saves the spec. Then type:

> *"Write the code for the login screen."*

Claude generates a production-ready React component using your Figma components, with
accessibility, keyboard navigation, and error handling included. It saves the file and records
a save-point automatically.

---

### 1 minute: scaffold your design system as code

If you want React component files generated directly from your Figma components (without
designing a full screen first), type:

> *"Scaffold my design system components."*

Claude will walk through your unscaffolded Figma components in small batches, generate a
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

---

## Working with the Figma plugin

kotikit ships a Figma plugin that connects your Figma session to the same kotikit running in
VS Code.

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

This prints a URL like `ws://localhost:53124?token=abc123`. Copy it.

In Figma: Plugins → Development → kotikit → paste the URL into the Connect dialog.

**What the plugin currently does:**

- Connects your Figma file to the running kotikit session.
- Lets you inspect the link between a Figma component and its code counterpart.

**What is coming:** A full plan-checklist view inside the plugin — click a screen in Figma,
see the spec and implementation status without leaving Figma. See `NEXT_STEPS.md` for the
full list.

---

## Keeping conversations cheap

Claude has a conversation budget. kotikit is designed to stay well inside it — tool responses
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

After kotikit commits your generated code, you can ask Claude to visually validate it. If
you have [Chrome DevTools MCP](https://github.com/modelcontextprotocol/servers) installed
alongside kotikit, type:

> *"Open localhost:6006 and take a screenshot of the login screen."*

Claude will open your Storybook or dev server and validate the rendered output against what
you described. Chrome DevTools MCP is a separate tool that Claude orchestrates alongside
kotikit — kotikit handles the spec and code, Chrome DevTools MCP handles the live browser.
Neither one depends on the other.

---

## Troubleshooting

**1. "Your Figma token is missing or invalid."**

kotikit could not find or use your Figma personal access token.

Fix: create a file named `.env` in your project folder with this line:

```
FIGMA_TOKEN=your_token_here
```

Replace `your_token_here` with the token you copied from Figma Settings → Account → Personal
access tokens. Make sure the token has the "File read" scope. The `.env` file is never
committed to your repository.

If your team uses 1Password, you can instead set the token field in `.kotikit/config.json`
to `op://vault-name/item-name/field-name` and kotikit will fetch it via the 1Password CLI.

---

**2. "Some required gate tools aren't installed in your project."**

The code quality checks kotikit runs before saving code need a few dev tools in your project.

Fix: in your project folder, run:

```bash
bun add -d typescript eslint eslint-plugin-jsx-a11y prettier vitest
```

Then try again.

---

**3. "No registry yet — run sync_ds first."**

kotikit tried to audit or scaffold but has not synced your design system yet.

Fix: type *"Sync my Figma design system."* in Claude Code. After sync completes, try the
audit or scaffold command again.

---

**4. "Storybook not detected — story files skipped."**

This is a notice, not an error. kotikit looked for Storybook in your project and did not
find it, so it skipped generating `.stories.tsx` files.

Fix: if you want story files, install Storybook (`npx storybook@latest init`) and run the
scaffold command again. If you do not use Storybook, you can ignore this message entirely.

---

**5. "That file path is outside your scaffold directory."**

kotikit refused to write a file outside the components folder it is configured to use.

Fix: do not move generated component files to a different location before saving them.
If you need the components folder to be somewhere else, update the `codeComponentsDir` path
in your kotikit config by asking Claude: *"Change my components folder to src/ui."*

---

## Where to learn more

- `docs/tools.md` — every Claude command kotikit understands, with examples.
- `docs/modules/` — how each piece of kotikit works under the hood (for engineers or
  curious designers).
- `docs/TOKENS.md` — keeping conversations cheap: what costs tokens and how to reduce it.
- `NEXT_STEPS.md` — what is coming in future versions.
- `planning/` — the build-by-build design rationale (written for engineers; skippable).

---

## License

MIT.
