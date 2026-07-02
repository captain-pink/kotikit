# Coding Guidelines

These guidelines are for any agent or engineer extending kotikit. They capture
the current repo style plus the standards we want to hold as the project grows.

Kotikit should feel like a top-tier local library: boring where it should be
boring, precise at boundaries, easy to test, and hard to misuse.

## Working Rules

- Use Bun as the runtime and test runner.
- Use TypeScript in strict mode.
- Use TDD for behavior changes: write or update the failing test first, then
  implement the smallest change that makes it pass.
- Keep changes scoped to the requested behavior.
- Make atomic commits that follow Conventional Commits, for example
  `feat(mcp): add codex server instructions` or
  `docs(codex): add local setup guide`.
- One commit should represent one coherent idea. Do not bundle docs, tests,
  refactors, and behavior changes unless they are inseparable.

## Design Values

- KISS: choose the simplest implementation that satisfies the behavior.
- DRY: remove meaningful duplication, but do not abstract just because two
  lines look similar.
- YAGNI: do not build future adapters, installers, transports, or settings
  until the current behavior needs them.
- Generic before specific: do not hardcode product, screen, component, icon,
  or flow-specific rules in core logic. Core behavior should be driven by
  typed contracts, schemas, configuration, local design-system indexes, or
  explicit user/project input. For example, icon usage should be planned as a
  design-system-backed affordance in a UI contract, not inferred from labels
  like "invite" or "primary" inside a Figma adapter.
- Local-first: kotikit runs on the user's machine, reads local project state,
  and should not require network services except for explicit Figma sync or
  documented agent setup.
- Agent-neutral core: MCP tools and engines should work for Claude Code,
  Codex, and future agents. Agent-specific setup belongs in docs, skills,
  plugins, or thin wrappers.

## TypeScript Style

- Prefer `const` over `let`.
- Use `let` only when mutation is clearer than rebuilding a value, or when a
  local accumulator is genuinely simpler.
- Prefer declarative array methods such as `.map`, `.filter`, `.reduce`,
  `.flatMap`, `.some`, `.every`, and `.find`.
- Use `for...of` only when it improves clarity, avoids extra passes for a real
  complexity reason, handles async sequencing, or supports early exit.
- Use `while` only for intentionally open-ended traversal or retry logic, such
  as walking parent directories or probing ports.
- Avoid `any`. Use typed inputs, `unknown` at external boundaries, and schema
  parsing to narrow.
- Keep pure functions pure. Do not hide disk, database, network, process, or
  clock access inside helpers that look like transformations.
- Prefer small named helpers over large inline blocks when the helper captures
  a domain concept.
- Use explicit return types for exported functions and public interfaces.

## Boundaries and Validation

- Validate external and persisted data at boundaries with Zod schemas or local
  parsers.
- Keep raw `unknown` inside handlers only long enough to parse or validate it.
- MCP tools should return friendly `KotikitError` messages for user-fixable
  problems and never leak stack traces.
- Do not expose secrets in tool output, test snapshots, logs, or docs.
- Keep tool responses compact. Search indexes first, return refs, and fetch one
  file or component by path when needed.

## Architecture

- Keep MCP handlers thin. They should parse inputs, call module engines, and
  format tool results.
- Put deterministic business logic in modules under `src/spec`, `src/sync`,
  `src/planning`, `src/db`, `src/git`, or `src/util`.
- Prefer pure planner/formatter functions where possible, then wrap them with
  I/O at the edge.
- Reuse local helpers such as `toolText`, `toolError`, `openDb`, path helpers,
  config parsing, and schema constructors.
- Do not add a new dependency until the standard library, Bun, or existing
  local helpers are insufficient.
- Keep implementation-framework behavior out of core modules. If
  design-to-code returns later, it should live behind an extension boundary,
  not in generic MCP or planning code.
- Keep transport-specific behavior at the transport layer. Tool handlers should
  not know whether the caller is stdio MCP, the WebSocket bridge, Claude Code,
  or Codex.

## Testing

- Use `bun test`.
- Follow TDD for new behavior and regressions.
- Prefer focused unit tests for pure functions and parser behavior.
- Use integration-style tool tests for MCP handlers, filesystem writes,
  design-system indexes, review storage, and commits.
