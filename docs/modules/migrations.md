# Migrations

## What it does

The migrations module keeps old local kotikit artifacts usable without forcing a
project-wide rewrite. Kotikit uses a lazy migration model: JSON artifacts are
parsed leniently into the latest in-memory shape, then written back in the
latest schema only when that specific artifact is edited.

This keeps old specs stable if they are never touched, while still making every
active edit produce current, predictable JSON.

## Public surface

**Schema inventory** (`src/migrations/schema-inventory.ts`)
- `SchemaInventory` — `{ checked, current, legacyOrOlder, future, unreadable, samples, findings }`
- `SchemaArtifactFinding` — per-file `{ path, kind, status, schemaVersion, latestVersion, reason }`
- `inspectProjectSchemaVersions(root)` — read-only project scan used by doctor;
  inspects `.kotikit/config.json` and spec files under `.kotikit/specs/`

**Dry run** (`src/migrations/dry-run.ts`)
- `runMigrationDryRun(root)` — read-only report used by `kotikit migrate --dry-run`
- `formatMigrationDryRunReport(report)` — terminal formatter for the CLI
- `formatSchemaInventoryDetails(root, inventory)` — compact detail lines shared
  by doctor and the dry-run output

## How it works

JSON artifacts expose explicit numeric `schemaVersion` fields at their schema
boundary. Missing `schemaVersion` means "legacy but readable". A version lower
than the current schema is also readable. A version higher than the current
schema is rejected because it may have been created by a newer kotikit release
with fields this version cannot safely understand.

Read paths normalize old artifacts in memory. For example, an old screen spec
without `components[].resolution` is still parsed; components with a `dsKey`
are treated as existing design-system components in memory. The original file is
not changed by a read. Write paths always serialize the latest schema, so the
file is upgraded only when kotikit actually modifies it.

SQLite databases are different. They must match the schema expected by queries
as soon as they are opened, so user-authored stores use `PRAGMA user_version`
and idempotent open-time migrations. `design-review.db` has a versioned
starting point; derived design-system search indexes can usually be rebuilt by
running sync again.

`kotikit doctor` reports old readable artifacts as a warning, not an error:
those files will update automatically when edited. It also includes capped
per-file details so users can see which files are old, unreadable, or from a
newer kotikit version without opening the files manually. Future-version
artifacts are reported as errors and should be handled by updating kotikit
before editing.

`kotikit migrate --dry-run` uses the same read-only inventory. It prints counts
and sample file paths, exits non-zero only for blocking future/unreadable files,
and always finishes with `No files changed.` There is intentionally no write
mode yet because the migration model is lazy: active artifacts upgrade when
kotikit saves them.

## When to extend it

- Adding an optional JSON field — usually add a default in the Zod schema, bump
  the relevant `*_SCHEMA_VERSION`, and add a minimized legacy fixture test.
- Renaming or removing a JSON field — add an explicit parser transform that
  preserves user-authored intent, then add tests for old and new shapes.
- Adding a SQLite table or column — add an idempotent migration branch keyed by
  `PRAGMA user_version`, then test old DB fixtures and repeated initialization.
- Changing derived design-system indexes — prefer resyncing over migrating
  unless user-authored data is stored there.

## Related

- [spec](./spec.md) — screen and flow JSON are lazily normalized
- [config](./config.md) — config JSON is lazily normalized
- [db](./db.md) — SQLite uses eager open-time migrations
- [doctor](../tools.md#kotikit_doctor) — reports legacy, future, or unreadable artifacts
