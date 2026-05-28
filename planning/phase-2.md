# Kotikit — Phase 2 Implementation Plan

> **Phase 2 deliverable:** *A designer says "sync my design system" inside `/kotikit:auto` and ends up with a local, token-cheap, searchable mirror of one or more Figma design-system files at `design-system/`. Components, icons, and design tokens are queryable by name and read individually by path; nothing is ever loaded as a whole.*
>
> Build on top of Phase 1 (mutable specs, conversational front door, auto-commit). No codegen, no Figma plugin, no scaffolding. Just **search-and-read access to the design system**.

This document is self-contained. A senior engineer or AI agent with **Phase 1 context only** should be able to read it and build the right thing. Read §0 (orientation) before picking up any task.

---

## 0. Orientation — what you are building (read this first)

### Architectural decisions that are non-negotiable

These were settled in advance. Do **not** re-litigate them.

1. **Component identity = name.** `components.db` has one row per unique component name. When two configured Figma files publish the same name, the later-listed file wins (overwrites the row and the per-component JSON). The displaced component is recorded in `manifest.json.conflicts[]`. Per-component JSON files always carry both `name` and Figma `key` so a future phase can disambiguate by key if needed.

2. **Icon detection uses all three signals.** A component is an icon if **any** of the following match:
   - its page name matches `/^icons?$/i` (the strongest authorial intent — precedence on multi-match),
   - its name matches `/^(ic[-_]|icon[\/_]|.*\.icon$)/i`,
   - its name uses the Figma slash convention `Icon/...`.
   Record which signal fired on each icon row so the report explains misclassifications.

3. **Variables and styles merge into one `variables.json`.** Flat token list, schema `{ name, kind: "color"|"text"|"effect"|"number"|"spacing", source: "variable"|"style", value, modes?: Record<string, value>, description? }`. On name collision, `source: "variable"` wins over `source: "style"`; record the collision.

4. **Figma client receives an injected `fetch`.** Constructor takes `{ fetch: typeof globalThis.fetch, token: string, ... }`. No `FigmaTransport` interface, no DI container. Tests pass a stub `fetch` that returns crafted `Response` objects.

5. **Checkpoint is per-stage-per-file.** `.sync-checkpoint.json` is an array of `{ fileKey, stage, cursor? }` where `stage ∈ "metadata"|"components"|"component_sets"|"styles"|"variables"|"node_details"|"icons"|"done"`. Only the `node_details` stage carries a `cursor: { processed: number, batchSize: number }`. All other stages are atomic — either done or not. Write the checkpoint with `writeFile` to a `.tmp` path then `rename` so a kill mid-write does not corrupt it.

6. **SQLite (FTS5) is configured deliberately.**
   - Tokenizer: `tokenize = 'unicode61 remove_diacritics 2'`. No `porter` stemmer.
   - Add a denormalized `name_tokens` column whose value is `"<name> <CamelCaseSplit>"` (so `IconArrowLeft` indexes as `IconArrowLeft Icon Arrow Left`). FTS-index that column. Keep `name` as a plain column for display.
   - Use regular FTS5 tables (not `content=''`) — single-query reads are worth more than minor storage savings here.
   - Open with `journal_mode = WAL`.
   - Wrap the sync write phase in a single `db.transaction(...)`.

7. **No scheduler in Phase 2.** Only manual trigger via `kotikit_sync_ds` (callable from `/kotikit:auto`). Cron/webhook deferred.

### The token-discipline rule (the prime directive)

> **Search the index, read one file. Never load a database. Never load a manifest for lookups.**

Every tool in this phase has to satisfy this rule. If you find yourself reading `components.db` into memory or loading `manifest.json` to look up paths, you wrote the wrong code.

### Folder layout produced by Phase 2

```
design-system/
  components.db                 # SQLite FTS5
  icons.db                      # SQLite FTS5
  variables.json                # merged variables + styles, flat
  manifest.json                 # tiny: synced files + counts + conflicts + lastSyncAt
  components/
    button.json
    text-field.json
    pie-chart.json
    ...
  .sync-checkpoint.json         # present while sync is in progress / failed; deleted on success
  .sync-report.json             # written at end of every sync (success or partial)
```

### Source layout you will create

```
src/
  mcp/
    tools/
      sync.ts                   # kotikit_sync_ds
      ds-search.ts              # kotikit_ds_search, kotikit_ds_get_component
      icons-search.ts           # kotikit_icons_search
  sync/
    figma-client.ts             # native fetch + bottleneck + jittered backoff
    figma-types.ts              # raw Figma API response shapes
    rate-limit.ts               # bottleneck wrapper
    backoff.ts                  # exponential + jitter retry helper
    checkpoint.ts               # read/write/clear .sync-checkpoint.json (atomic)
    sync-engine.ts              # the per-file pipeline (stages)
    multi-file.ts               # orchestrates N files into one snapshot + conflicts
    icon-detect.ts              # the three-signal classifier
    variables.ts                # merge variables + styles into variables.json shape
    component-shape.ts          # Figma node → kotikit component JSON mapper
  db/
    sqlite.ts                   # bun:sqlite open + pragmas + transaction helper
    components-db.ts            # schema + insert/search/clear for components
    icons-db.ts                 # schema + insert/search/clear for icons
    camel-tokens.ts             # CamelCaseSplit util for name_tokens column
  config/
    load.ts                     # extend: op:// secret resolution via `op read`
  util/
    paths.ts                    # extend: designSystemDir, componentsDbPath, iconsDbPath,
                                #         componentJsonPath, variablesJsonPath,
                                #         manifestPath, checkpointPath, syncReportPath
```

### Conventions every task must follow

