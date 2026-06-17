# AGENTS.md

Follow [docs/coding_guidelines.md](docs/coding_guidelines.md) before changing
code in this repository.

Use Bun for runtime, tests, and project scripts. For behavior changes, work
test-first: add or update the focused failing test, implement the smallest
change, then run the relevant `bun test` target.

Keep core modules agent-neutral. Claude Code, Codex, and future assistants
should share the same MCP tools and engines; product-specific behavior belongs
in docs, skills, plugins, or thin setup wrappers.

Use atomic Conventional Commits for completed implementation slices.
