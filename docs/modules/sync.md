# Sync

## What it does

The sync module owns everything needed to pull a Figma design system into a local snapshot: the `FigmaClient` that speaks the Figma REST API with rate limiting and exponential backoff, the checkpoint system that lets an interrupted sync resume from where it left off, the multi-file orchestrator that merges components and variables across N Figma files, and the registry writeback that tracks which DS components have code counterparts. After a sync, every non-icon component has a JSON file on disk and a row in the registry database.

## Public surface

**Figma client** (`src/sync/figma-client.ts`)
- `FigmaClient` — constructor accepts `{ token, fetch?, limiter?, backoffOpts?, baseUrl? }`
- `FigmaClient#getFile(fileKey)` — fetch file metadata and page tree
- `FigmaClient#getDocument(fileKey, depth=4)` — fetch the full file tree; used as a fallback when `/components` returns empty (free-plan files or libraries that have not been published)
- `FigmaClient#getComponents(fileKey)` — published components
- `FigmaClient#getComponentSets(fileKey)` — component sets (variant groups)
- `FigmaClient#getStyles(fileKey)` — color, text, and effect styles
- `FigmaClient#getLocalVariables(fileKey)` — local variables (Enterprise-gated; returns `null` on 403)
- `FigmaClient#getNodes(fileKey, ids)` — node details, batched in chunks of 100
- `FigmaResponseError` — exported for test construction

**Rate limiting and backoff** (`src/sync/rate-limit.ts`, `src/sync/backoff.ts`)
- `createLimiter({ minTime, maxConcurrent })` — wraps `bottleneck`, default 100 ms / 2 concurrent
- `withBackoff(fn, isRetryable, opts?)` — exponential backoff with jitter; retries on 429 and 5xx
- `RetryableError` — `{ status, retryAfterMs? }` shape used by the retry predicate
- `BackoffOpts` — `{ maxAttempts?, baseMs?, maxMs? }`

**Sync engine** (`src/sync/sync-engine.ts`)
- `syncOneFile(opts)` — runs one Figma file through the 8-stage pipeline; returns `SyncOneFileResult`
- `SyncOneFileOpts`, `SyncOneFileResult`

**Multi-file orchestrator** (`src/sync/multi-file.ts`)
- `syncAllFiles(opts)` — drives N files in order, merges outputs, writes all artifacts
- `SyncAllOpts` — `{ root, files, client }`
- `SyncReport` — `{ ranAt, files[], conflicts[], variableCollisions[], skipped[], registryUpdates }`

**Checkpoint** (`src/sync/checkpoint.ts`)
- `Checkpoint`, `FileCheckpoint`, `CheckpointStage`
- `readCheckpoint(root)` — returns `Checkpoint | null`; never throws on malformed input
- `writeCheckpoint(root, cp)` — atomic write via `.tmp` + rename
- `clearCheckpoint(root)` — remove checkpoint after a successful sync
- `hasCheckpoint(root)` — boolean probe

**Variables** (`src/sync/variables.ts`)
- `mergeVariables({ variables, styles, styleDetailsByNodeId })` — combines local variables with styles into a unified `VariablesJson`
- `writeVariablesJson(root, json)` — persist merged variables
- `VariablesJson`, `buildComponentJson`, `buildPropsString`

**Component shape** (`src/sync/component-shape.ts`)
- `buildComponentJson({ fileKey, publishedComponent, componentSet, nodeDetails })` — construct a `ComponentJson` from Figma API shapes
- `ComponentJson` — the canonical per-component JSON written to `design-system/components/<slug>.json`

**Icon detection** (`src/sync/icon-detect.ts`)
- `detectIconSignal({ pageName, componentName })` — returns a signal string if the component looks like an icon, otherwise `null`

**Manifest** (`src/sync/manifest.ts`)
- `writeManifest(root, manifest)` — write `design-system/manifest.json`
- `SyncManifest`

## How it works

`syncOneFile` is a sequential 8-stage pipeline: `metadata → components → component_sets → styles → variables → node_details → icons → done`. Each stage writes a checkpoint entry after completion, so a process kill at any point leaves a valid checkpoint. On resume, stages before the checkpoint's recorded stage are skipped. The `node_details` stage is the only one with an intra-stage cursor (it batches node IDs in groups of 100 and records `{ processed, batchSize }`).

**Document-tree fallback for unpublished libraries.** Figma's `/v1/files/{key}/components` endpoint only returns components from files that have been published as a team library — and library publishing requires a paid Figma plan. When both `/components` and `/component_sets` return empty arrays, `syncOneFile` falls back to calling `client.getDocument(fileKey, 4)` and walking the document tree to extract every `COMPONENT` and `COMPONENT_SET` node directly. The fallback stops recursion at `COMPONENT_SET` nodes so variant children are not double-counted as standalone components. A `skipped` entry on the sync report records that the fallback ran, so users can see what happened. The happy path for correctly-published libraries is unchanged — the fallback only runs when the published-library endpoints came back empty.

`syncAllFiles` runs files in the order declared in `config.figma.designSystemFiles`. This order is intentional: later files win on component-name collision. When two files publish a component with the same name, the later file's `ComponentJson` overwrites the earlier one on disk and in `components.db`, and the conflict is recorded in `SyncManifest.conflicts`. Variable collisions follow the same last-wins rule.

The registry writeback uses `upsertRegistryDsRow`, a merge-aware function that never clobbers `code_path` on an already-synced row. The rules are: no existing row → insert as `design-only`; existing `design-only` → update `ds_path`; existing `synced` → update `ds_path`, keep `code_path` and status; existing `code-only` → update `ds_path` and promote to `synced` if `code_path` is non-null. This ensures that a re-sync after a component is scaffolded does not reset its registry status.

## When to extend it

- Supporting a new Figma API endpoint (e.g. `/v1/files/:key/variables/published`) — add a method to `FigmaClient`, handle 403 gracefully, and include it as a new stage in `syncOneFile`.
- Changing the collision resolution strategy — edit the `writtenByName` map logic in `syncAllFiles` (currently last-file-wins; could become first-file-wins or explicit priority list).
- Adding a new artifact type beyond per-component JSON (e.g. a style token file) — add a stage to `syncOneFile` and a write call in the post-loop section of `syncAllFiles`.
- Supporting non-Figma design tools — replace `FigmaClient` with a different client behind the same interface and write a new `syncOneFile` pipeline; the multi-file orchestrator, checkpoint, and registry writeback layers are tool-agnostic.

## Related

- [db](./db.md) — `initComponentsDb`, `upsertComponent`, `initIconsDb`, `upsertIcon`, `initRegistryDb`, `upsertRegistryDsRow` are called by the orchestrator
- [util](./util.md) — `componentsDbPath`, `iconsDbPath`, `registryDbPath`, `componentJsonPath`, `checkpointPath`, `syncReportPath` are all path helpers
- [mcp](./mcp.md) — `kotikit_sync_ds` is the MCP tool that invokes `syncAllFiles`
- `planning/phase-2.md` — sync architecture, rate-limit strategy, multi-file merge rationale