- **Language/runtime:** TypeScript, Bun. Use `bun:sqlite` (native FTS5 support — no extra dep). No CommonJS.
- **Validation:** every external/persisted shape goes through a Zod schema in or near the module that owns it.
- **Errors:** all user-facing errors are **plain English** via `KotikitError`. Surface Figma-specific failures (401 / 403 / 404 / 429) with remediation lines:
  - 401: "Your Figma token is missing or invalid. Check FIGMA_TOKEN in .env."
  - 403 on `/variables/local`: "Local variables require Figma Enterprise. Skipped — styles were synced normally."
  - 403 on file read: "Your Figma token doesn't have access to file <key>. Make sure it's published to your team."
  - 404: "Figma can't find file <key>. The key may be wrong or the file may be private."
  - 429: handled by backoff; if exhausted, "Figma is rate-limiting us. Try again in a few minutes."
- **Network discipline.** All Figma API calls go through `FigmaClient` (so they all share rate limiting and backoff). No ad-hoc `fetch("https://api.figma.com/...")` anywhere else.
- **No live Figma in tests.** Every test that touches the sync pipeline injects a stub `fetch`. The repo must work fully offline. The single optional live smoke test (if added) lives behind an env-gated `describe.skipIf(!process.env.LIVE_FIGMA)` block — never in default test runs.
- **One SQLite write transaction per sync.** Open the DB, begin a transaction, write everything, commit. Sync failure = rollback; checkpoint records which stages completed.
- **Path discipline.** Never hand-build a `design-system/...` path string inside the sync engine — go through helpers in `util/paths.ts`. This keeps the test code that writes to a temp dir trivially redirectable.

### Shared types (canonical)

These types define the on-disk shape and are imported everywhere. Define them in the file that owns the artifact.

```ts
// src/sync/component-shape.ts
export const ComponentJsonSchema = z.object({
  name: z.string(),                 // "Button"
  key: z.string(),                  // Figma component-set key (stable GUID)
  fileKey: z.string(),              // Source Figma file key
  path: z.string(),                 // "components/button.json" (relative to design-system/)
  description: z.string().optional(),
  variants: z.array(z.object({
    propertyName: z.string(),       // "Variant"
    values: z.array(z.string()),    // ["Primary", "Secondary", "Destructive", "Ghost"]
  })).default([]),
  properties: z.record(z.string(), z.object({   // boolean / text / instance-swap properties
    type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]),
    defaultValue: z.union([z.string(), z.boolean()]).optional(),
  })).default({}),
  defaultKey: z.string().optional(),// key of the default variant (for Figma node lookup)
  thumbnailUrl: z.string().optional(),
  updatedAt: z.string(),            // ISO-8601
});
export type ComponentJson = z.infer<typeof ComponentJsonSchema>;
```

```ts
// src/sync/variables.ts
export const VariableEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["color", "text", "effect", "number", "spacing"]),
  source: z.enum(["variable", "style"]),
  value: z.unknown(),               // shape depends on kind — colors are hex/rgba, text is style obj, etc.
  modes: z.record(z.string(), z.unknown()).optional(),     // light/dark — variables only
  description: z.string().optional(),
});
export const VariablesJsonSchema = z.object({
  version: z.literal(1),
  entries: z.array(VariableEntrySchema),
  collisions: z.array(z.object({
    name: z.string(),
    keptSource: z.enum(["variable", "style"]),
  })).default([]),
});
```

```ts
// src/sync/manifest.ts (or inline in src/sync/multi-file.ts)
export const SyncManifestSchema = z.object({
  version: z.literal(1),
  lastSyncAt: z.string(),
  files: z.array(z.object({
    key: z.string(),
    name: z.string(),
    componentCount: z.number(),
    iconCount: z.number(),
  })),
  conflicts: z.array(z.object({
    name: z.string(),
    winnerFileKey: z.string(),
    losers: z.array(z.object({
      fileKey: z.string(),
      key: z.string(),                // displaced Figma component key
    })),
  })).default([]),
});
```

```ts
// src/sync/checkpoint.ts
export const CheckpointSchema = z.object({
  version: z.literal(1),
  startedAt: z.string(),
  files: z.array(z.object({
    fileKey: z.string(),
    stage: z.enum(["metadata", "components", "component_sets", "styles",
                   "variables", "node_details", "icons", "done"]),
    cursor: z.object({                // present only when stage === "node_details"
      processed: z.number().int().nonnegative(),
      batchSize: z.number().int().positive(),
    }).optional(),
  })),
});
```

---

## 1. Dependency tiers (the build order)

Tasks in the same tier have **no dependencies on each other** and can be executed in parallel. Each task ends with **one atomic git commit** in conventional-commits format (`feat(<scope>): <summary>`), with the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

| Tier | Tasks | Theme |
|---|---|---|
| **Tier 0** | P2-A1, P2-A2, P2-A3, P2-A4 | Foundations: path helpers, op:// resolver, SQLite open helper, CamelCase splitter |
| **Tier 1** | P2-B1, P2-B2, P2-B3 | Storage modules: components-db, icons-db, checkpoint store |
| **Tier 2** | P2-C1, P2-C2, P2-C3 | Figma surface: rate-limit + backoff, FigmaClient, component-shape mapper |
| **Tier 3** | P2-D1, P2-D2, P2-D3 | Sync internals: icon detector, variables merger, per-file sync engine |
| **Tier 4** | P2-D4 | Multi-file orchestrator with collisions |
| **Tier 5** | P2-E1, P2-E2, P2-E3 | MCP tools wired to engines |
| **Tier 6** | P2-F1, P2-F2 | Wire into server.ts + end-to-end smoke test |

Dependency graph:

