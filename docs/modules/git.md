# Git

## What it does

The git module provides the auto-commit machinery that records kotikit's work as local version history. Every time a spec is saved or code is generated, a conventional commit is created automatically if the project is a git repository and `config.git.autoCommit` is enabled. The module never pushes, never creates branches, and never modifies git configuration — it only stages specific files and commits them with a structured message and a `Co-authored-by` footer.

## Public surface

**Core** (`src/git/auto-commit.ts`)
- `autoCommit(opts)` — the generic commit function; stages the listed files, checks for staged changes, creates the commit; returns `CommitResult`
- `AutoCommitOpts` — `{ root, scope, kind, files, enabled, coAuthor?, subjectScope?, subjectSuffix? }`
  - `root` — project root (must be a git repo)
  - `scope` — the spec scope name, used in the commit subject
  - `kind` — `"create"` or `"update"`
  - `files` — absolute paths to stage; `autoCommit` converts them to repo-relative paths before staging
  - `enabled` — when `false`, returns immediately without touching git
  - `coAuthor` — optional `{ name, email }` footer identity; defaults to Claude Code for backward compatibility
  - `subjectScope` — `"spec"` (default) or `"code"` — determines the conventional-commit scope marker
  - `subjectSuffix` — optional string appended after `scope` in the subject (e.g. `"/cart"` for a flow screen)
- `CommitResult` — `{ committed: boolean, reason?: string, sha?: string, message: string }`
- `CommitKind` — `"create" | "update"`

**Convenience wrappers**
- `autoCommitSpec(opts)` — Phase 1 backwards-compatible alias; calls `autoCommit` with the default `subjectScope: "spec"`
- `autoCommitCode(opts)` (in `src/codegen/code-commit.ts`) — Phase 3 wrapper; calls `autoCommit` with `subjectScope: "code"` and constructs `subjectSuffix` from `screen`

**Git utilities**
- `isGitRepo(root)` — run `git rev-parse --git-dir`; returns `boolean`; never throws
- `gitInit(root)` — initialize a new local repository; does not add a remote

## How it works

The commit subject follows the Conventional Commits format: `feat(<subjectScope>): <kind> <scope><subjectSuffix>`. Examples:
- `feat(spec): create checkout-flow` — a new single-screen or flow spec
- `feat(spec): update login` — an updated spec
- `feat(code): create checkout-flow/cart` — generated code for a flow screen
- `feat(code): create login` — generated code for a single-screen scope

Every commit body ends with a `Co-authored-by` footer on its own line, preceded by a blank line. The default is `Claude Code <noreply@anthropic.com>` for backward compatibility, but projects can configure a different `git.coAuthor`, such as Codex. The footer is included even when `subjectSuffix` is empty.

`autoCommit` uses `simple-git` for all git operations. Before committing it calls `isGitRepo` — if the project is not tracked by git, it returns `{ committed: false, reason: "not a git repo" }` without error. After staging, it reads `git.status()` and checks `staged`, `created`, and `renamed` entries; if nothing is staged (e.g. the file was unchanged since the last commit), it returns `{ committed: false, reason: "no changes" }`. This makes auto-commit safe to call unconditionally — callers do not need to pre-check whether there is anything to commit.

`gitInit` is called by the MCP `kotikit_config_init` tool during the init conversation when the designer agrees to enable save-point history and the project is not already a git repository. kotikit never uses the term "git" or "commit" in conversation — the init wizard calls this feature a "save-point system."

## When to extend it

- Adding a new commit subject scope (e.g. `"design"` for Figma apply commits) — extend the `subjectScope` union in `AutoCommitOpts` from `"spec" | "code"` to include the new value; create a wrapper function in the relevant module (following the `autoCommitCode` pattern in `src/codegen/code-commit.ts`).
- Signing commits (e.g. GPG) — `simple-git` accepts git config passthrough; add a `signingKey` option to `AutoCommitOpts` and pass it via `git.env({ GIT_COMMITTER_NAME: ... })` before `git.commit(...)`.
- Changing the co-authored-by footer — prefer `config.git.coAuthor`; the footer is applied to every commit including those from convenience wrappers.
- Adding a tag after a commit (e.g. for spec versioning) — add an optional `tag` field to `AutoCommitOpts` and call `git.addTag(tag)` after a successful commit.

## Related

- [spec](./spec.md) — `autoCommitSpec` is called by the spec and flow write paths after every successful `writeScreenSpec` / `writeFlowManifest`
- [codegen](./codegen.md) — `autoCommitCode` (in `src/codegen/code-commit.ts`) wraps `autoCommit` for the code generation path
- [config](./config.md) — `config.git.autoCommit` controls whether commits are enabled; tools pass this value as `enabled`
- [mcp](./mcp.md) — the `kotikit_config_init` tool calls `gitInit` during project setup
- `planning/phase-1.md` — auto-commit design; conventional commit format rationale
