# DB

## What it does

The db module wraps `bun:sqlite` with the conventions kotikit uses everywhere: WAL journal mode, normal synchronous writes, foreign key enforcement, and a thin transaction helper. On top of that base it owns three SQLite databases — a full-text-search components store, a full-text-search icons store, and a registry that tracks which design system components have been scaffolded into code — plus the CamelCase token splitter that makes component names searchable by their parts.

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

**Registry database** (`src/db/registry-db.ts`)
- `RegistryKind` — `"screen" | "component"`
- `RegistryStatus` — `"code-only" | "design-only" | "synced"`
- `RegistryRow` — `{ kind, name, dsPath, codePath, status }`
- `initRegistryDb(db)` — idempotent v0 → v1 migration; checks `PRAGMA user_version` and either creates the v1 schema fresh or no-ops
- `upsertRegistry(db, row)` — generic insert-or-replace by `(kind, name)` PK
- `getRegistry(db, kind, name)` — point lookup; returns `RegistryRow | null`
- `searchRegistry(db, opts)` — filter by `{ query?, kind?, status?, limit? }` with positional bindings
- `clearRegistry(db)` — remove all rows
- `upsertRegistryDsRow(db, { name, dsPath })` — merge-aware DS component upsert; never clobbers `code_path` on synced rows
- `listDesignOnlyComponents(db, names?, limit?)` — return component rows with `status="design-only"`, optionally filtered by names allowlist

**CamelCase tokenizer** (`src/db/camel-tokens.ts`)
- `buildNameTokens(name)` — produce the `name_tokens` column value: the original string plus each split token, deduplicated, joined with spaces

## How it works

Both `components.db` and `icons.db` use FTS5 virtual tables with the `unicode61 remove_diacritics 2` tokenizer. FTS5's built-in unicode61 tokenizer handles accented characters and case folding without needing the Porter stemmer, which would cause false matches ("icon" matching "iconography" stems). This choice trades some recall for much higher precision on short component names.

Because FTS5 virtual tables do not support SQL `INSERT OR REPLACE`, `upsertComponent` and `upsertIcon` use DELETE-then-INSERT within the caller-provided transaction. The `name_tokens` column is denormalized — it stores the original name plus its CamelCase-split parts (`"ButtonGroup"` → `"ButtonGroup Button Group"`), letting the FTS5 engine find `"Button"` when searching for a `ButtonGroup` component. `buildNameTokens` handles acronyms (`"HTTPSConfig"` → `"HTTPSConfig HTTPS Config"`), letter-to-digit transitions, and separator normalization.

The registry schema has two versions. `PRAGMA user_version = 0` is the Phase 3 baseline: a single `registry` table with `(name TEXT PK, code_path, status)`. Version 1, introduced in Phase 4, renames the table, adds the composite `(kind, name)` primary key, and adds the `ds_path` column. The `initRegistryDb` migration is idempotent: it reads `PRAGMA user_version`, creates the v1 schema if `version === 0`, copies existing rows forward as `kind='screen'`, and sets `user_version = 1`. Because bun:sqlite requires `PRAGMA user_version` to be set outside a transaction, the migration commits before issuing the pragma.

`upsertRegistryDsRow` is the only function that understands component lifecycle rules. When the sync runs again on an already-scaffolded component, this function updates `ds_path` without touching `code_path` or status, preserving the `"synced"` label. When a component was `"code-only"` (scaffolded before the DS was synced), it promotes the row to `"synced"` if `code_path` is non-null.

## When to extend it

- Adding a new indexed field to the components table (e.g. `page_name`) — `initComponentsDb` uses `CREATE VIRTUAL TABLE IF NOT EXISTS`, so you must drop and recreate the table in a new migration step; consider versioning `components.db` the same way the registry is versioned.
- Supporting partial-match searches (prefix matching) — add `*` to the query term in `searchComponents`; FTS5 supports `term*` prefix queries natively.
- Adding a new registry status (e.g. `"archived"`) — extend the `CHECK` constraint in the SQL and the `RegistryStatus` TypeScript type, then update `upsertRegistryDsRow` merge logic.
- Adding a third FTS5 database (e.g. for spec search) — follow the components-db pattern: a single `initXxxDb`, `upsertXxx`, `searchXxx`, and `clearXxx` in their own file; use `openDb` for consistent pragma setup.

## Related

- [sync](./sync.md) — `initComponentsDb`, `upsertComponent`, `initIconsDb`, `upsertIcon`, `initRegistryDb`, `upsertRegistryDsRow` are all called by the sync orchestrator
- [codegen](./codegen.md) — the registry is read by the scaffold tool to find `design-only` components
- [util](./util.md) — `componentsDbPath`, `iconsDbPath`, `registryDbPath` are the canonical path helpers
- `planning/phase-2.md` — FTS5 tokenizer decision; camel-token rationale
- `planning/phase-4.md` — registry v1 schema and `upsertRegistryDsRow` merge rules