```
A1 (paths)           ─┐
A2 (op:// secrets)   ─┼─► (B1, B2, B3)  ─┐
A3 (sqlite open)     ─┤                  ├─► D3 (per-file sync) ─► D4 (multi-file) ─► E1/E2/E3 (tools) ─► F1 (wire) ─► F2 (E2E)
A4 (camel split)     ─┘                  │
C1 (rate-limit)  ─► C2 (FigmaClient) ───►┤
                     C3 (mapper) ────────┘
                     D1 (icon-detect) ───┐
                     D2 (variables)    ──┴────► (joins at D3)
```

---

## TIER 0 — Foundations (no dependencies, start immediately)

### P2-A1 — Path helpers for `design-system/`
**Depends on:** none
**Complexity:** S

**What to build**

Extend `src/util/paths.ts`:

```ts
export const DESIGN_SYSTEM_DIR = "design-system";
export const designSystemDir = (root: string): string => `${root}/design-system`;
export const componentsDbPath = (root: string): string => `${root}/design-system/components.db`;
export const iconsDbPath = (root: string): string => `${root}/design-system/icons.db`;
export const variablesJsonPath = (root: string): string => `${root}/design-system/variables.json`;
export const manifestPath = (root: string): string => `${root}/design-system/manifest.json`;
export const componentJsonPath = (root: string, slug: string): string =>
  `${root}/design-system/components/${slug}.json`;
export const checkpointPath = (root: string): string => `${root}/design-system/.sync-checkpoint.json`;
export const syncReportPath = (root: string): string => `${root}/design-system/.sync-report.json`;
```

Add `slugifyComponentName(name)` to `src/util/ids.ts` returning `"Pie Chart"` → `"pie-chart"`, `"TextField"` → `"text-field"`. (Reuse existing `slugify` if it already covers these cases — verify in tests.)

**Acceptance criteria**
- `bun test src/util/paths.test.ts`: each new helper returns the expected absolute path given a root.
- `slugifyComponentName("Pie Chart") === "pie-chart"`, `slugifyComponentName("TextField") === "text-field"`, `slugifyComponentName("ic_arrow")` → `"ic-arrow"`.

**Commit**: `feat(util): add design-system path helpers and component slugifier`

---

### P2-A2 — `op://` secret resolution
**Depends on:** none
**Complexity:** S

**What to build**

Extend `src/config/load.ts`. Today `resolveSecret` returns `op://...` strings unchanged. Now:

- Detect `op://...` strings.
- Shell out via `Bun.spawn(["op", "read", value])`. Read stdout, trim trailing newline.
- If `op` is not installed or the read fails, **do not throw** — return `undefined` (treat as "no token resolved"). Surface a one-line note in the sync-time error message ("1Password CLI isn't available, so I couldn't resolve op://...").
- Make the function `async` (`resolveSecret` is now `Promise<string | undefined>`). Update every call site accordingly.

**Acceptance criteria**
- `bun test src/config/load.test.ts`:
  - With `op` available + a mock: `resolveSecret("op://x/y/z")` resolves to the spawn output.
  - With `op` failing or absent: returns `undefined`, no throw.
  - `resolveSecret("${FIGMA_TOKEN}")` still works (env path unchanged).
  - `resolveSecret(undefined)` still returns `undefined`.

**Implementation tip**
- The op CLI binary may not exist in the test environment. Mock it via dependency injection: accept an optional `spawn` parameter on a non-exported internal that the exported `resolveSecret` calls. Tests pass a stub.

**Commit**: `feat(config): add op:// secret resolution via 1Password CLI`

---

### P2-A3 — SQLite open helper + pragmas
**Depends on:** none
**Complexity:** S

**What to build**

`src/db/sqlite.ts`:

```ts
import { Database } from "bun:sqlite";

/** Open a db at `path`, create dirs as needed, apply standard pragmas. */
export function openDb(path: string): Database {
  // mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA synchronous = NORMAL;`);
  db.exec(`PRAGMA foreign_keys = ON;`);
  return db;
}

/** Run `fn` inside a single transaction. Rolls back on throw. */
export function withTransaction<T>(db: Database, fn: () => T): T {
  // Use bun:sqlite's db.transaction(...) wrapper.
}
```

**Acceptance criteria**
- `bun test src/db/sqlite.test.ts`:
  - `openDb` creates the parent directory if missing.
  - WAL mode is set (`PRAGMA journal_mode` returns `"wal"`).
  - `withTransaction` rolls back changes if the callback throws.
  - `withTransaction` commits on success.

**Commit**: `feat(db): add bun:sqlite open helper with WAL and transactions`

---

### P2-A4 — CamelCase token splitter
**Depends on:** none
**Complexity:** S

**What to build**

`src/db/camel-tokens.ts`:

```ts
/** Build the value of the `name_tokens` FTS5 column. */
export function buildNameTokens(name: string): string {
  // "IconArrowLeft" → "IconArrowLeft Icon Arrow Left"
  // "Button"        → "Button"
  // "PieChart 3D"   → "PieChart 3D Pie Chart 3D"
  // "TextField"     → "TextField Text Field"
  // "ic_arrow"      → "ic_arrow ic arrow"  (splits on _ and -)
  // Strategy: include the original, then add the camel/snake/kebab split tokens.
}
```

Rules:
- Always include the original string.
- Split on transitions: lowercase→uppercase, letter→digit, plus `_`, `-`, `/`, whitespace.
- Acronyms stay grouped (`HTTPSConfig` → `HTTPS Config`).
- Drop empty tokens.

**Acceptance criteria**
- `bun test src/db/camel-tokens.test.ts` proves all six examples above.

**Commit**: `feat(db): add camel/snake/kebab token splitter for FTS5 name_tokens`

---

## TIER 1 — Storage modules (depend on Tier 0)

### P2-B1 — `components.db` schema and DAO
**Depends on:** P2-A1, P2-A3, P2-A4
**Complexity:** M

**What to build**

`src/db/components-db.ts`:

```ts
export interface ComponentRow {
  name: string;
  path: string;        // "components/button.json"
  key: string;         // Figma component-set key
  fileKey: string;     // source Figma file
  props: string;       // space-separated property names ("Variant State Size Icon")
}

