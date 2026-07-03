# kotikit

![Kotikit workflow infographic](docs/assets/kotikit-workflow-infographic.webp)

kotikit is a local-first Figma drafting kit for UX/UI work. It helps an
assistant turn a plain-language request into editable Figma screens that reuse
your local design system, icons, variables, and draft-page safety rules.

The product philosophy is simple: less setup, less ceremony, better drafts.
kotikit should feel lightweight, fast, and useful in minutes.

> [!WARNING]
> kotikit is an unstable alpha. Use it on draft files, copies, and experiments.
> Generated designs must be reviewed before they are used for real product
> work.

## What It Does

- Creates Figma screen drafts through the `create-screen` flow.
- Reviews Figma comments and prepares change plans through the `review-screen`
  flow.
- Searches a synced local Figma design-system index instead of dumping large
  files into chat.
- Reuses existing components, icons, variables, and auto layout before falling
  back to simple draft-only primitives.
- Writes only to safe Figma draft pages and kotikit-owned Sections.
- Applies designs incrementally, one screen state at a time, so states stay
  inspectable and non-overlapping.
- Uses screenshot review and compact Figma evidence to catch broken layout,
  missing component instances, and proof overlays.
- Imports variables through the small Figma plugin when the Figma REST
  Variables API is unavailable.

## Current Limits

- There is no polished installer yet.
- Local plugin wrappers are optional; source scaffold is the reliable setup
  path while the project is alpha.
- The Figma plugin only syncs variables.
- kotikit does not generate application code.
- Public PRs are not open yet.
- The repo is source-available only until a license is added.

## Quick Start

Requirements:

- Bun.
- Claude Code, Codex, or another MCP-capable assistant.
- Figma's assistant integration connected to the same assistant.
- A local target folder where kotikit can write `.kotikit/`, `.env`, and
  assistant config.
- A Figma personal access token only if you want local design-system sync. It is
  not required to create drafts through Figma's assistant integration.

From a source checkout:

```bash
git clone https://github.com/captain-pink/kotikit.git ~/kotikit
cd ~/kotikit
bun install
bun run scaffold:agents -- --target /path/to/your/project --agents both
```

Restart your assistant in the target project, then run:

- Claude Code: `/kotikit-auto`
- Codex: `kotikit:auto`

For the full first-run checklist, see
[docs/getting-started.md](docs/getting-started.md).

## Everyday Use

Ask for the outcome in design language:

```text
Use kotikit and create an admin members page on this Figma draft page:
<figma-url>
```

kotikit should:

1. Clarify only what is necessary.
2. Search first in the local design system.
3. Plan the main screen and important states.
4. Write to the bound draft page inside a kotikit Section.
5. Run visual/evidence checks before it says the work is done.

For examples, see [docs/workflows.md](docs/workflows.md).

## Figma Rules

- Use a Figma page whose name includes `Draft` or `Drafts`.
- Let kotikit create or reuse one kotikit-owned Section on that page.
- Keep real design-system components published if you want kotikit to reuse
  them reliably.
- Sync variables with the local plugin only when kotikit says REST variables are
  unavailable.

For setup details, see [docs/figma.md](docs/figma.md).

## Troubleshooting

Most failures are setup or evidence problems:

- The page is not named as a draft page.
- The assistant is not connected to Figma's integration.
- The design-system index is missing or stale.
- A screen was drawn with hardcoded shapes instead of real component instances.
- The screenshot check found overlap, clipping, or broken text.

See [docs/troubleshooting.md](docs/troubleshooting.md).

## Documentation

User docs:

- [Getting Started](docs/getting-started.md)
- [Workflows](docs/workflows.md)
- [Figma Setup](docs/figma.md)
- [Troubleshooting](docs/troubleshooting.md)

Maintainer docs:

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [MCP Tools](docs/tools.md)
- [Coding Guidelines](docs/coding_guidelines.md)
- [Token Budget Reference](docs/TOKENS.md)

## Project Status

kotikit is public for visibility and experimentation. There is no support SLA,
security audit, stable API promise, or public contribution process yet.

No open-source license is currently granted. Until a `LICENSE` file is added,
do not assume permission to redistribute, repackage, or use the code in a
commercial product.
