# Sync

## What it does

The sync module owns everything needed to pull a Figma design system into a
local snapshot: the `FigmaClient` that speaks the Figma REST API with rate
limiting and exponential backoff, the checkpoint system that lets an
interrupted sync resume from where it left off, and the multi-file orchestrator
that merges components and variables across N Figma files. After a sync, every
non-icon component has a JSON file on disk and searchable rows in the local
component and icon indexes.

## Public surface

**Figma client** (`src/sync/figma-client.ts`)
- `FigmaClient` — constructor accepts `{ token, fetch?, limiter?, backoffOpts?, baseUrl? }`
- `FigmaClient#getFile(fileKey)` — fetch file metadata and page tree
- `FigmaClient#getDocument(fileKey, depth=4)` — fetch a depth-limited file tree for diagnostics or future import strategies
- `FigmaClient#getComponents(fileKey)` — published components
- `FigmaClient#getComponentSets(fileKey)` — component sets (variant groups)
- `FigmaClient#getStyles(fileKey)` — color, text, and effect styles
- `FigmaClient#getLocalVariables(fileKey)` — local variables (Enterprise-gated; returns `null` on 403)
- `FigmaClient#getNodes(fileKey, ids)` — node details, batched in chunks of 100
- `FigmaClient#getPageTree(fileKey, pageId, depth=4)` — fetch one page tree through the nodes endpoint for diagnostics
- `FigmaClient#getComments(fileKey, { asMarkdown? })` — fetch file comments and replies for design review; requires a token with `file_comments:read`
- `FigmaClient#postComment(fileKey, { message, commentId?, clientMeta? })` — post a root comment or reply; requires a token with `file_comments:write`
- `FigmaResponseError` — exported for test construction

**Rate limiting and backoff** (`src/sync/rate-limit.ts`, `src/sync/backoff.ts`)
- `createLimiter({ minTime, maxConcurrent })` — fixed FIFO limiter used by tests and simple callers
- `createAdaptiveLimiter({ initialMinTime, minMinTime, maxMinTime, maxConcurrent })` — default Figma client limiter; starts at a moderate pace, slows down after 429s, honors `Retry-After`, and gradually recovers after successful requests
- `KOTIKIT_FIGMA_INITIAL_MIN_TIME_MS` — optional initial delay between Figma request starts; leave unset unless troubleshooting repeated rate limits
- `KOTIKIT_FIGMA_MIN_TIME_FLOOR_MS` — optional lower bound for adaptive recovery on high-limit tokens
- `KOTIKIT_FIGMA_MIN_TIME_CEILING_MS` — optional upper bound for adaptive slowdown on low-limit tokens
- `KOTIKIT_FIGMA_MAX_CONCURRENT` — optional concurrent Figma request cap; default is `1` because Figma limits vary by token, endpoint tier, and current account usage
- `withBackoff(fn, isRetryable, opts?)` — exponential backoff with jitter; retries on 429 and 5xx
- `RetryableError` — `{ status, retryAfterMs? }` shape used by the retry predicate
- `BackoffOpts` — `{ initialMs?, maxMs?, jitterMs?, maxAttempts? }`

**Sync engine** (`src/sync/sync-engine.ts`)
- `syncOneFile(opts)` — runs one Figma file through the 8-stage pipeline; returns `SyncOneFileResult`
- `SyncOneFileOpts`, `SyncOneFileResult`

**Multi-file orchestrator** (`src/sync/multi-file.ts`)
- `syncAllFiles(opts)` — drives N files in order, merges outputs, writes all artifacts
- `SyncAllOpts` — `{ root, files, client }`
- `SyncReport` — `{ ranAt, files[], conflicts[], variableCollisions[], skipped[], normalizationDiagnostics[] }`