export function initComponentsDb(db: Database): void;     // CREATE VIRTUAL TABLE components ...
export function clearComponents(db: Database): void;     // DELETE FROM components
export function upsertComponent(db: Database, row: ComponentRow): void;   // INSERT or REPLACE by name
export interface ComponentSearchResult { name: string; path: string; key: string; fileKey: string; }
export function searchComponents(db: Database, queryTerm: string, limit?: number): ComponentSearchResult[];
```

Schema (FTS5):

```sql
CREATE VIRTUAL TABLE components USING fts5(
  name,
  name_tokens,
  path UNINDEXED,
  key UNINDEXED,
  file_key UNINDEXED,
  props,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

`upsertComponent` builds `name_tokens` via `buildNameTokens(row.name)`. Because FTS5 lacks `INSERT OR REPLACE` on virtual tables, implement upsert as `DELETE FROM components WHERE name = ?; INSERT INTO components ...;` inside the calling transaction.

`searchComponents` runs:
```sql
SELECT name, path, key, file_key FROM components
WHERE components MATCH ?
ORDER BY rank
LIMIT ?;
```
where the match expression searches across `name` and `name_tokens` columns. Default `limit = 25`.

**Acceptance criteria**
- `bun test src/db/components-db.test.ts` (use `:memory:` DB):
  - Init creates the table.
  - Insert + search round-trip (`searchComponents(db, "button*")` finds an inserted `Button`).
  - CamelCase: inserting `IconArrowLeft` makes `searchComponents(db, "arrow*")` find it.
  - Upsert by name overwrites the prior row (count stays 1; `key` updates).

**Commit**: `feat(db): add components FTS5 table with CamelCase tokens and upsert`

---

### P2-B2 — `icons.db` schema and DAO
**Depends on:** P2-A1, P2-A3, P2-A4
**Complexity:** S

**What to build**

`src/db/icons-db.ts`:

```ts
export interface IconRow {
  name: string;       // "arrow-right"
  key: string;        // Figma node/component key
  svg?: string;       // optional inline svg; UNINDEXED
  signal: "page" | "prefix" | "slash";   // which detector matched
  fileKey: string;
}

export function initIconsDb(db: Database): void;
export function clearIcons(db: Database): void;
export function upsertIcon(db: Database, row: IconRow): void;
export function searchIcons(db: Database, queryTerm: string, limit?: number): {
  name: string; key: string; signal: string; fileKey: string;
}[];
```

Schema:

```sql
CREATE VIRTUAL TABLE icons USING fts5(
  name,
  name_tokens,
  key UNINDEXED,
  svg UNINDEXED,
  signal UNINDEXED,
  file_key UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

`searchIcons` returns `name, key, signal, file_key` (NOT `svg` by default — keep the result token-cheap; a separate `getIconSvg(db, name)` reads svg on demand).

**Acceptance criteria**
- `bun test src/db/icons-db.test.ts`:
  - Insert `arrow-right`, `arrow-left`, `home`. `searchIcons(db, "arrow*")` returns two rows; `home` is not in the result.
  - `searchIcons` result rows do not include the `svg` field.
  - `getIconSvg(db, "arrow-right")` returns the stored svg string.

**Commit**: `feat(db): add icons FTS5 table with signal column and svg lazy read`

---

### P2-B3 — Checkpoint store (atomic read/write/clear)
**Depends on:** P2-A1
**Complexity:** S

**What to build**

`src/sync/checkpoint.ts`:

```ts
import { CheckpointSchema, type Checkpoint } from "./checkpoint-schema.js";  // or inline

export async function readCheckpoint(root: string): Promise<Checkpoint | null>;
/** Atomic write: writeFile to `<path>.tmp`, then rename to `<path>`. */
export async function writeCheckpoint(root: string, cp: Checkpoint): Promise<void>;
export async function clearCheckpoint(root: string): Promise<void>;  // remove the file
export async function hasCheckpoint(root: string): Promise<boolean>;
```

Use the Zod `CheckpointSchema` from §0 to validate on read. A malformed checkpoint logs a one-line note to stderr (`[kotikit] discarding malformed checkpoint`) and returns `null` — never throws.

**Acceptance criteria**
- `bun test src/sync/checkpoint.test.ts` (temp dir):
  - Write then read round-trips.
  - Write atomicity: simulate by writing a sentinel `.tmp` and asserting the real file is only created after rename.
  - Malformed JSON → `readCheckpoint` returns `null`, file remains untouched.
  - `clearCheckpoint` removes the file; subsequent `hasCheckpoint` returns false.

**Commit**: `feat(sync): add atomic checkpoint store with zod validation`

---

## TIER 2 — Figma surface (depend on Tier 0)

### P2-C1 — Rate limiter + jittered backoff
**Depends on:** none
**Complexity:** M

**What to build**

`src/sync/rate-limit.ts`:

```ts
/** Minimal bottleneck-like wrapper. minTime between starts, maxConcurrent in flight. */
export function createLimiter(opts: { minTime: number; maxConcurrent: number }): {
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
};
```

`src/sync/backoff.ts`:

```ts
export interface BackoffOpts {
  initialMs?: number;     // default 500
  maxMs?: number;         // default 30_000
  jitterMs?: number;      // default 250
  maxAttempts?: number;   // default 6
}
export interface RetryableError {
  status: number;         // 429 | 5xx → retry; others → throw
  retryAfterMs?: number;  // honor Retry-After if present
}

/** Run fn with retry on RetryableError. Exponential growth + jitter. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => null | RetryableError,
  opts?: BackoffOpts
): Promise<T>;
```

**Acceptance criteria**
- `bun test src/sync/rate-limit.test.ts`:
  - `minTime: 100, maxConcurrent: 2` — scheduling four functions that each take 0ms still respects 100ms spacing and 2-at-a-time concurrency.
- `bun test src/sync/backoff.test.ts`:
  - Returns immediately on success.
  - Retries on the configured retryable error and eventually succeeds.
  - Throws original error after `maxAttempts`.
  - Honors `retryAfterMs` if returned.
  - Jitter is bounded: consecutive delays are not strictly equal.

**Commit**: `feat(sync): add rate limiter and jittered exponential backoff`

---

### P2-C2 — Figma REST client
**Depends on:** P2-C1
**Complexity:** L

**What to build**

`src/sync/figma-types.ts` — Zod schemas for the API responses we actually use. Keep them narrow; pull only the fields we need. (Figma responses have many fields we will not use; lean on `z.object({...}).passthrough()` to ignore extras.)

`src/sync/figma-client.ts`:

```ts
export interface FigmaClientOpts {
  token: string;
  fetch?: typeof globalThis.fetch;          // injectable for tests
  limiter?: ReturnType<typeof createLimiter>;
  backoffOpts?: BackoffOpts;
  baseUrl?: string;                         // default "https://api.figma.com"
}

export class FigmaClient {
  constructor(opts: FigmaClientOpts);
  getFile(fileKey: string): Promise<FigmaFile>;
  getComponents(fileKey: string): Promise<FigmaPublishedComponent[]>;
  getComponentSets(fileKey: string): Promise<FigmaComponentSet[]>;
  getStyles(fileKey: string): Promise<FigmaStyle[]>;
  /** Returns null on 403 — Enterprise-gated; caller should warn and continue. */
  getLocalVariables(fileKey: string): Promise<FigmaLocalVariables | null>;
  getNodes(fileKey: string, ids: string[]): Promise<Record<string, FigmaNode>>;
}
```

Required behaviors:
- Every request: `Authorization: Bearer <token>` (Figma also accepts `X-Figma-Token: <token>` — pick one and stick with it).
- All requests scheduled through the limiter, wrapped in `withBackoff`.
- A request maps `{ status: 429 | 5xx }` Response objects to a `RetryableError` for backoff. `Retry-After` header (seconds or HTTP date) populates `retryAfterMs`.
- A `403` from `getLocalVariables` returns `null` (NOT an error).
- Any other non-2xx maps to a `KotikitError` with the remediation lines from §0.
- `getNodes` chunks `ids` into batches of 100 (Figma's per-request limit on this endpoint is large but conservative is safer); each chunk is one limiter slot.

**Acceptance criteria**
- `bun test src/sync/figma-client.test.ts` (using a stub `fetch`):
  - `getFile` returns parsed file data, sends correct `Authorization` header.
  - 429 with `Retry-After: 1` retries and succeeds.
  - 403 on `getLocalVariables` → returns `null`, no throw.
  - 403 on `getFile` → throws `KotikitError` with the "doesn't have access" message.
  - 401 → throws `KotikitError` with the "token is missing or invalid" message.
  - `getNodes` with 250 ids issues exactly 3 batched calls (100, 100, 50).

**Commit**: `feat(sync): add Figma REST client with rate limiting and backoff`

---

### P2-C3 — Component shape mapper
**Depends on:** P2-A1
**Complexity:** M

**What to build**

`src/sync/component-shape.ts`:

```ts
/** Build the on-disk ComponentJson from raw Figma data. */
export function buildComponentJson(input: {
  fileKey: string;
  publishedComponent: FigmaPublishedComponent;          // from /components
  componentSet?: FigmaComponentSet;                     // from /component_sets (optional)
  nodeDetails?: FigmaNode;                              // from /nodes (optional but ideal)
}): ComponentJson;
```

Rules:
- `name` = the component set name when present, otherwise the component name.
- `key` = component set key when present, otherwise component key.
- `path` = `components/${slugifyComponentName(name)}.json`.
- `variants[]` = parsed from `componentSet.componentPropertyDefinitions` (or equivalent on node) — group by property name, list distinct values. If only a single `Component` with no variants, `variants` is `[]`.
- `properties` = parsed from boolean/text/instance-swap property definitions. `VARIANT`-type properties appear in `variants[]`, not `properties{}` — but include them in the `props` string (P2-B1's column) for FTS5.
- `defaultKey` = the component set's default component key, when present.
- `description`, `thumbnailUrl` = passthrough if present.
- `updatedAt` = current ISO timestamp.

Return value is validated through `ComponentJsonSchema.parse(...)` before returning.

**Acceptance criteria**
- `bun test src/sync/component-shape.test.ts` with fixture inputs:
  - A Button with 4 variants on `Variant` + 2 on `Size` → returns `variants: [{ propertyName: "Variant", values: [...4...] }, { propertyName: "Size", values: [...2...] }]`.
  - A property of type `BOOLEAN` ends up in `properties{}`, not `variants[]`.
  - Path is `components/button.json` for name `"Button"`.

**Commit**: `feat(sync): add Figma component-shape mapper to ComponentJson`

---

## TIER 3 — Sync internals (depend on Tier 1 and Tier 2)

### P2-D1 — Icon detector
**Depends on:** none (pure function over inputs from C2)
**Complexity:** S

**What to build**

`src/sync/icon-detect.ts`:

```ts
export type IconSignal = "page" | "prefix" | "slash" | null;

