# DB

## What it does

The db module wraps `bun:sqlite` with the conventions kotikit uses everywhere:
WAL journal mode, normal synchronous writes, foreign key enforcement, and a thin
transaction helper. On top of that base it owns three SQLite databases: a
full-text-search components store, a full-text-search icons store, and a design
review ledger that stores comment review state, standalone design-quality
reviews, bounded Figma evidence cache rows, and project design preferences. It
also provides the CamelCase token splitter that makes component names searchable
by their parts.

## Public surface

**SQLite base** (`src/db/sqlite.ts`)
- `openDb(path)` — open a database, create parent directories, apply WAL + synchronous-NORMAL + foreign-keys pragmas
- `withTransaction(db, fn)` — run `fn` inside a bun:sqlite transaction; commits on return, rolls back on throw

**Components FTS5 database** (`src/db/components-db.ts`)
- `ComponentRow` — `{ name, path, key, fileKey, props }` (props is a space-separated string of Figma property names)
- `ComponentSearchResult` — subset returned by searches
- `initComponentsDb(db)` — create the `components` FTS5 virtual table if absent
- `upsertComponent(db, row)` — DELETE then INSERT (FTS5 has no native UPSERT); caller holds the transaction
- `searchComponents(db, queryTerm, limit?)` — FTS5 MATCH search, ordered by rank
- `clearComponents(db)` — test helper / re-sync use

**Icons FTS5 database** (`src/db/icons-db.ts`)
- `IconRow` — `{ name, key, signal, fileKey }`
- `initIconsDb(db)` — create the `icons` FTS5 virtual table
- `upsertIcon(db, row)` — DELETE then INSERT
- `searchIcons(db, queryTerm, limit?)` — FTS5 MATCH search
- `getIconSvg(db, key)` — retrieve SVG content by Figma key
- `clearIcons(db)` — test helper

**Design review database** (`src/db/design-review-db.ts`)
- `openDesignReviewDb(root)` — open `.kotikit/design-review.db`, initialize tables, and return the review store
- `upsertReviewTargetCache(input)` / `getReviewTargetCache(input)` — store and read versioned shallow Figma evidence cache rows; cache hits require matching schema version, source fingerprint, and expiry
- `recordDesignAuditSession(input)` — persist a standalone design-quality review target, brief, and bounded evidence bundle
- `recordDesignAuditFindings(input)` — persist structured findings authored by the reviewing agent
- `prepareDesignAuditComments(input)` — create pending root-comment outbox rows for commentable findings
- `markDesignAuditCommentPosted(input)` / `markDesignAuditCommentFailed(input)` — update standalone design-review comment outbox state after Figma API calls
- `getDesignAuditReport(input)` — return compact audit findings and pending root comments
- `recordReviewSession(input)` — persist a comment-reading pass and compact comment rows
- `recordDesignAdjustment(input)` — persist a micro-adjustment and mark linked comments fixed
- `prepareCommentReplies(input)` — create pending reply outbox rows for fixed comments
- `markReplyPosted(input)` / `markReplyFailed(input)` — update reply outbox state after Figma API calls
- `getReviewReport(input)` — return compact session summary, comments, adjustments, and pending replies
- `listPreferenceCandidates(input)` — return repeated-feedback candidates
- `promotePreferenceCandidate(input)` — turn a candidate into an active design preference
- `searchDesignPreferences(input)` — fetch active preferences relevant to a future design task

**CamelCase tokenizer** (`src/db/camel-tokens.ts`)
- `buildNameTokens(name)` — produce the `name_tokens` column value: the original string plus each split token, deduplicated, joined with spaces

## How it works

Both `components.db` and `icons.db` use FTS5 virtual tables with the `unicode61 remove_diacritics 2` tokenizer. FTS5's built-in unicode61 tokenizer handles accented characters and case folding without needing the Porter stemmer, which would cause false matches ("icon" matching "iconography" stems). This choice trades some recall for much higher precision on short component names.

Because FTS5 virtual tables do not support SQL `INSERT OR REPLACE`, `upsertComponent` and `upsertIcon` use DELETE-then-INSERT within the caller-provided transaction. The `name_tokens` column is denormalized — it stores the original name plus its CamelCase-split parts (`"ButtonGroup"` → `"ButtonGroup Button Group"`), letting the FTS5 engine find `"Button"` when searching for a `ButtonGroup` component. `buildNameTokens` handles acronyms (`"HTTPSConfig"` → `"HTTPSConfig HTTPS Config"`), letter-to-digit transitions, and separator normalization.

The design review database is intentionally compact. It does not store long
design-change narratives. Comment-review passes store comment metadata and
mapping status, each fix stores a short adjustment row, and repeated adjustment
evidence can become a preference candidate. Standalone design-quality reviews
store a bounded target evidence bundle, structured findings, and root-comment
outbox rows only after the user approves posting. Only promoted
`design_preferences` are fed back into design context by
graph design context.

The DB sets `PRAGMA user_version = 2` on open. The target cache is deliberately
defensive: rows carry a cache schema version, source fingerprint, and expiry.
Normal review starts collect fresh shallow Figma evidence; cached evidence is
for continuity and repeat reports, not a hidden substitute for fresh source of
truth.

## When to extend it

- Adding a new indexed field to the components table (e.g. `page_name`) — `initComponentsDb` uses `CREATE VIRTUAL TABLE IF NOT EXISTS`, so you must drop and recreate the table in a new migration step; consider versioning `components.db` if the schema needs to evolve in place.
- Supporting partial-match searches (prefix matching) — add `*` to the query term in `searchComponents`; FTS5 supports `term*` prefix queries natively.
- Adding a third FTS5 database (e.g. for spec search) — follow the components-db pattern: a single `initXxxDb`, `upsertXxx`, `searchXxx`, and `clearXxx` in their own file; use `openDb` for consistent pragma setup.
- Adding more review workflow state — extend `design-review-db.ts` with an idempotent schema addition and keep MCP responses paginated or summarized.

## Related

- [sync](./sync.md) — `initComponentsDb`, `upsertComponent`, `initIconsDb`, and `upsertIcon` are called by the sync orchestrator
- [util](./util.md) — `componentsDbPath`, `iconsDbPath`, and `designReviewDbPath` are the canonical path helpers
- [migrations](./migrations.md) — JSON artifacts are lazy; SQLite migrates on open
