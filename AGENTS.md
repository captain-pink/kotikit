# AGENTS.md

Follow [docs/coding_guidelines.md](docs/coding_guidelines.md) before changing
code in this repository.

Kotikit's core philosophy is lightweight, fast, designer-first, and highly
useful: preserve the designer's product intent, create editable Figma work in
minutes, and prefer the smallest reliable system over broad framework
machinery.

Do not add core logic that turns rich product requests into fixed keyword
templates. Incidental words in a PRD, domain list, or feature name must not
hijack the brief, screen title, UX archetype, required UI parts, canvas mode, or
variable bindings. Prefer explicit typed input, validated graph artifacts,
local design-system evidence, and low-confidence clarification over canned
substring classifiers.

Evidence and QA gates must prove the visible design is correct; they must not
shape the design into proof overlays, hidden component instances, or generic
token bindings that do not match the UI's semantic roles.

Use only mocked product, company, customer, and user data in tests, fixtures,
docs, and examples. Never copy real customer data into this repository.

Use Bun for runtime, tests, and project scripts. For behavior changes, work
test-first: add or update the focused failing test, implement the smallest
change, then run the relevant `bun test` target.

Agents must always work on a dedicated issue or feature branch. Direct commits
to `main` are not allowed.

Keep core modules agent-neutral. Claude Code, Codex, and future assistants
should share the same MCP tools and engines; product-specific behavior belongs
in docs, skills, plugins, or thin setup wrappers.

Use atomic Conventional Commits for completed implementation slices.
