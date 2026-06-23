# kotikit

Create Figma-ready product drafts from plain language, using your real design
system.

kotikit is a local-first MCP toolkit for Claude Code, Codex, and other
MCP-capable agents. It helps an agent ask the right product questions, save a
structured screen spec, sync your Figma design system, compose safe Figma draft
pages, review designs, and remember repeated design feedback.

```text
Product idea -> guided questions -> local spec -> Figma DS sync -> safe draft page -> review -> design memory
```

## Public Alpha

kotikit is a public alpha showcase. The repository is public so people can see
the direction, try it locally, and inspect the agentic workflow.

It is not a mature open-source project yet:

- Public PRs are not being accepted right now. I do not have capacity to review
  external contributions properly.
- There is no support SLA.
- APIs, local file formats, and workflows may change.
- The project was built through AI-assisted/vibe-coded development and still
  needs deeper independent security, architecture, and production-quality
  review.
- Use it for experiments, drafts, and controlled Figma files first. Do not
  point it at critical production files until you understand the workflow and
  risks.

Design-to-code is intentionally not part of the guided workflow yet. kotikit is
currently focused on stabilizing the design creation and review loop.

## Why This Exists

Most people can describe the product screen they need, but cannot quickly create
a useful Figma draft. Product managers and founders can explain a workflow, but
often need a designer to turn that into a concrete screen. Designers lose time
on repetitive first drafts, table layouts, forms, states, and review loops.
Engineers get pulled into implementation before the design is clear.

AI agents can help, but generic AI UI output usually has the same problems:

- It ignores your actual design system.
- It invents components that do not exist.
- It produces layouts that look plausible but fall apart in Figma.
- Feedback gets lost in comments instead of becoming reusable project memory.

kotikit is an experiment in closing that gap: let anyone describe what they
need, then let an agent use structured specs, your Figma library, safe draft
targets, and review memory to create something inspectable.

## Demo

A 1-minute demo video will live here.

The demo will show kotikit taking a rough request like "build a members admin
page", asking clarifying questions, syncing a design system, creating a Figma
draft, then running a design review.

## Who It Is For

- **Product managers and founders** who want to turn a rough product idea into
  an inspectable design draft without learning Figma deeply.
- **Designers** who want an agent to handle repetitive screen drafting,
  state coverage, comment review, and design-system lookup while they keep
  creative control.
- **Engineers** who want agent-generated design work to be structured before it
  turns into implementation work.
- **Agent workflow builders** who want to inspect a local-first MCP/Figma
  workflow that combines specs, SQLite indexes, assistant skills, and a Figma
  plugin bridge.

## What Works Today

kotikit currently supports:

- Guided screen and flow specification through Claude Code or Codex.
- Local specs stored under `.kotikit/specs`.
- Figma design-system sync into local SQLite indexes.
- Adaptive Figma API pacing and resumable design-system sync for larger files.
- Design-system component and icon search for agents.
- Safe Figma draft target binding.
- A Figma plugin bridge for applying generated design plans.
- Variable import fallback through the Figma plugin for non-Enterprise Figma
  plans.
- Browserless Figma comment review.
- Standalone design-quality review for exact Figma pages, sections, frames, or
  components.
- Optional posting of approved review comments back to Figma.
- Local design memory from repeated review adjustments.
- Assistant scaffold for Claude Code and Codex.

## What Does Not Work Yet

kotikit is not ready for everything:

- Guided design-to-code is disabled. It is planned for a later stage after
  design creation is stable.
- There is no polished npm/homebrew/global installer yet.
- The Figma plugin is functional but still young.
- The review workflow is useful, but not a replacement for a senior designer.
- Public contributions are not open yet.
- There is no formal security audit.

## How It Works

kotikit has four main pieces:

1. **MCP server**  
   Claude Code, Codex, and other MCP clients call `kotikit_*` tools.

2. **Local project state**  
   Specs, config, design review state, design memory, and bridge state live in
   the target project under `.kotikit`.

