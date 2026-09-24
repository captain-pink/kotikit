# Migrations

`kotikit doctor` and `kotikit migrate --dry-run` inspect the active
`.kotikit/config.json` schema. The dry run reports older, newer, or unreadable
config without writing files. Older config is normalized when Kotikit reads it
and saved in the current shape when edited.

The retired `.kotikit/specs/*` files and `.kotikit/index.json` are historical
project data. Kotikit does not delete, scan, migrate, or update them. They do
not produce doctor warnings or block a new design run.

Derived design-system search indexes use SQLite. They can be rebuilt with
`kotikit_sync_ds`; they are separate from the old spec storage.

## Public surface

- `inspectProjectSchemaVersions(root)` in `src/migrations/schema-inventory.ts`
  returns read-only findings for the active config file.
- `runMigrationDryRun(root)` and `formatMigrationDryRunReport(report)` in
  `src/migrations/dry-run.ts` back the CLI's no-write report.

When changing the config schema, preserve user-authored values in the parser
and keep the version inventory aligned with the current config version.