- Seed temporary projects under the OS temp directory and clean them up in
  `afterEach`.
- Stub external binaries or gate runners in tests unless the test explicitly
  verifies command execution.
- Test friendly errors, not only happy paths.
- When changing docs only, tests are usually not required; still run targeted
  text scans if the docs reference current APIs or commands.

## Local Quality Gates

- Use `bun run check` for the fast local quality pass. It runs Biome on changed
  files and cspell across the repo through Bun.
- Use `bun run check:biome` for formatting, import organization, and lint
  diagnostics on files changed from `main`.
- Use `bun run check:spelling` for spell checks. The script runs
  `bunx --bun cspell` so it follows the repo's Bun-first runtime policy instead
  of depending on the system Node version.
- Use `bun run check:unused` to run Knip and inspect unused files, exports,
  exported types, dependencies, and binaries. This command is intentionally not
  part of `bun run check` yet because the repo may contain known cleanup
  candidates that need human review.
- Use `bun run fix:unused` only after reviewing the Knip report. It can remove
  unused exports and dependencies, then format the changed files.
- Use `bun run fix:unused:files` only when you explicitly intend to let Knip
  delete unused files. Review the diff carefully before committing.
- Git hooks are installed with Husky. Pre-commit runs lint-staged on staged
  files and `bun run typecheck`, commit-msg enforces Conventional Commits, and
  pre-push runs `bun test`.
- Keep the cspell dictionary focused on project vocabulary, product names,
  fixture tokens, and intentional technical terms. Do not use it to hide real
  typos.

## Git and Generated Work

- Auto-commits must stage only the files they created or updated.
- Never push, create branches, or mutate remote configuration from kotikit.
- Commit messages must follow Conventional Commits.
- Generated commit bodies must use the configured co-author identity and must
  not misattribute work to a different agent.
- Do not commit ephemeral bridge files, apply logs, local secrets, or agent
  private config.

## Documentation

- Keep live docs current: `README.md`, `docs/getting-started.md`,
  `docs/workflows.md`, `docs/figma.md`, `docs/troubleshooting.md`,
  `docs/development.md`, `docs/architecture.md`, `docs/tools.md`, and
  `docs/modules/*`.
- Keep live docs concise. Do not add large one-off planning documents to the
  root or `docs/`; capture durable decisions in the relevant module doc or
  `NEXT_STEPS.md`.
- Use agent-neutral language in shared docs. Use "Claude Code" or "Codex" only
  when the instruction is specific to that product.
- Document setup as copy-pasteable commands or config blocks.
- Include local verification steps for any new integration surface.

## Error Handling

- Use `KotikitError` for user-actionable failures.
- Keep system errors generic in MCP responses.
- Include hints when the next action is obvious, such as installing a missing
  gate tool or checking a scope name.
- Do not swallow errors silently unless the operation is explicitly best-effort
  and the caller can still proceed safely.

## Performance and Token Discipline

- Never load a whole manifest, icon list, design-system directory, or database
  into an agent context for lookup.
- Use SQLite search or registry queries to find candidates, then fetch exact
  files by path.
- Prefer pagination for potentially large tool responses.
- Avoid repeated prompt payloads. Use `systemPromptRef` and
  `kotikit_get_system_prompt` for long doctrines.
- Optimize for clear asymptotic behavior before micro-optimizing small code.

## When Loops Are Acceptable

Declarative code is preferred, but loops are acceptable when they are the right
tool:

- `for...of` for async sequencing where order matters.
- `for...of` for early return or early break that avoids unnecessary work.
- `for...of` when merging multiple side effects into one pass gives a real
  time-complexity benefit.
- `while` for unbounded traversal, retry, or polling where the exit condition
  is discovered during execution.

When using a loop, keep the body small and make the exit condition obvious.

## Review Checklist

Before considering work complete:

- The behavior is covered by a focused test, unless the change is docs-only.
- `bun test` or the relevant targeted test command passes.
- TypeScript types are explicit at public boundaries.
- Tool output is friendly, compact, and secret-safe.
- The change does not couple core logic to one agent.
- The commit is atomic and uses Conventional Commits.