**Checkpoint** (`src/sync/checkpoint.ts`)
- `Checkpoint`, `FileCheckpoint`, `CheckpointStage`
- `readCheckpoint(root)` — returns `Checkpoint | null`; never throws on malformed input
- `writeCheckpoint(root, cp)` — atomic write via `.tmp` + rename
- `clearCheckpoint(root)` — remove checkpoint after a successful sync
- `hasCheckpoint(root)` — boolean probe

**Variables** (`src/sync/variables.ts`, `src/sync/plugin-variables.ts`)
- `mergeVariables({ variables, styles, styleDetailsByNodeId })` — combines local variables with styles into a unified `VariablesJson`
- `importPluginVariables(root, payload)` — merges variables exported by the Figma plugin into the existing `variables.json`, preserving style tokens and letting variables win on name collisions
- `writeVariablesJson(root, json)` — persist merged variables
- `VariablesJson`, `buildComponentJson`, `buildPropsString`

**Component shape** (`src/sync/component-shape.ts`)
- `buildComponentJson({ fileKey, publishedComponent, componentSet, nodeDetails })` — construct a `ComponentJson` from Figma API shapes
- `ComponentJson` — the canonical per-component JSON written to `design-system/components/<slug>.json`; `key` stays as the concrete importable component key, while `componentSetKey` records the logical Figma component-set key when available

**Design-system normalization** (`src/sync/normalize-design-system.ts`)
- `normalizePublishedDesignSystem(input)` — collapses published Figma API rows into the canonical local model
- `NormalizePublishedResult` — `{ components, icons, nodeIdsForDetails, warnings }`
- `buildNormalizationDiagnostics(input, result)` — compact per-file metrics for `.sync-report.json`
- `NormalizationDiagnostics` — counts for published components, component sets, node details, emitted components/icons, detail nodes, and warning codes

**Icon detection** (`src/sync/icon-detect.ts`)
- `detectIconSignal({ pageName, componentName })` — returns a signal string if the component looks like an icon, otherwise `null`

**Manifest** (`src/sync/manifest.ts`)
- `writeManifest(root, manifest)` — write `design-system/manifest.json`
- `SyncManifest`

## How it works

`syncOneFile` is a sequential 8-stage pipeline: `metadata → components → component_sets → styles → variables → node_details → icons → done`. Each stage writes a checkpoint entry after completion, so a process kill at any point leaves a valid checkpoint. On resume, cheap idempotent list stages are fetched again because their outputs live only in memory during one invocation. The expensive `node_details` stage runs in bounded waves, records `{ processed, batchSize }` after each batch, and can pause before the MCP request window closes.

**Published/importable libraries are required.** Figma only returns importable component keys from files that have been published as a library. Those keys are what generated Figma drafts need when they instantiate design-system components. If both `/components` and `/component_sets` return empty arrays, `syncOneFile` does not scrape the document tree and does not write local component rows. It records a skipped entry explaining that the file is not published as a library. This avoids creating a design-system snapshot that looks useful locally but cannot be used by Figma drafts.

**Normalization handles different published-library shapes.** Published Figma libraries do not all look the same through the API. Some publish clean component-set metadata, while others return every variant child as a separate published component and only expose its logical set through `containing_frame.containingComponentSet`. `normalizePublishedDesignSystem` groups rows by `component_set_id`, `containingComponentSet.nodeId`, `containingStateGroup.nodeId`, or standalone component ID, then emits one canonical `ComponentJson` per logical component. Component-set metadata is indexed by both published key and node ID. When Figma omits variant definitions, the normalizer fetches the component-set node details; if those are still missing, it infers variant axes from child names like `Size=md, Type=Fill`.

**Icon normalization is group-aware.** Icons can be represented as standalone components, variant children, or component sets on pages with decorative names such as `Icons`. Icon detection checks the page and component name, then classifies the whole logical group as icons when any child has an icon signal. Icon rows stay in `icons.db`; non-icons become component JSON files and component-index rows.

