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
- `SchemaInventory` — `{ checked, legacyOrOlder, future, unreadable, samples }`
- `inspectProjectSchemaVersions(root)` — read-only project scan used by doctor;
  inspects `.kotikit/config.json` and spec files under `.kotikit/specs/`

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
as soon as they are opened, so they use `PRAGMA user_version` and idempotent
open-time migrations. `registry.db` and `design-review.db` both have a versioned
starting point.

`kotikit doctor` reports old readable artifacts as a warning, not an error:
those files will update automatically when edited. Future-version artifacts are
reported as errors and should be handled by updating kotikit before editing.

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