export function detectIconSignal(input: {
  pageName: string;
  componentName: string;
}): IconSignal;
```

Rules (precedence on multi-match: `page` > `prefix` > `slash`):
1. `pageName` matches `/^icons?$/i` → `"page"`.
2. `componentName` matches `/^(ic[-_]|icon[\/_])/i` or `/.+\.icon$/i` → `"prefix"`.
3. `componentName` starts with `Icon/` (or `Icons/`) — the slash convention — → `"slash"`.
4. Otherwise → `null`.

**Acceptance criteria**
- `bun test src/sync/icon-detect.test.ts`: each rule has a positive and a negative case, and a multi-match input is classified by the highest-precedence signal.

**Commit**: `feat(sync): add three-signal icon detector with precedence`

---

### P2-D2 — Variables and styles merger
**Depends on:** P2-A1
**Complexity:** M

**What to build**

`src/sync/variables.ts`:

```ts
/** Merge Figma variables (may be null) and styles into a single VariablesJson. */
export function mergeVariables(input: {
  variables: FigmaLocalVariables | null;
  styles: FigmaStyle[];                      // resolved with node details for color/text/effect values
  styleDetailsByNodeId: Record<string, FigmaNode>;   // from /nodes
}): VariablesJson;

/** Write to design-system/variables.json (pretty JSON + newline). */
export async function writeVariablesJson(root: string, data: VariablesJson): Promise<void>;
```

Rules:
- Each Figma style → one `VariableEntry` with `source: "style"`, `kind` inferred from `styleType` (`FILL` → `"color"`, `TEXT` → `"text"`, `EFFECT` → `"effect"`).
- Each Figma local variable → one entry with `source: "variable"`, `kind` from `resolvedType`. Populate `modes` when the variable has multiple mode values.
- Name collisions: variables win, styles lose. Record the collision in `collisions[]`.
- Output is validated via `VariablesJsonSchema.parse`.

**Acceptance criteria**
- `bun test src/sync/variables.test.ts`:
  - A color style and a color variable with the same name → variable kept, collision recorded.
  - A variable with two modes → `modes` populated.
  - No variables (null input) → output contains only style-sourced entries.

**Commit**: `feat(sync): add variables/styles merger writing flat variables.json`

---

### P2-D3 — Per-file sync engine
**Depends on:** P2-B1, P2-B2, P2-B3, P2-C2, P2-C3, P2-D1, P2-D2
**Complexity:** L

**What to build**

`src/sync/sync-engine.ts`:

```ts
export interface SyncOneFileOpts {
  root: string;
  client: FigmaClient;
  fileKey: string;
  fileName: string;
  componentsDb: Database;
  iconsDb: Database;
  resumeFrom?: FileCheckpoint;   // single element of CheckpointSchema.files
}