**Adaptive Figma pacing.** The Figma API applies different limits depending on account type, token permissions, endpoint tier, and current usage. Kotikit therefore does not assume a fixed free/pro plan limit. The default client uses `createAdaptiveLimiter`: it begins at `KOTIKIT_FIGMA_INITIAL_MIN_TIME_MS` or 1000 ms between request starts, keeps concurrency at 1, records every 429 as a slowdown signal, honors `Retry-After` as a temporary pause, and cautiously lowers the delay again after sustained success. This keeps professional accounts from being permanently throttled by free-tier defaults while still letting free or low-limit tokens converge to a safe pace. Operators can raise the initial/floor values for stricter environments or lower the floor for trusted high-limit tokens, but normal local sync should leave the defaults unset.

Figma token resolution is shared by sync, design review, and comment review. Kotikit loads the target project's `.env` before constructing a Figma client. If `config.figma.token` is omitted or empty, it resolves `${FIGMA_TOKEN}` by default. If `config.figma.token` is present, that explicit value wins and may be a plain token, `${OTHER_ENV_VAR}`, or an `op://` secret reference. `.env` loading does not replace non-empty shell values, but it does refresh empty placeholders such as the scaffolded `FIGMA_TOKEN=` line so users can paste a token and retry in the same assistant session.

Graph review and comment flows use the same adaptive client as sync. Comments are a different Figma endpoint tier from files/components, so the limiter remains endpoint-agnostic: it honors 429s and `Retry-After` dynamically instead of assuming a particular Professional, Organization, or Enterprise quota.

`syncAllFiles` runs files in the order declared in `config.figma.designSystemFiles`. This order is intentional: later files win on component-name collision. When two files publish a component with the same name, the later file's `ComponentJson` overwrites the earlier one on disk and in `components.db`, and the conflict is recorded in `SyncManifest.conflicts`. Variable collisions follow the same last-wins rule.

Component rows are seeded into `components.db` as soon as published component metadata is available, before the slower `node_details` stage. Stage 7 overwrites those rows with enriched prop data after node details arrive. Icon rows and component JSON files are persisted after each file finishes, before `fileDone` is emitted and before the checkpoint marks that file as `done`. This avoids a long final write batch and makes resumed sync safer: a file is only marked complete after its component artifacts are durable. At the start of a fresh per-file sync, kotikit deletes only that file's old component/icon rows so stale design-system entries do not survive a re-sync. Variables and the final manifest are still written at the end because their collision rules depend on the full configured file order.

The sync report includes `normalizationDiagnostics` for every fully normalized file. Agents should use this compact report to understand whether Figma omitted component-set metadata, variants were inferred from child names, names collided, or too many groups were classified as icons before reading component JSON files.

## When to extend it

- Supporting a new Figma API endpoint (e.g. `/v1/files/:key/variables/published`) — add a method to `FigmaClient`, handle 403 gracefully, and include it as a new stage in `syncOneFile` only when it belongs to design-system sync.
- Changing the collision resolution strategy — edit the `writtenByName` map logic in `syncAllFiles` (currently last-file-wins; could become first-file-wins or explicit priority list).
- Adding a new artifact type beyond per-component JSON (e.g. a style token file) — add a stage to `syncOneFile` and a write call in the post-loop section of `syncAllFiles`.
- Supporting non-Figma design tools — replace `FigmaClient` with a different client behind the same interface and write a new `syncOneFile` pipeline; the multi-file orchestrator and checkpoint layers are tool-agnostic.

## Related

- [db](./db.md) — `initComponentsDb`, `upsertComponent`, `initIconsDb`, and `upsertIcon` are called by the orchestrator
- [util](./util.md) — `componentsDbPath`, `iconsDbPath`, `componentJsonPath`, `checkpointPath`, and `syncReportPath` are path helpers
- [mcp](./mcp.md) — `kotikit_sync_ds` is the MCP tool that invokes `syncAllFiles`
