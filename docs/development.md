# Development

This guide is for people editing kotikit itself.

## Setup

```bash
cd ~/kotikit
bun install
```

Use Bun for runtime, tests, and project scripts.

## Daily Commands

```bash
bun run format
bun run check
bun run typecheck
bun test
```

`bun run check` runs Biome on changed files and cspell across the repo.

## Dead-Code Analysis

Knip is configured for root TypeScript files and the Figma plugin workspace.

Inspect unused files, exports, exported types, dependencies, and binaries:

```bash
bun run check:unused
```

Remove unused exports and dependencies only after reviewing the report:

```bash
bun run fix:unused
```

Let Knip delete files only when that is the explicit cleanup goal:

```bash
bun run fix:unused:files
```

Always review the diff and rerun the normal checks before committing.

## Git Hooks

Husky is installed through the `prepare` script.

- Pre-commit runs lint-staged and `bun run typecheck`.
- Commit messages are checked with Conventional Commits.
- Pre-push runs `bun test`.

Use small atomic commits. A commit should represent one coherent idea.

## Testing Style

Behavior changes should be test-first:

1. Add or update the focused failing test.
2. Run the target `bun test` command and confirm it fails for the expected
   reason.
3. Implement the smallest change.
4. Rerun the focused test.
5. Run the relevant broader checks.

Docs-only changes usually do not need new tests, but run format and spell
checks.

## Documentation Rules

- Keep the README as the product front page.
- Put setup details in `docs/getting-started.md`.
- Put Figma details in `docs/figma.md`.
- Put workflow examples in `docs/workflows.md`.
- Put module internals in `docs/modules/*`.
- Keep tool details in `docs/tools.md`.

Do not commit local agent scratch files such as `docs/superpowers/*` or
`.claude/*` scratch directories.

## Figma Plugin Development

Build and test the plugin:

```bash
cd figma-plugin
bun install
bun run build
bun test
```

The sandbox bundle must remain compatible with Figma's plugin runtime. Do not
raise the sandbox build target without verifying the generated `dist/code.js`
does not contain unsupported syntax.

## Release Hygiene

kotikit is still source-available alpha software, not a published package.

Before sharing a new snapshot:

- Run `bun run format`.
- Run `bun run check`.
- Run `bun run typecheck`.
- Run `bun test`.
- Refresh scaffolded skills in a sample target project.
- Run `kotikit doctor` in that target project.