export interface SyncOneFileResult {
  fileKey: string;
  componentCount: number;
  iconCount: number;
  variables: VariablesJson;       // returned, NOT written here — multi-file writes the merged variables.json
  componentJsons: ComponentJson[];// returned for the multi-file orchestrator to write
  pageNameByNodeId: Record<string, string>;   // for icon detection
}

export async function syncOneFile(opts: SyncOneFileOpts): Promise<SyncOneFileResult>;
```

Algorithm (each step writes the checkpoint on completion, atomically):
1. **metadata** — `client.getFile(fileKey)` → record top-level page-name-by-node-id.
2. **components** — `client.getComponents(fileKey)`.
3. **component_sets** — `client.getComponentSets(fileKey)`.
4. **styles** — `client.getStyles(fileKey)`.
5. **variables** — `client.getLocalVariables(fileKey)` (may return `null`, that's fine).
6. **node_details** — collect node ids needed for style values and (optionally) component metadata; `client.getNodes(fileKey, idsBatch)` per batch; advance the cursor `{ processed }` on each successful batch.
7. **icons** — classify each component via `detectIconSignal`; icons → `upsertIcon` on `iconsDb`; non-icons → `buildComponentJson` and add to `componentJsons[]`; non-icon FTS5 rows → `upsertComponent` on `componentsDb`.
8. **done** — return the result.

Rules:
- Everything that writes to a DB happens inside a single `withTransaction` started by the caller (multi-file). `syncOneFile` does NOT own the transaction.
- `syncOneFile` does NOT write `variables.json`, `manifest.json`, or per-component JSONs — those are returned for the multi-file orchestrator to write at the end (so collisions can be resolved).
- A `resumeFrom` whose stage is `"done"` short-circuits and returns the cached values from a prior partial result if available; otherwise proceed (a coarse "we already finished, but we have no result cached" case just re-fetches that file — Phase 2 doesn't try to persist intermediate results across process restarts).

**Acceptance criteria**
- `bun test src/sync/sync-engine.test.ts` (stub FigmaClient, in-memory DBs):
  - Happy path: a single-file fixture with 3 components and 2 icons produces a result with `componentCount: 3, iconCount: 2`, and writes the correct FTS5 rows.
  - Resume: a checkpoint at stage `styles` causes the engine to start at `styles` (assert by spy on the FigmaClient methods — `getFile/getComponents/getComponentSets` are NOT called).
  - 403 on variables: variables in the result is `{ entries: [] }` plus style entries.

**Commit**: `feat(sync): add per-file sync engine with stage checkpoints`

---

## TIER 4 — Multi-file orchestrator (depends on Tier 3)

### P2-D4 — Multi-file orchestrator
**Depends on:** P2-D3, P2-D2 (writer), P2-A1
**Complexity:** M

**What to build**

`src/sync/multi-file.ts`:

```ts
export interface SyncAllOpts {
  root: string;
  files: { key: string; name: string }[];   // from config.figma.designSystemFiles
  client: FigmaClient;
}

export interface SyncReport {
  ranAt: string;
  files: { key: string; name: string; componentCount: number; iconCount: number }[];
  conflicts: { name: string; winnerFileKey: string; losers: { fileKey: string; key: string }[] }[];
  variableCollisions: { name: string; keptSource: "variable" | "style" }[];
  skipped?: { stage: string; reason: string }[];   // e.g. "variables: Enterprise-gated"
}

