# Getting Started

This is the shortest reliable setup path while kotikit is alpha.

## 1. Install Bun

kotikit runs on Bun. If you do not have it yet, install Bun from the
[official Bun installation guide](https://bun.sh/docs/installation).

After installing, open a new terminal window and check:

```bash
bun --version
```

## 2. Install Kotikit From Source

```bash
git clone https://github.com/captain-pink/kotikit.git ~/kotikit
cd ~/kotikit
bun install
```

## 3. Pick A Target Folder

kotikit needs a normal local folder for assistant config, run state, and local
design-system indexes. For design-only testing this can be an empty scratch
folder.

```bash
mkdir -p ~/kotikit-demo
```

## 4. Scaffold Your Assistant

```bash
cd ~/kotikit
bun run scaffold:agents -- --target ~/kotikit-demo --agents both
```

Use `--agents codex` or `--agents claude` if you only need one assistant.

The scaffold writes:

- `.kotikit/config.json`
- `.env`
- Codex and/or Claude Code MCP config
- kotikit assistant skills

Plugin wrappers are optional. Source scaffold is the most predictable path for
local development and testing.

## 5. Connect Figma

Install and enable Figma's assistant integration for your assistant. kotikit
uses that integration for Figma reads, writes, screenshots, and metadata.

A Figma personal access token is not required to create drafts. Add one only
when you want local design-system sync:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

Keep `.env` local and uncommitted.

## 6. Restart The Assistant

Open the target folder in your assistant and restart the session so it reloads
the MCP config.

Run:

- Claude Code: `/kotikit-auto`
- Codex: `kotikit:auto`

Then ask for a screen:

```text
Use kotikit and create an admin members page on this Figma draft page:
<figma-url>
```

## 7. Sync A Design System

Do this when you want kotikit to reuse your real components and icons.

```text
Use kotikit to sync this published Figma library:
<figma-library-url>
```

kotikit stores the searchable index in the target project. The assistant should
search first, fetch exact component details only when needed, and avoid loading
large design-system files into chat.

## 7. Sync Variables If Asked

Figma REST variables are not available on every plan. If kotikit says variables
are unavailable, run the local Figma plugin in the file and export variables.
Then continue the same assistant run.

The plugin only syncs variables. It does not create screens or review designs.

## Safe Defaults

The scaffold auto-approves only non-destructive local read tools such as flow
listing, artifact reads, design-system search, icon search, and config status.

Figma writes, graph mutations, sync jobs, bridge control, and secret-related
actions still require approval.

## Verify Setup

In the target project, ask kotikit for setup status:

```text
Run kotikit doctor.
```

Healthy setup means:

- the kotikit MCP server starts,
- the Figma assistant integration is available,
- the target folder has `.kotikit/config.json`,
- design-system search works after sync,
- draft pages can be bound when their page name includes `Draft`.

Next: [Workflows](workflows.md).