3. **Design-system indexes**  
   Figma components, icons, styles, and variables are synced into
   `design-system/` so agents can search instead of loading huge files into
   context.

4. **Figma plugin bridge**  
   The optional plugin connects the open Figma file to the local MCP server so
   kotikit can apply draft designs and import variables through Figma's Plugin
   API.

## Safety Model

kotikit is designed to be local-first and conservative:

- No hosted backend is required.
- Your Figma token stays in your target project's `.env`.
- Large design-system data is stored locally and searched through SQLite.
- Figma design creation is blocked until you bind an exact draft page URL.
- The target Figma page name must contain `Draft` or `Drafts`.
- Generated screens are placed inside a kotikit-owned Figma Section.
- Apply-step logging validates file, page, and Section metadata.
- Figma review comments are never posted without explicit approval.

This does not make kotikit production-safe by itself. It just gives the workflow
clear boundaries while the project is still alpha.

## Requirements

- macOS or another environment with Bun available.
- Bun.
- Claude Code, Codex, or another MCP-capable assistant.
- A Figma personal access token with at least File read scope.
- A local target project folder where kotikit can store `.kotikit/`,
  `design-system/`, and `.env`.

A React/Vite project is fine even though kotikit does not generate app code in
the guided workflow yet:

```bash
bun create vite my-app --template react-ts
cd my-app
bun install
git init
```

## Quickstart

### 1. Install Bun

Skip this if `bun --version` already works.

```bash
curl -fsSL https://bun.sh/install | bash
```

Close and reopen your terminal after installing Bun.

### 2. Clone kotikit

```bash
git clone https://github.com/captain-pink/kotikit.git ~/kotikit
cd ~/kotikit
bun install
```

### 3. Scaffold your assistant config

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
- `kotikit-auto` and `kotikit-design-review` skills.
- `.env` with a `FIGMA_TOKEN=` placeholder if needed.

### 4. Add your Figma token

Create a Figma personal access token in Figma account settings, then put it in
the target project's `.env` file:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

For design-system sync, File read is required. For posting review comments,
`file_comments:write` is required.

### 5. Restart your assistant

Restart Claude Code or start a fresh Codex session in the target project.

Then run `/mcp` and confirm the `kotikit_*` tools are listed.

Start the guided workflow:

- Claude Code: `/kotikit-auto`
- Codex: `kotikit:auto`

Start focused design review:

- Claude Code: `/kotikit-design-review`
- Codex: `kotikit:design-review`

## First Workflows

### Sync A Figma Design System

Ask your assistant:

> Sync my Figma design system.

If kotikit is not configured yet, the assistant will walk through setup first.
Then it will ask for the Figma file URL or file key and run `kotikit_sync_ds`.

kotikit syncs published components, component sets, icons, styles, and available
variables into a local `design-system/` index.

Important Figma note: published components are required. If a Figma file is not
published as a team library, Figma's published-component API will return zero
usable components.

### Create A Figma Draft

Ask:

> I want to build a members admin page.

The agent will ask product/design questions until the screen is clear, save a
local spec, and offer to create or refine the Figma design.

For Figma creation, kotikit will ask for an exact draft page link. Use a page
whose name contains `Draft` or `Drafts`, and copy a link that includes
`node-id`.

The assistant will start the local Figma plugin bridge, then the plugin applies
the design inside a kotikit-owned Section on that draft page.

### Review Existing Figma Comments

Ask:

> Review the Figma comments for the Members screen.

kotikit reads comments through the Figma API, maps comments on known nodes back
to generated design nodes when possible, and stores a compact review session in
`.kotikit/design-review.db`.

### Run A Design-Quality Review

Ask:

> Review this Figma design like a design director: https://www.figma.com/design/...

The link must include `node-id`.

kotikit gathers bounded evidence instead of reading the full Figma file:

- shallow target metadata
- limited child-region summaries
- temporary screenshot URL when available
- optional local cache row with schema/fingerprint/expiry

The agent records structured findings, summarizes the design review, then asks
whether you want selected comments posted back to Figma.

