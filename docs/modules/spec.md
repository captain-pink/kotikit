# Spec

## What it does

The spec module owns the on-disk representation of design intent: the `ScreenSpec` and `FlowManifest` data shapes, the engine that reads and writes them, the flat index that lets tools list all known scopes without reading every spec body, and the decomposition layer that converts raw brainstorm drafts into valid, typed spec objects. It is the source of truth for what has been designed and what is ready to implement.

## Public surface

**Schemas and types** (`src/spec/schema.ts`)
- `SCREEN_SPEC_SCHEMA_VERSION` — latest numeric schema version for screen specs
- `FLOW_MANIFEST_SCHEMA_VERSION` — latest numeric schema version for flow manifests
- `ScreenSpecSchema`, `ScreenSpec` — the per-screen spec shape (schemaVersion, id, title, context, requirements, components, acceptanceCriteria, figmaTarget, metadata)
- `FlowManifestSchema`, `FlowManifest` — the flow-level manifest (schemaVersion, id, title, description, screens list, transitions, sharedState, figmaTarget, metadata)
- `newScreenSpec({ title, description, flowRef? })` — factory that stamps timestamps, generates a UUID, and sets status to `"draft"`
- `newFlowManifest({ title, description, screens })` — factory for a flow manifest
- `parseScreenSpec(raw)` — parse and validate; throws a plain-English error on malformed input
- `parseFlowManifest(raw)` — same for flow manifests

**Engine** (`src/spec/engine.ts`)
- `writeScreenSpec(root, scope, screenSlug | null, spec)` — write spec to disk, update index; `null` slug means single-screen scope
- `readScreenSpec(root, scope, screenSlug | null)` — read and parse from disk; throws `KotikitError` if missing
- `writeFlowManifest(root, scope, manifest)` — write manifest, update index
- `readFlowManifest(root, scope)` — read and parse manifest
- `listScopes(root)` — return all `IndexEntry` objects from the index (never reads spec bodies)
- `scopeExists(root, scope)` — check if the scope directory exists

**Index store** (`src/spec/index-store.ts`)
- `IndexEntry` — `{ scope, title, kind, status, screens, updatedAt }`
- `readIndex(root)` — read the full index from `.kotikit/index.json`
- `upsertIndexEntry(root, entry)` — insert or replace an index entry by scope
- `removeIndexEntry(root, scope)` — remove an entry

**Decomposition** (`src/spec/decompose.ts`)
- `ScreenDraft` — raw agent output for a single screen (slug, title, description, functional, states, components, acceptanceCriteria, userTypes, entryPoints)
- `FlowDraft` — contains `screens: ScreenDraft[]` plus transitions and sharedState
- `SingleDraft` — wraps one `ScreenDraft` with a `scope` string
- `isMultiScreen(draft)` — type guard distinguishing `FlowDraft` from `SingleDraft`
- `materializeFlow(draft)` — pure function; converts `FlowDraft` → `{ manifest, specs[] }` without any disk I/O
- `materializeSingle(draft)` — pure function; converts `SingleDraft` → `{ spec }`

## How it works

A spec scope is a directory under `.kotikit/specs/<scope>/`. A single-screen scope contains one file (`spec.json`). A flow scope contains a `flow.json` manifest plus N files named `<slug>.spec.json`, one per screen. This physical layout means a designer working in a file manager or reviewing a git diff can always navigate to the right file by scope and screen name without any tool assistance.

The `inherits` / `overrides` pattern in `ScreenSpec.requirements.responsive` and `.themes` avoids repeating breakpoint and theme arrays in every spec. When the value is the literal string `"inherits"`, graph and planning modules read defaults from the project config. When it is `{ overrides: { breakpoints: [...] } }`, those values take precedence. This keeps individual specs concise while preserving the ability to override per-screen when design intent requires it.

The index at `.kotikit/index.json` is a flat JSON array of `IndexEntry` objects. It is updated atomically on every `write*` call. `listScopes` reads only the index, never individual spec files — this makes listing fast even in projects with hundreds of specs. The engine is careful not to overwrite a flow-kind index entry when writing an individual screen spec within that flow: `writeFlowManifest` owns the flow's index record.

Status flows one direction: `"draft"` → `"active"`. Graph nodes and internal
engines that create specs start in `"draft"`. A future graph artifact promotion
path can set status to `"active"` once the designer confirms the spec is ready.

`figmaTarget` is optional because older specs do not have one and some specs may
never be rendered in Figma. Before any Figma draft is generated, graph target
nodes bind a `FigmaDraftTarget` to the active run and can persist it to the
specific screen spec or flow manifest when needed. Screen-level targets win over
flow-level targets. The target stores the exact file key, page ID, page URL,
draft page name, and kotikit Section metadata used to keep generated work out of
production pages.

Spec JSON uses lazy migration. Missing `schemaVersion` means the file is a
legacy but readable artifact. `parseScreenSpec` and `parseFlowManifest`
normalize those files into the latest in-memory shape without rewriting the file.
Any later write through `writeScreenSpec` or `writeFlowManifest` serializes the
latest schema. Future schema versions are rejected so an older kotikit build does
not accidentally edit files created by a newer one. Legacy specs without
`figmaTarget` remain readable, but design creation will ask the user to bind a
safe draft page before planning or applying Figma changes.

## When to extend it

- Adding a new field to `ScreenSpec` (e.g. `analytics.eventNames`) — extend `ScreenSpecSchema`, update `newScreenSpec`, bump `SCREEN_SPEC_SCHEMA_VERSION` only if the persisted shape meaningfully changes, and update any tool that reads the spec to handle both old and new shapes.
- Adding a new Figma target safety property — extend `FigmaDraftTargetSchema`,
  keep older targets readable through lazy parsing, and update graph target,
  draft, and apply metadata validation together.
- Adding a new scope kind beyond `"screen"` and `"flow"` — extend the `kind` union in `IndexEntry` and add a corresponding engine function following the same read/write/upsert-index pattern.
- Adding transitions to a single-screen scope — `ScreenSpec` currently carries no transition data; that lives in `FlowManifest`. If single screens need transitions, add a `nextScreenRef` field.
- Changing the status lifecycle (e.g. adding `"archived"`) — extend the `status` enum in both the schema and the `IndexEntry` type.

## Related

- [config](./config.md) — `defaults.breakpoints` and `defaults.themes` resolve `"inherits"` values
- [util](./util.md) — all spec path helpers (`scopeDir`, `screenSpecPath`, `singleSpecPath`, `flowManifestPath`, `indexPath`) live here
- [git](./git.md) — `autoCommitSpec` stages spec files after every write
- [mcp](./mcp.md) — graph facade tools expose spec-related outputs as
  artifacts instead of public spec wrappers
- [migrations](./migrations.md) — lazy JSON migration model
