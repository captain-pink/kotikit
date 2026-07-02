# DB

## What it does

The db module wraps `bun:sqlite` with the conventions kotikit uses everywhere:
WAL journal mode, normal synchronous writes, foreign key enforcement, and a thin
transaction helper. On top of that base it owns the full-text-search components
store and the full-text-search icons store. It also provides the CamelCase
token splitter that makes component names searchable by their parts.

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

**CamelCase tokenizer** (`src/db/camel-tokens.ts`)
- `buildNameTokens(name)` — produce the `name_tokens` column value: the original string plus each split token, deduplicated, joined with spaces

## How it works

Both `components.db` and `icons.db` use FTS5 virtual tables with the `unicode61 remove_diacritics 2` tokenizer. FTS5's built-in unicode61 tokenizer handles accented characters and case folding without needing the Porter stemmer, which would cause false matches ("icon" matching "iconography" stems). This choice trades some recall for much higher precision on short component names.

Because FTS5 virtual tables do not support SQL `INSERT OR REPLACE`, `upsertComponent` and `upsertIcon` use DELETE-then-INSERT within the caller-provided transaction. The `name_tokens` column is denormalized — it stores the original name plus its CamelCase-split parts (`"ButtonGroup"` → `"ButtonGroup Button Group"`), letting the FTS5 engine find `"Button"` when searching for a `ButtonGroup` component. `buildNameTokens` handles acronyms (`"HTTPSConfig"` → `"HTTPSConfig HTTPS Config"`), letter-to-digit transitions, and separator normalization.

## When to extend it

- Adding a new indexed field to the components table (e.g. `page_name`) — `initComponentsDb` uses `CREATE VIRTUAL TABLE IF NOT EXISTS`, so you must drop and recreate the table in a new migration step; consider versioning `components.db` if the schema needs to evolve in place.
- Supporting partial-match searches (prefix matching) — add `*` to the query term in `searchComponents`; FTS5 supports `term*` prefix queries natively.
- Adding a third FTS5 database (e.g. for spec search) — follow the components-db pattern: a single `initXxxDb`, `upsertXxx`, `searchXxx`, and `clearXxx` in their own file; use `openDb` for consistent pragma setup.

## Related

- [sync](./sync.md) — `initComponentsDb`, `upsertComponent`, `initIconsDb`, and `upsertIcon` are called by the sync orchestrator
- [util](./util.md) — `componentsDbPath` and `iconsDbPath` are the canonical path helpers
- [migrations](./migrations.md) — JSON artifacts are lazy; SQLite migrates on open