### Import Variables On Non-Enterprise Figma Plans

Figma's REST Variables API is Enterprise-gated. If sync says variables were
skipped, use the plugin fallback:

1. Ask your assistant: "Start the kotikit Figma plugin bridge."
2. Open the source design-system file in Figma.
3. Run Plugins -> Development -> kotikit.
4. Paste the bridge URL.
5. Click **Sync Variables From Open File**.

The plugin reads variables from the open Figma file using Figma's Plugin API and
sends a compact payload to kotikit over the local bridge.

## Figma Plugin

The plugin is optional for design-system search and comment reading, but needed
for applying generated draft designs and importing variables through the plugin
fallback.

Build it once:

```bash
cd ~/kotikit
bun run plugin:build
```

Import it in Figma:

```text
Plugins -> Development -> Import plugin from manifest -> ~/kotikit/figma-plugin/manifest.json
```

Normally you do not run the bridge manually. Ask the assistant:

> Start the kotikit Figma plugin bridge.

The assistant calls `kotikit_bridge_start`, prepares the plugin build if needed,
patches the plugin manifest for the selected localhost port, and gives you a
one-time `ws://localhost:...?...` URL to paste into the plugin.

## Updating kotikit

In the kotikit repo:

```bash
cd ~/kotikit
git pull --ff-only
bun install
```

Then refresh the copied assistant skills/config in each target project:

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-project --agents both
```

If you previously customized copied skill files, scaffold may skip them to avoid
overwriting local changes. If you did not customize them, remove the old copied
skill folders and rerun scaffold.

## Roadmap

Near term:

- Make Figma draft creation more reliable across different design systems.
- Improve design-review drilldown without increasing token usage.
- Improve the Figma plugin UX.
- Tighten cache invalidation and migration safety.
- Improve docs and demo material.

Later:

- Production-quality installer.
- Stronger design-system component creation workflow.
- Better variable/library import flows.
- Richer design-review reporting.
- Design-to-code once design creation is stable.

Not promised yet:

- Hosted/cloud service.
- Public plugin marketplace distribution.
- Public contribution process.
- Production design-to-code.

## Project Status And Contributions

This repository is public for visibility and experimentation.

Public contributions are not open yet. Please do not open PRs expecting review
or merge. The project needs more stabilization before it can responsibly accept
outside work.

Feedback is useful, but there is no issue triage process or support guarantee
right now.

## License

No open-source license is currently granted.

Until a `LICENSE` file is added, the repository is source-available for review
and local experimentation only. Do not assume permission to redistribute,
repackage, or use the code in a commercial product.

This may change later once the project is more stable and the intended public
license is chosen.

## Troubleshooting

### kotikit tools do not appear in `/mcp`

Rerun scaffold for the target project, restart the assistant, and confirm the
paths in `.mcp.json` or `.codex/config.toml` point to your local kotikit clone.

### Figma token is missing or invalid

Make sure the target project's `.env` file contains:

```env
FIGMA_TOKEN=figd_...
```

The file should live in the target project root, not inside the kotikit repo.

### Sync returns zero components

The Figma design-system file must be published as a library. Figma's published
component endpoints do not return unpublished local components.

### Variables are skipped

This is expected on non-Enterprise Figma plans when using the REST API. Use the
Figma plugin variable import fallback.

### Old kotikit files are reported

kotikit reads older specs lazily and upgrades files only when it edits them. To
inspect a target project's artifacts without changing anything, run this from
that target project:

```bash
bun run /path/to/kotikit/src/cli.ts migrate --dry-run
```

## More Docs

- [docs/tools.md](docs/tools.md) - every MCP tool.
- [docs/agent_workflow.md](docs/agent_workflow.md) - shared Claude/Codex
  workflow.
- [docs/coding_guidelines.md](docs/coding_guidelines.md) - engineering style
  used inside the repo.
- [docs/TOKENS.md](docs/TOKENS.md) - token-cost strategy.
- [NEXT_STEPS.md](NEXT_STEPS.md) - internal roadmap and future work.
