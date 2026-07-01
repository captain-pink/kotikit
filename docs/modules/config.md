# Config

## What it does

The config module owns everything related to `.kotikit/config.json`: the Zod schema that defines its shape, the functions that read and write it, the wizard helper that builds a config from user answers, and the secret-resolution logic that expands `${ENV_VAR}` references and `op://` 1Password vault paths before values reach the rest of the system.

## Public surface

**Schema and types** (`src/config/schema.ts`)
- `CONFIG_SCHEMA_VERSION` — latest numeric schema version for `.kotikit/config.json`
- `ConfigSchema` — Zod schema for the full config object
- `Config` — TypeScript type inferred from `ConfigSchema`
- `defaultConfig()` — returns a fully-defaulted `Config` with no user overrides
- `parseConfig(raw)` — parse raw JSON into `Config`, throwing a plain-English error on failure

**Fields on `Config`:**
- `schemaVersion` — numeric config schema marker; missing values are normalized in memory
- `figma.token` — optional Figma PAT or secret reference
- `figma.designSystemFiles` — array of `{ key, name }` objects
- `defaults.breakpoints` — pixel widths, default `[375, 768, 1024, 1440]`
- `defaults.themes` — string array, default `["light", "dark"]`
- `git.autoCommit` — boolean, default `true`
- `git.coAuthor` — `{ name, email }` used for generated commit footers; defaults to Claude Code for backward compatibility
- `flowPacks.projectFlowsEnabled` — boolean, default `false`; project-local
  flows are ignored unless this is explicitly enabled
- `flowPacks.allowedProjectCapabilities` — capability allowlist for enabled
  project-local flows
- `flowPacks.extensions` — extension flow-pack allowlist entries containing
  `{ id, source, versionOrRef, hash, capabilities, enabled }`

**I/O** (`src/config/load.ts`)
- `loadConfig(root)` — async, returns `Config | null` (null when file absent)
- `writeConfig(root, cfg)` — async, creates `.kotikit/` directory if needed
- `configExists(root)` — async, returns `boolean`
- `resolveSecret(value)` — async, expands `${ENV_VAR}` or `op://` references
- `resolveSecretImpl(value, spawn)` — internal variant; exported for test injection

**Init wizard** (`src/config/init.ts`)
- `InitAnswers` — the interface accepted by the wizard (all fields optional)
- `buildConfig(answers)` — merges wizard answers over `defaultConfig()`, returns validated `Config`

## How it works

The config file lives at `<root>/.kotikit/config.json` and is always pretty-printed JSON. `loadConfig` reads and parses the file, delegating validation to `parseConfig` which uses `ConfigSchema.safeParse` and converts Zod issues into a single plain-English error message listing the bad field paths. Defaults are supplied by `defaultConfig()` during initialization, so configs written by `kotikit_config_init` are complete and valid even when the user only answered a few setup questions.

Secret resolution follows a three-way dispatch: a plain string is returned unchanged; a string matching `${VAR_NAME}` is replaced with `process.env.VAR_NAME` synchronously; a string starting with `op://` is resolved by spawning `op read <value>` via `Bun.spawn` and stripping the trailing newline. The `op://` branch is fully async. If the `op` binary is missing or returns a non-zero exit code, `resolveSecret` returns `undefined` rather than throwing — callers are expected to handle a missing token gracefully and surface a clear message to the designer.

Figma sync treats project `.env` as the default token source. If `.kotikit/config.json` omits `figma.token`, `kotikit_sync_ds` resolves `${FIGMA_TOKEN}` after loading `<root>/.env`. An explicit `figma.token` still wins, so users can opt into a different environment variable, a plain token string, or an `op://` secret reference. The sync tool refreshes only empty process placeholders from `.env`, which lets a scaffolded `FIGMA_TOKEN=` line be filled in during an active assistant session without clobbering non-empty shell-provided secrets.

The init wizard (`buildConfig`) is a thin merge layer. It calls `defaultConfig()` to get a clean base, then overlays only the keys the designer actually provided in `InitAnswers`, then runs the result through `ConfigSchema.parse` to guarantee a valid typed object. This means the wizard never needs to know about every field — omitted answers fall back to defaults automatically. Agent-specific wrappers can provide `git.coAuthor` during setup, for example Codex can pass `{ "name": "Codex", "email": "noreply@openai.com" }`, while shared runtime behavior stays agent-neutral.

Flow-pack trust policy is fail-closed. The default config disables project
flows and enables no extension packs. When `flowPacks.projectFlowsEnabled` is
true, project flow manifests under `.kotikit/flows` must only require
capabilities listed in `flowPacks.allowedProjectCapabilities`. The graph
runtime also requires manifests to declare every registry-declared node
capability before execution. Extension flows under
`.kotikit/extensions/flows` require an enabled allowlist entry with a matching
manifest hash and explicit capabilities, so an updated or tampered flow cannot
run until the project trust policy is reviewed.

Config JSON uses lazy migration. Existing configs without `schemaVersion` are
loaded into the latest in-memory shape and are written back with
`schemaVersion` only when kotikit updates the config. Configs from a future
schema version are rejected with a user-facing error so an older kotikit build
does not overwrite unknown settings.

## When to extend it

- Adding a new top-level config key (e.g. a `review` block) — add the field to `ConfigSchema`, update defaults, and add a question to the MCP `kotikit_config_init` tool.
- Supporting a second secret provider (e.g. AWS Secrets Manager) — extend `resolveSecretImpl` with a new prefix branch and update the spawn injection interface so tests can cover it without hitting a real AWS endpoint.
- Changing where `.kotikit/` lives — update `configPath` in `src/util/paths.ts` (the config module delegates all path construction there).

## Related

- [util](./util.md) — `configPath`, `findProjectRoot`, and all `.kotikit/` path helpers live here
- [mcp](./mcp.md) — `kotikit_config_status` and `kotikit_config_init` are the MCP tools that call `loadConfig`, `configExists`, and `buildConfig`
- [migrations](./migrations.md) — lazy JSON migration model