export async function syncAllFiles(opts: SyncAllOpts): Promise<SyncReport>;
```

Algorithm:
1. Open both DBs (`componentsDb`, `iconsDb`) via `openDb`.
2. Read existing checkpoint via `readCheckpoint`. Otherwise start fresh.
3. For each file in **declared order**:
   - Build `SyncOneFileOpts`, call `syncOneFile` to get `result`.
   - For each component in `result.componentJsons`:
     - If a row already exists in `componentsDb` for that name (from an earlier file), record the displacement in `conflicts[]`, then `upsertComponent` (overwrites) and `writeFile(componentJsonPath(root, slug), JSON.stringify(spec, null, 2) + "\n")`.
   - Merge `result.variables` into the running `variablesJson` (with collisions). The last variables-vs-style collision rule still applies.
   - Append to the running checkpoint and atomically write it.
4. After all files: `writeVariablesJson` (merged), write `manifest.json` (small — counts + conflicts + lastSyncAt), `clearCheckpoint`.
5. Write `.sync-report.json` (the `SyncReport` object).

The whole DB-write phase (per-file `syncOneFile` + collision handling) is wrapped in a single `withTransaction` per DB. If a file's sync throws, the DB rolls back, but the checkpoint persists so a re-run resumes.

**Acceptance criteria**
- `bun test src/sync/multi-file.test.ts` (stub client, in-memory DBs, temp dir):
  - Two files, both publish `Button`: only one `Button` row in `componentsDb`; the row's `file_key` matches the second file; `conflicts[]` lists `Button` with `winnerFileKey = file2`.
  - `manifest.json` is created and parses against `SyncManifestSchema`.
  - On a thrown error mid-file: checkpoint reflects the partial progress; DB has no half-written rows; re-running with the same checkpoint completes.

**Commit**: `feat(sync): add multi-file orchestrator with collision recording`

---

## TIER 5 — MCP tools (depend on Tiers 1–4)

### P2-E1 — `kotikit_ds_search` + `kotikit_ds_get_component`
**Depends on:** P2-B1, P2-A1
**Complexity:** S

**What to build**

`src/mcp/tools/ds-search.ts` exports `registerDsSearchTools(registry, ctx)`. Two tools:

- `kotikit_ds_search` — input `{ query: string; limit?: number }`. Opens `componentsDb` (read-only via `bun:sqlite`'s readonly mode). Runs `searchComponents`. Returns `toolText("Found <n> components matching <query>.", { results: [{name, path, key, fileKey}] })`. If `design-system/` doesn't exist yet, return `toolError(new KotikitError("Your design system hasn't been synced yet.", "Use sync_ds to pull it from Figma first."))`.

- `kotikit_ds_get_component` — input `{ path: string }` (the path returned by search, e.g. `"components/button.json"`). Reads `design-system/<path>`. Validates with `ComponentJsonSchema`. Returns `toolText("Here is the <name> component.", componentJson)`. Friendly error if file missing.

**Acceptance criteria**
- `bun test src/mcp/tools/ds-search.test.ts` (temp dir, init DB with two components + write the JSON files):
  - `ds_search({ query: "but*" })` returns a result containing `Button`.
  - `ds_get_component({ path: "components/button.json" })` returns the JSON.
  - `ds_search` with no design system yet → friendly error.

**Commit**: `feat(mcp): add ds_search and ds_get_component tools`

---

### P2-E2 — `kotikit_icons_search`
**Depends on:** P2-B2
**Complexity:** S

**What to build**

`src/mcp/tools/icons-search.ts` exports `registerIconsSearchTools(registry, ctx)`:

- `kotikit_icons_search` — input `{ query: string; limit?: number; includeSvg?: boolean }`. Default `includeSvg: false`. Calls `searchIcons` (or `getIconSvg` for each row when `includeSvg`). Returns `toolText("Found <n> icons matching <query>.", { results })`.

**Acceptance criteria**
- `bun test src/mcp/tools/icons-search.test.ts`:
  - `icons_search({ query: "arrow*" })` returns icon rows without svg by default.
  - `icons_search({ query: "arrow*", includeSvg: true })` includes svg strings.

**Commit**: `feat(mcp): add icons_search tool with optional svg payload`

---

### P2-E3 — `kotikit_sync_ds`
**Depends on:** P2-D4, P2-A2 (op:// resolution)
**Complexity:** M

**What to build**

`src/mcp/tools/sync.ts` exports `registerSyncTools(registry, ctx)`:

- `kotikit_sync_ds` — input `{ resume?: boolean }` (default `true` — pick up where the last sync left off if a checkpoint exists). Flow:
  1. `loadConfig(ctx.root)` → resolve `figma.token` via the updated `resolveSecret`. If `undefined`, return a friendly error explaining how to set `FIGMA_TOKEN` or use `op://`.
  2. If `config.figma.designSystemFiles` is empty → friendly error: "There are no Figma files configured yet. Add one in the init conversation, or edit `.kotikit/config.json`."
  3. Build `FigmaClient`, build `SyncAllOpts` from config, call `syncAllFiles`.
  4. Return `toolText("Synced <n> files. <c> components, <i> icons. <k> name conflicts.", report)`.
  5. Errors from sync map to `toolError(KotikitError)` with the plain-English Figma remediation lines from §0. If a checkpoint remains on disk after a failure, mention it ("Run sync again and it will resume from where it stopped.").

**Acceptance criteria**
- `bun test src/mcp/tools/sync.test.ts` (stub FigmaClient via fetch injection, temp dir):
  - Happy path: config with two files → tool returns success, `.kotikit/`/`design-system/` populated, checkpoint cleared.
  - No token → friendly error.
  - No files configured → friendly error.
  - First sync fails mid-second-file → checkpoint exists; second invocation completes.

**Commit**: `feat(mcp): add sync_ds tool with resume semantics`

---

## TIER 6 — Wiring & end-to-end (depend on Tier 5)

### P2-F1 — Wire tools into `server.ts`
**Depends on:** P2-E1, P2-E2, P2-E3
**Complexity:** S

**What to build**

Edit `src/mcp/server.ts`. Add four `register*Tools` calls (`registerDsSearchTools`, `registerIconsSearchTools`, `registerSyncTools` — three modules, four tools total). Update `src/mcp/server.test.ts` so the "registers all Phase 2 tools" assertion includes the four new names.

**Acceptance criteria**
- `bun test src/mcp/server.test.ts` passes with the new tools registered.
- `bun x tsc --noEmit` is clean.

**Commit**: `feat(mcp): register phase 2 sync and search tools in server`

---

### P2-F2 — End-to-end smoke test
**Depends on:** P2-F1
**Complexity:** M

**What to build**

`test/e2e/phase2.test.ts`. Same pattern as `phase1.test.ts` — build a registry against a temp dir, but with a stub `FigmaClient` (inject `fetch` returning fixture responses). Drives `/kotikit:auto` from sync perspective:

1. Init config with a Figma token (env var path is fine — write `${FIGMA_TOKEN}` and set `process.env.FIGMA_TOKEN` for the test) and two design-system files.
2. Call `kotikit_sync_ds`.
3. Assert: `design-system/components.db`, `design-system/icons.db`, `design-system/variables.json`, `design-system/manifest.json`, `design-system/components/*.json` exist.
4. Assert: `manifest.json` validates against `SyncManifestSchema`, lists both files and a name conflict (the fixture is rigged so both files publish a `Button`).
5. Assert: `kotikit_ds_search({ query: "button*" })` returns one Button row; its `fileKey` is file 2.
6. Assert: `kotikit_ds_get_component({ path: returned.path })` validates against `ComponentJsonSchema`.
7. Assert: `kotikit_icons_search({ query: "arrow*" })` returns at least one icon and the rows do not include `svg`.
8. Failure-then-resume sub-test: rig the fixture fetch so the second file throws on its third request, run `sync_ds`, assert checkpoint persists, flip the fixture to success, run `sync_ds` again, assert it completes and the checkpoint is gone.

**Acceptance criteria**
- `bun test test/e2e/phase2.test.ts` passes end-to-end.
- `bun x tsc --noEmit` is clean for the whole repo.

**Commit**: `test(e2e): add phase 2 sync and search smoke test`

---

## 2. Definition of Done for Phase 2

- [ ] `bun install`, `bun x tsc --noEmit`, and `bun test` all pass.
- [ ] `bun run src/mcp/server.ts` exposes the four new tools (`kotikit_sync_ds`, `kotikit_ds_search`, `kotikit_ds_get_component`, `kotikit_icons_search`).
- [ ] A designer (or the E2E test acting as one) can: configure Figma files → run `kotikit_sync_ds` → query the local mirror via search → read one component JSON by path — without ever loading a manifest or full DB into context.
- [ ] Token-discipline rule is honored: search results return only `{name, path, key, fileKey}` rows; icon search excludes svg unless explicitly requested; no tool reads `manifest.json` for lookups.
- [ ] Multi-file collisions are recorded in `manifest.json.conflicts[]`; later-listed file wins.
- [ ] Variables and styles merge into one `variables.json`; variable wins on name collision.
- [ ] A killed sync resumes from the last completed stage via `.sync-checkpoint.json` (and from the last completed batch within `node_details`).
- [ ] No live Figma calls in the default test suite. Every test injects `fetch` or a stub `FigmaClient`.
- [ ] op:// secret resolution works (or returns `undefined` gracefully when `op` is not installed).
- [ ] Each task lands as one atomic commit with a conventional-commits subject and the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

## 3. Parallelization summary (for a swarm of agents)

- **Wave 1 (4 agents):** A1, A2, A3, A4 — fully independent.
- **Wave 2 (3 agents):** B1, B2, B3 — after Wave 1.
- **Wave 3 (3 agents):** C1, C2, C3 — C2 needs C1; C3 needs A1.
- **Wave 4 (3 agents):** D1, D2, D3 — D3 depends on B/C; D1/D2 only on A.
- **Wave 5 (1 agent):** D4 — after D3.
- **Wave 6 (3 agents):** E1, E2, E3 — after D4 + B (E1/E2 only need B, can run earlier alongside D3/D4).
- **Wave 7 (1 agent):** F1 — wire into server.
- **Wave 8 (1 agent):** F2 — the proof.

Each task is sized for **one agent in 30–90 minutes** (senior dev: 2–6 hours). The three largest (C2 Figma client, D3 sync engine, F2 e2e) are L; most others are S/M.

## 4. Atomic commit discipline (read before starting any task)

- **One task = one commit.** Do not bundle two tasks into one commit. Do not split one task across two commits unless tests for the same task are added later as a follow-up.
- **Conventional commits subject.** `feat(<scope>): <imperative summary>`. Use `feat`, `fix`, `chore`, `docs`, `test`, or `refactor`. Keep the subject under 72 characters.
- **Body explains the why, not the what.** Two or three sentences. The diff explains what changed.
- **Co-author footer is mandatory.** Last line of every commit message:
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- **Do not skip hooks.** No `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- **Commit after tests pass.** Run `bun test <new files>` and `bun x tsc --noEmit` before committing. Only commit work that compiles and whose tests pass.
- **Do not amend earlier commits.** A correction is a new commit (`fix(<scope>): …`).
