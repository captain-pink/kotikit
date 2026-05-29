# Kotikit — Phase 4 Implementation Plan

> **Phase 4 deliverable:** *A designer says "scaffold my design system in code" inside `/kotikit:auto`, picks some DS components from a list (or "all of them"), and ends up with one production-grade React component per pick at `<codeComponentsDir>/ui/<kebab>.tsx`, each with a Storybook story (where Storybook is installed), each marked `synced` in the registry. All in one commit. Quality gates run once across the whole batch.*
>
> Build on Phase 1 (specs + auto-commit), Phase 2 (DS sync + search), and Phase 3 (planner + adapter + gate runner). No drift audit, no Figma plugin, no design track. Just **registry → multi-select → batch generate → gate → single commit → mark synced**.

This document is self-contained. A senior engineer or AI agent with **Phase 1+2+3 context** should be able to read it and build the right thing. Read §0 before picking up any task.

---

## 0. Orientation — what you are building (read this first)

### Architectural decisions that are non-negotiable

These were settled in advance. Do **not** re-litigate them.

1. **Registry stays at `.kotikit/registry.db`.** The master PLAN.md §3 diagram shows `design-system/registry.db` but Phase 3 placed it under `.kotikit/` and the auto-commit machinery already commits it. Moving it now would force a path migration on existing users and re-wire commit batching for no functional gain. Document the deviation in CHANGELOG.md.

2. **Schema migration adds `ds_path` and `kind`.** The Phase 3 schema has `name PRIMARY KEY, code_path, status`. Phase 4 introduces:
   - `ds_path TEXT NULL` — relative path to the per-component JSON (e.g. `components/button.json`).
   - `kind TEXT NOT NULL CHECK (kind IN ('screen','component'))` — disambiguates a screen `Cart` from a future DS component `Cart`.
   - Primary key changes from `name` to `(kind, name)`.

   Migration is gated by `PRAGMA user_version`: v0 → v1 runs `ALTER TABLE registry ADD COLUMN ds_path TEXT`, `ALTER TABLE registry ADD COLUMN kind TEXT`, backfills all existing rows with `kind='screen'`, drops the old `name` PK by recreating the table inside a single transaction, then sets `user_version = 1`. The DAO never queries `user_version` directly — `initRegistryDb` runs the migration idempotently on every open.

3. **Sync engine writes `design-only` rows during sync.** The Phase 2 multi-file orchestrator already opens a SQLite transaction per file; Phase 4 adds one more `upsertRegistryDsRow` call per non-icon component. The upsert is **merge-aware**:
   - If no row exists → insert `{kind: "component", name, ds_path, status: "design-only"}`.
   - If a row exists with `status === "design-only"` → update `ds_path` (it may have changed) and keep status.
   - If a row exists with `status === "synced"` → update `ds_path` ONLY (never downgrade status, never touch `code_path`).
   - If a row exists with `status === "code-only"` → this is unexpected for a `component` kind (Phase 3 only writes `screen` kind), but treat as a defensive merge: update `ds_path`, promote status to `"synced"` if `code_path` is present.

   Sync **never** writes `kind='screen'` rows. Sync **never** removes rows for DS components that disappeared from Figma (Phase 6 drift audit handles that).

4. **Two-tool scaffold split.** Same pattern as `implement_code_start`/`_save`:
   - `kotikit_scaffold_start({ names: string[] })` — returns the per-component context bundle Claude needs (DS component JSONs + adapter prompt + target paths + Storybook detection).
   - `kotikit_scaffold_save({ files: { path, content }[] })` — writes everything in one batch, runs gates once across the whole batch, commits all paths in one commit, upserts every successfully-saved component as `synced`.

   For discovery, **extend the existing `kotikit_registry_search`** with optional filters (`status?`, `kind?`, `limit?`); make `query` optional too so `{ status: "design-only" }` lists all unscaffolded components. No new list tool.

5. **CSF3 Storybook stories, one Default + one per variant axis.** Detect Storybook by `existsSync(<root>/.storybook)` OR a `storybook` entry in the user's `package.json` `devDependencies`. When absent: skip the story file entirely, mark the component `synced` anyway, and surface a one-line note in the tool reply ("Storybook isn't installed — story files skipped."). **Never auto-install Storybook.** Combinatorial explosion is avoided by emitting one story per axis (e.g. a Button with `Variant×Size×Disabled` → three stories: `Variants`, `Sizes`, `States` — each renders the axis values side-by-side via a `render` function in a flex row).

6. **CVA-style components with lowercased-kebab variant values.** Each Figma variant axis becomes a CVA variant key; values are slugified (`Primary` → `primary`, `On Hover` → `on-hover`). Defaults come from Figma's `defaultVariantId` mapped per axis. BOOLEAN → boolean prop, TEXT → string prop, INSTANCE_SWAP → `React.ReactNode` slot prop. Use `class-variance-authority` (the `cva` import) — emit a clean `Props = VariantProps<typeof xxxVariants> & ComponentProps<...>` derivation. Storybook controls auto-generate from the CVA shape.

7. **Scaffolded files land at `<codeComponentsDir>/ui/<kebab-name>.tsx`** plus colocated `.stories.tsx`. This is the canonical shadcn path and matches what the Phase 3 React adapter's `importStatement` already produces (`@/components/ui/<kebab>`). **No tests are generated for scaffolded components** — DS components have no acceptance criteria to drive them; users opt into stories-as-fixtures via `@storybook/test-runner` if they want regression coverage.

8. **Batch-level gates.** `kotikit_scaffold_save` runs `tsc + eslint + prettier` ONCE across the whole batch (passing all written files), then `vitest run` once IF any test files were written (which by default they aren't). tsc and eslint are dominated by startup cost; running them per-file is 10–50× slower than running them once with the file list. The gate-runner's `transformGateOutput` parsers already key failures by file path, so per-component attribution falls out for free.

### The §7 quality baseline (carried into every scaffolded component)

Same baseline as Phase 3 — TypeScript strict, WCAG-AA, no `console.log`, semantic HTML, full keyboard navigation. The React adapter's `systemPrompt` already encodes this; Phase 4 reuses it with a different "context" section (a single component spec instead of a screen spec).

### Folder layout produced by Phase 4

Inside the user's project (additive on top of Phase 3):

```
<codeComponentsDir>/
  ui/                                  # NEW — scaffolded DS components
    button.tsx
    button.stories.tsx
    card.tsx
    card.stories.tsx
    ...
  checkout-flow/                       # from Phase 3
    Cart.tsx
    Cart.test.tsx
```

Inside `.kotikit/` (additive, schema upgraded):

```
.kotikit/
  registry.db                          # schema v1: name + ds_path + code_path + kind + status
                                       # (Phase 3 wrote kind='screen' rows only;
                                       #  Phase 4 sync adds kind='component' rows)
```

### Source layout you will create

```
src/
  mcp/
    tools/
      scaffold.ts              # kotikit_scaffold_start, _save
      registry.ts              # EXTEND with status/kind/optional-query filters
      implement-code.ts        # EXTEND: upsert with kind='screen'
  codegen/
    react/
      scaffold.ts              # buildComponentFromDs + buildStoryForComponent + variant naming helpers
      cva-helpers.ts           # slugifyVariantValue, deriveVariantDefaults, formatCvaVariants
      storybook-detect.ts      # hasStorybook(root): boolean
  db/
    registry-db.ts             # MIGRATE schema + extend DAO with kind/ds_path; add new upsertRegistryDsRow, listByStatus
  sync/
    multi-file.ts              # EXTEND: upsert DS rows into registry during sync
  git/
    auto-commit.ts             # EXTEND: support subjectSuffix patterns like "/scaffold (12 components)" via existing subjectSuffix param
  util/
    paths.ts                   # EXTEND: uiComponentFile, uiStoryFile, uiDir
```

### Conventions every task must follow

- **Language/runtime:** TypeScript, Bun. No CommonJS.
- **Validation:** every external/persisted shape goes through Zod.
- **Errors:** plain English via `KotikitError`.
- **Migration is idempotent.** Calling `initRegistryDb` on a v1 database must be a no-op; on v0 must migrate and bump.
- **All scaffolded code goes through the React adapter's `systemPrompt`** — the same one Phase 3 uses, with the §7 baseline. The "for this component" section names the variant axes, defaults, slot props, and the CVA contract.
- **One commit per scaffold batch.** `kotikit_scaffold_save` writes all files, runs gates, then issues ONE `autoCommit({ subjectScope: "code", subjectSuffix: " scaffold (<n> components)" })` call. Subject reads `feat(code): create scaffold (12 components)` or for one component `feat(code): create scaffold (Button)`.
- **Gates run in the user's project root, not kotikit's.** Same rule as Phase 3.
- **The Phase 3 `implement_code_save` upsert must include `kind: "screen"`** — without this fix, the migrated schema's CHECK constraint rejects writes. This is a small but mandatory companion change to the migration.

### Shared types (canonical)

The schema extension and DAO upgrade live in `src/db/registry-db.ts`. The DAO surface after Phase 4:

```ts
export type RegistryKind = "screen" | "component";
export type RegistryStatus = "code-only" | "design-only" | "synced";

export interface RegistryRow {
  kind: RegistryKind;
  name: string;
  dsPath: string | null;     // component-side path: "components/button.json", null for screens
  codePath: string | null;   // code-side path, null when nothing is generated yet
  status: RegistryStatus;
}

export function initRegistryDb(db: Database): void;         // runs idempotent migration

/** Phase 3 + 4 entry point — used by implement_code_save (kind="screen") and scaffold_save (kind="component"). */
export function upsertRegistry(db: Database, row: RegistryRow): void;

/** Specialized merge-aware upsert used by the sync engine. Never downgrades status or clobbers code_path. */
export function upsertRegistryDsRow(db: Database, input: { name: string; dsPath: string }): void;

export function getRegistry(db: Database, kind: RegistryKind, name: string): RegistryRow | null;
export function searchRegistry(db: Database, opts: {
  query?: string;
  kind?: RegistryKind;
  status?: RegistryStatus;
  limit?: number;
}): RegistryRow[];
export function clearRegistry(db: Database): void;
```

CVA emission types:

```ts
// src/codegen/react/scaffold.ts
export interface ScaffoldComponentArgs {
  json: ComponentJson;                  // the DS component JSON read from disk
  hasStorybook: boolean;
}

export interface ScaffoldedFile {
  /** Relative path under the user's project root, e.g. "src/components/ui/button.tsx" */
  path: string;
  content: string;
}

export interface ScaffoldResult {
  componentName: string;                // PascalCase
  files: ScaffoldedFile[];              // 1 file when no Storybook, 2 when present
  notes: string[];                      // e.g. ["Storybook not detected — skipped story file."]
}

export function scaffoldComponent(args: ScaffoldComponentArgs): ScaffoldResult;
```

### Migration spec (pin this exactly — the DAO test suite enforces it)

`initRegistryDb` algorithm:

1. `db.exec("BEGIN")` — wrap the migration in a transaction.
2. Read `PRAGMA user_version` (returns 0 for fresh DBs and existing Phase 3 DBs).
3. If `version === 0`:
   - Run `CREATE TABLE IF NOT EXISTS registry (name TEXT PRIMARY KEY, code_path TEXT, status TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced')))` first — so a brand-new DB has the Phase 3 baseline before migration.
   - Migrate to v1 in-place:
     - `CREATE TABLE registry_new (kind TEXT NOT NULL CHECK (kind IN ('screen','component')), name TEXT NOT NULL, ds_path TEXT, code_path TEXT, status TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced')), PRIMARY KEY (kind, name))`
     - `INSERT INTO registry_new (kind, name, ds_path, code_path, status) SELECT 'screen', name, NULL, code_path, status FROM registry`
     - `DROP TABLE registry`
     - `ALTER TABLE registry_new RENAME TO registry`
   - `PRAGMA user_version = 1`.
4. If `version === 1`: no-op.
5. `db.exec("COMMIT")`.

The migration MUST be idempotent — running `initRegistryDb` repeatedly on a v1 database does nothing visible (PRAGMA reads, no writes).

### Auto-commit subject convention for scaffolds

- 1 component: `feat(code): create scaffold (Button)`.
- 2-5 components: `feat(code): create scaffold (Button, Card, Input)`.
- 6+ components: `feat(code): create scaffold (12 components)`.

This is built into `kotikit_scaffold_save`, NOT into `autoCommit` itself — we reuse the existing `subjectSuffix` parameter. (The `autoCommit` API surface stays unchanged from Phase 3 P3-B4.)

---

## 1. Dependency tiers (the build order)

| Tier | Tasks | Theme |
|---|---|---|
| **Tier 0** | P4-A1, P4-A2, P4-A3, P4-A4 | Foundations: schema migration, CVA helpers, Storybook detect, UI path helpers |
| **Tier 1** | P4-B1, P4-B2, P4-B3 | Scaffolder: React adapter scaffold fn, sync DS row writes, registry DAO extensions |
| **Tier 2** | P4-C1, P4-C2, P4-C3 | MCP tools: extend registry_search, scaffold_start, scaffold_save |
| **Tier 3** | P4-D1 | Phase 3 fix: implement_code_save writes `kind: "screen"` |
| **Tier 4** | P4-E1, P4-E2 | Wire into server + end-to-end smoke test |

Dependency graph:

```
A1 (schema) ─► B3 (DAO ext) ──┐
A2 (cva) ───► B1 (scaffold) ──┼─► C2/C3 (scaffold tools) ─► E1 (wire) ─► E2 (E2E)
A3 (detect) ─► B1            │
A4 (paths) ──► B1, C2, C3    │
                              ├─► C1 (registry_search ext)
                              ├─► D1 (implement_code_save fix)
                              └─► B2 (sync ext)  ──────────► E2
```

---

## TIER 0 — Foundations (no dependencies)

### P4-A1 — Registry schema migration (v0 → v1)
**Depends on:** Phase 3 `src/db/registry-db.ts`, `src/db/sqlite.ts`
**Complexity:** M

**What to build**

Edit `src/db/registry-db.ts`. Replace the existing schema with the migration logic from §0. The DAO surface keeps `initRegistryDb`, `upsertRegistry`, `getRegistry`, `searchRegistry`, `clearRegistry`. Update the public types to match the canonical types in §0 (`RegistryRow` now has `kind`, `dsPath`).

`upsertRegistry` semantics change:
- The PK is now `(kind, name)`. Existing Phase 3 calls pass `kind="screen"` (P4-D1 makes that change in `implement_code_save`).
- Test it with both `kind="screen"` and `kind="component"` rows that share a `name` — they should coexist.

`searchRegistry` signature changes to the options-bag form from §0. `query` is optional. The handler does `WHERE name LIKE :q AND (kind = :kind OR :kind IS NULL) AND (status = :status OR :status IS NULL)` — the binding pattern `OR NULL` lets the same prepared statement serve all four filter combinations. Default limit 25.

**Acceptance criteria**
- `bun test src/db/registry-db.test.ts` — existing tests pass after schema migration (they may need updating to pass `kind: "screen"` explicitly).
- New tests:
  - **migration: fresh DB**: `initRegistryDb` on a `:memory:` DB sets `user_version = 1`.
  - **migration: v0 → v1**: pre-seed a DB with the OLD Phase 3 schema (`CREATE TABLE registry(name TEXT PRIMARY KEY, code_path TEXT, status TEXT)`) and a row `('Cart', 'src/x/Cart.tsx', 'code-only')`. Call `initRegistryDb`. Assert: `user_version === 1`, the row survives with `kind = 'screen'` and `ds_path IS NULL`.
  - **idempotency**: calling `initRegistryDb` twice in a row on a v1 DB is a no-op (row counts unchanged, no exceptions).
  - **PK is now (kind, name)**: insert `{kind: "screen", name: "Cart", ...}` and `{kind: "component", name: "Cart", ...}` — both succeed.
  - **CHECK constraint**: inserting `kind="invalid"` throws.
  - **searchRegistry filters**: `{ status: "design-only" }` returns only design-only rows; `{ kind: "component" }` returns only components; combined filters AND.
  - **searchRegistry no query**: omitting `query` returns all rows (subject to other filters).

**Commit**: `feat(db): migrate registry schema to v1 with kind and ds_path`

---

### P4-A2 — CVA helpers (variant naming + defaults + emission)
**Depends on:** Phase 2 `src/sync/component-shape.ts` (`ComponentJson` type)
**Complexity:** M

**What to build**

`src/codegen/react/cva-helpers.ts`:

```ts
/** "Primary" → "primary", "On Hover" → "on-hover", "PieChart 3D" → "pie-chart-3d". */
export function slugifyVariantValue(input: string): string;

/** Map Figma variant axis name to a clean CVA prop key. "Variant" → "variant", "Size" → "size". */
export function variantPropKey(figmaPropertyName: string): string;

/** Derive default values per axis from Figma's defaultVariantId.
 *  Returns a Record<variantKey, slugifiedValue>.
 *  If defaultKey is missing or doesn't parse, returns {} (no defaults). */
export function deriveVariantDefaults(json: ComponentJson): Record<string, string>;

/** Render the cva(...) call body as a string. Example output for a Button:
 *
 *  cva("inline-flex items-center justify-center rounded-md font-medium", {
 *    variants: {
 *      variant: {
 *        primary: "bg-primary text-primary-foreground",
 *        secondary: "bg-secondary text-secondary-foreground",
 *        destructive: "bg-destructive text-destructive-foreground",
 *        ghost: "bg-transparent",
 *      },
 *      size: { sm: "h-8 px-3 text-sm", md: "h-9 px-4 text-sm", lg: "h-10 px-6 text-base" },
 *    },
 *    defaultVariants: { variant: "primary", size: "md" },
 *  })
 *
 *  The actual Tailwind utility strings are PLACEHOLDERS — we emit "" (empty string) for each
 *  variant value, and Claude fills them in during generation. Kotikit's job is the shape;
 *  Claude's job is the styling. */
export function emitCvaVariantsBlock(json: ComponentJson): string;

/** Build the TypeScript Props interface declaration:
 *  "interface ButtonProps extends VariantProps<typeof buttonVariants>, React.ButtonHTMLAttributes<HTMLButtonElement> {
 *     children?: React.ReactNode;
 *   }" */
export function emitPropsInterface(json: ComponentJson, intrinsicElement: string): string;
```

Notes:
- Figma's `componentSet.defaultVariantId` references a child component's key — to derive defaults per axis, look up the child component's variant value combinations. For Phase 4 MVP, do a simpler thing: if `json.defaultKey` is present and the variant grouping has more than one variant property, fall back to the FIRST value in each variant array as the default. Document this fallback in a comment.
- Slugification handles spaces, plus signs, ampersands, and casing. Use the existing `slugifyComponentName` from `src/util/ids.ts` as the basis if appropriate (it kebab-cases CamelCase already).
- BOOLEAN / TEXT / INSTANCE_SWAP properties are NOT part of CVA — they're regular React props. Emit them separately from the CVA block. The Props interface enumerates both.
- The intrinsic element heuristic for Phase 4: if name contains "Button" → `HTMLButtonElement`; "Input" → `HTMLInputElement`; "Select" → `HTMLSelectElement`; "Textarea" → `HTMLTextAreaElement`; otherwise `HTMLDivElement`. Document the heuristic; users can override by editing the generated file.

**Acceptance criteria**
- `bun test src/codegen/react/cva-helpers.test.ts`:
  - `slugifyVariantValue("Primary") === "primary"`, `slugifyVariantValue("On Hover") === "on-hover"`, `slugifyVariantValue("PieChart 3D") === "pie-chart-3d"`.
  - `variantPropKey("Variant") === "variant"`, `variantPropKey("Size") === "size"`.
  - `deriveVariantDefaults` for a Button with two axes returns the first value as the default (`{variant: "primary", size: "sm"}` if the first values are Primary and sm), since Phase 4 MVP doesn't fully resolve `defaultVariantId` to per-axis values.
  - `emitCvaVariantsBlock` for a fixture Button produces a syntactically valid `cva(...)` call string containing the expected variant axes, all values slugified, defaults populated.
  - `emitPropsInterface` for a button emits `interface ButtonProps extends VariantProps<typeof buttonVariants>, React.ButtonHTMLAttributes<HTMLButtonElement>` with INSTANCE_SWAP properties expressed as `slot?: React.ReactNode`.

**Commit**: `feat(codegen): add CVA helpers for variant naming and emission`

---

### P4-A3 — Storybook environment detector
**Depends on:** none
**Complexity:** S

**What to build**

`src/codegen/react/storybook-detect.ts`:

```ts
/**
 * Returns true if Storybook appears to be installed/configured in the user's project.
 * Detection: existsSync(<root>/.storybook) OR `storybook` appears in
 *            <root>/package.json devDependencies/dependencies.
 *
 * Reads package.json lazily; on parse error returns false (don't throw).
 */
export async function hasStorybook(root: string): Promise<boolean>;
```

**Acceptance criteria**
- `bun test src/codegen/react/storybook-detect.test.ts`:
  - Empty project root → false.
  - Project root with `.storybook/main.ts` → true.
  - Project root with `package.json` listing `"storybook"` in devDependencies → true.
  - Project root with malformed `package.json` → false (no throw).
  - Project root with no `.storybook/` and no Storybook in package.json → false.

**Commit**: `feat(codegen): add storybook environment detector`

---

### P4-A4 — UI scaffold path helpers
**Depends on:** Phase 3 `src/util/paths.ts`
**Complexity:** S

**What to build**

Extend `src/util/paths.ts`:

```ts
/** The directory where scaffolded DS components land: <codeComponentsDir>/ui/. */
export const uiDir = (root: string, codeComponentsDir: string): string =>
  `${root}/${codeComponentsDir}/ui`;

/** Full path to a scaffolded component file: <codeComponentsDir>/ui/<kebab-name>.tsx. */
export const uiComponentFile = (root: string, codeComponentsDir: string, kebabName: string): string =>
  `${root}/${codeComponentsDir}/ui/${kebabName}.tsx`;

/** Full path to a colocated Storybook story: <codeComponentsDir>/ui/<kebab-name>.stories.tsx. */
export const uiStoryFile = (root: string, codeComponentsDir: string, kebabName: string): string =>
  `${root}/${codeComponentsDir}/ui/${kebabName}.stories.tsx`;
```

**Acceptance criteria**
- `bun test src/util/paths.test.ts` — new tests confirm each helper returns the expected path given root, codeComponentsDir, and kebab name.

**Commit**: `feat(util): add UI scaffold path helpers`

---

## TIER 1 — Engines

### P4-B1 — React scaffolder: component + story emission
**Depends on:** P4-A2, P4-A3, P4-A4, Phase 2 `ComponentJson`
**Complexity:** L

**What to build**

`src/codegen/react/scaffold.ts`:

```ts
import type { ComponentJson } from "../../sync/component-shape.js";

export interface ScaffoldComponentArgs {
  json: ComponentJson;
  hasStorybook: boolean;
}

export interface ScaffoldedFile {
  /** Relative path under the user's project root. */
  path: string;
  content: string;
}

export interface ScaffoldResult {
  componentName: string;          // PascalCase, derived from json.name
  kebabName: string;              // for path construction
  files: ScaffoldedFile[];        // 1 file when no Storybook, 2 when present
  notes: string[];                // e.g. ["Storybook not detected — skipped story file."]
}

/**
 * Build the .tsx contents for a DS component using the CVA pattern.
 * Output structure:
 *   - "use client" directive (omit for Phase 4 — pure components don't need it)
 *   - imports: React, cva, VariantProps, cn (assumed at @/lib/utils)
 *   - const <name>Variants = cva(...)
 *   - interface <Name>Props extends VariantProps + intrinsic-element-attrs
 *   - export function <Name>({...}: Props) { return <El className={cn(...)} {...rest}>{children}</El>; }
 *   - export default <Name>
 *
 * The Tailwind utility strings in cva are PLACEHOLDERS (empty strings) — Claude fills them
 * in during the implement-pass conversation. This file emits the SHAPE; styling is Claude's job.
 */
export function buildComponentTsx(json: ComponentJson, codeComponentsDir: string): string;

/**
 * Build the .stories.tsx contents for the component using CSF3.
 * Emits:
 *   - import { Meta, StoryObj } from "@storybook/react"
 *   - import { <Name> } from "./<kebab>"
 *   - const meta: Meta<typeof <Name>> = { title: "UI/<Name>", component: <Name>, tags: ["autodocs"] }
 *   - export default meta
 *   - export const Default: StoryObj<typeof <Name>> = { args: { ...defaults } }
 *   - one story per variant axis (e.g. Variants, Sizes) rendering all values via a render fn
 *
 * For BOOLEAN/TEXT/INSTANCE_SWAP properties: include in Default args; show one "States" story
 * if any are present.
 */
export function buildStoryTsx(json: ComponentJson): string;

/**
 * Top-level orchestrator: produces the ScaffoldResult for one DS component.
 * Honors hasStorybook (skips the story file if absent + emits a note).
 */
export function scaffoldComponent(args: ScaffoldComponentArgs, codeComponentsDir: string): ScaffoldResult;
```

Implementation notes:
- Use `pascalCase` from `src/util/ids.ts` for the component name (Button → `Button`, `Pie Chart 3D` → `PieChart3D`).
- The `kebab` form for paths and imports is the lowercased-hyphenated version (`Button` → `button`, `PieChart` → `pie-chart`). The Phase 3 React adapter's `importStatement` already does this; extract into a shared `kebabCase(name: string): string` helper inside `cva-helpers.ts` if useful.
- The component file's "intrinsic element" mapping (Button → button, Input → input, etc.) comes from the heuristic in P4-A2.
- The CVA block emits empty-string variant values — Claude's responsibility is to fill in the Tailwind classes when this file goes through `implement_code_start`-style refinement. Phase 4 itself does NOT call back into Claude for the styling — the scaffolded file is "shape only" until the implement track refines it.
- The story file uses CSF3 syntax (no `Story` from `@storybook/react`, uses `StoryObj<typeof X>`).
- For BOOLEAN axis: include in stories as a state-grid (a row showing `disabled: true` vs `disabled: false`).
- For INSTANCE_SWAP props: include in the Default story's `args` as `<div>Slot content</div>` placeholder.

**Acceptance criteria**
- `bun test src/codegen/react/scaffold.test.ts`:
  - **Button with 2 variant axes + 1 BOOLEAN + Storybook present** → returns 2 files (`ui/button.tsx`, `ui/button.stories.tsx`), `notes: []`.
  - **No Storybook** → returns 1 file (the `.tsx`), `notes` contains the Storybook-skipped warning.
  - **Component file contents include** `cva(`, the variant axis keys, the empty-string Tailwind placeholders, `export default Button`.
  - **Story file contents include** `import type { Meta, StoryObj } from "@storybook/react"`, `title: "UI/Button"`, one story per variant axis.
  - **Slugification of variant values**: a variant called `"On Hover"` lands as `"on-hover"` in cva keys.
  - **No defaults case**: a component with no `defaultKey` produces `defaultVariants: { ... first value per axis ... }` (the Phase 4 fallback).
  - **PascalCase + kebab consistency**: a json named `"PieChart 3D"` produces `componentName: "PieChart3D"`, `kebabName: "pie-chart-3d"`, paths to `ui/pie-chart-3d.tsx`.

**Commit**: `feat(codegen): add DS component scaffolder with CVA shape and CSF3 stories`

---

### P4-B2 — Sync engine writes DS rows into registry
**Depends on:** P4-A1, Phase 2 `src/sync/multi-file.ts`
**Complexity:** M

**What to build**

Edit `src/sync/multi-file.ts`. After per-file SyncOneFileResult collection but inside the existing transaction-equivalent flow, for each non-icon component JSON written, also call:

```ts
upsertRegistryDsRow(registryDb, { name: json.name, dsPath: json.path });
```

Where `registryDb` is opened from `registryDbPath(opts.root)` via `openDb`, initialized via `initRegistryDb`, and closed at the end of the sync. The DAO's merge semantics (P4-A1) handle the never-clobber rule.

The registry DB is opened once at the start of the multi-file sync, used for the lifetime of the sync, and closed at the end. Failures during sync should NOT leave the registry DB in a broken state — wrap the upserts in a sub-transaction inside the existing per-file flow.

Update the sync report (`SyncReport` in `src/sync/multi-file.ts`) to include a new field:

```ts
registryUpdates: { added: number; updated: number };
```

`added` counts inserts; `updated` counts merges. Surface via `searchReport.json` so the designer can verify.

**Acceptance criteria**
- `bun test src/sync/multi-file.test.ts` — existing tests still pass. New tests:
  - **fresh sync populates registry**: sync a fixture with 3 components → registry has 3 `(component, design-only)` rows with `dsPath` set.
  - **re-sync preserves `synced` rows**: pre-seed registry with `{kind: "component", name: "Button", code_path: "src/components/ui/button.tsx", ds_path: "components/button.json", status: "synced"}`. Run sync. Assert the row stays `synced` and `code_path` is unchanged; only `ds_path` may be refreshed.
  - **re-sync downgrades nothing**: pre-seed a `code-only` row for a screen with the same name as a DS component (shouldn't happen in practice because of `kind` separation, but defensive). Run sync. Assert the screen row is untouched (different kind), and a new `component` row is inserted.
  - **report updates**: `registryUpdates.added` and `.updated` are correct after the run.

**Commit**: `feat(sync): write design-only registry rows during multi-file sync`

---

### P4-B3 — Registry DAO extensions for scaffold flows
**Depends on:** P4-A1
**Complexity:** S

**What to build**

In `src/db/registry-db.ts` (already extended in P4-A1), add the specialized merge function from §0:

```ts
/**
 * Upsert a DS component row.
 * - No existing row → insert {kind: "component", name, ds_path, code_path: NULL, status: "design-only"}.
 * - Existing "design-only" → update ds_path, keep status.
 * - Existing "synced" → update ds_path ONLY, never touch code_path, never downgrade status.
 * - Existing "code-only" → update ds_path; if code_path is non-null, promote to "synced".
 */
export function upsertRegistryDsRow(db: Database, input: { name: string; dsPath: string }): void;
```

This is the function `multi-file.ts` calls during sync.

Also add a convenience query used by `scaffold_start`:

```ts
/** List all rows with status='design-only' and kind='component', optionally filtered by names. */
export function listDesignOnlyComponents(db: Database, names?: string[]): RegistryRow[];
```

If `names` is provided, return only rows whose `name` is in the list (with `kind='component' AND status='design-only'`). If omitted, return all such rows. Limit 1000 (Phase 4 doesn't justify pagination; if your DS has 1000+ components, the scaffold UX is fundamentally different).

**Acceptance criteria**
- `bun test src/db/registry-db.test.ts` — new tests for:
  - **`upsertRegistryDsRow` insert path**: fresh DB, call it, assert row exists with `status='design-only'` and `kind='component'`.
  - **`upsertRegistryDsRow` design-only merge**: existing design-only row, call with new dsPath, assert `dsPath` updated and status unchanged.
  - **`upsertRegistryDsRow` synced never downgrades**: pre-insert `{kind: "component", name: "Button", code_path: "x", ds_path: "old", status: "synced"}`, call with new dsPath, assert `code_path` unchanged, `status` still `synced`, `ds_path` updated.
  - **`upsertRegistryDsRow` code-only promotion**: pre-insert `{kind: "component", name: "Button", code_path: "x", ds_path: NULL, status: "code-only"}`, call with dsPath, assert `status` promoted to `synced`.
  - **`listDesignOnlyComponents`** with names filter returns the intersection.
  - **`listDesignOnlyComponents`** without filter returns all design-only components, excluding screens.

**Commit**: `feat(db): add merge-aware DS row upsert and design-only query`

---

## TIER 2 — MCP tools

### P4-C1 — Extend `kotikit_registry_search` with filters
**Depends on:** P4-A1 (DAO change), P4-B3
**Complexity:** S

**What to build**

Edit `src/mcp/tools/registry.ts`. Update the tool input schema and handler:

Input:
```ts
{ query?: string; status?: "code-only" | "design-only" | "synced"; kind?: "screen" | "component"; limit?: number }
```

Logic:
1. If registry.db doesn't exist → `toolText("Registry is empty.", { results: [] })`.
2. Open DB readonly.
3. Call `searchRegistry(db, { query, status, kind, limit })`.
4. Close DB.
5. Build a friendly summary describing the filters applied:
   - No filters: "Found <n> registry entries."
   - With status: "Found <n> <status> registry entries."
   - With kind: "Found <n> <kind> registry entries."
   - Combined: "Found <n> <status> <kind> registry entries."
6. Return `toolText(summary, { results })`.

Update the tool's JSON schema so `query` is no longer required, and document the new filter fields.

**Acceptance criteria**
- `bun test src/mcp/tools/registry.test.ts` — existing tests pass. New tests:
  - **`{status: "design-only"}` returns only design-only rows.**
  - **`{kind: "component"}` returns only components.**
  - **`{query: "But"}` still works (prefix match).**
  - **All-empty input `{}` returns all rows.**

**Commit**: `feat(mcp): extend registry_search with status and kind filters`

---

### P4-C2 — `kotikit_scaffold_start` MCP tool
**Depends on:** P4-A4, P4-B1, P4-B3
**Complexity:** M

**What to build**

`src/mcp/tools/scaffold.ts` exports `registerScaffoldTools(registry, ctx, opts?)`. This file hosts BOTH `_start` and `_save` (mirrors `implement-code.ts`).

### `kotikit_scaffold_start`

Input:
```ts
{ names?: string[] }   // If omitted, scaffold all design-only components.
```

Logic:
1. Load config; error if missing.
2. Open registry.db; if missing → friendly error ("No registry yet. Run sync_ds first to populate it.").
3. Call `listDesignOnlyComponents(db, names)`. If empty → `toolError("There are no design-only components to scaffold.", "Run sync_ds first, or check that the names match what's in your registry.")`.
4. Read each component's JSON from `design-system/<dsPath>`. Parse via `ComponentJsonSchema`. Silently skip rows whose JSON is missing (record a `skipped: { name, reason }` entry).
5. Verify gate environment via `verifyGateEnvironment` (same as Phase 3 implement_code_start). If missing → friendly error.
6. Detect Storybook (`hasStorybook(ctx.root)`).
7. For each component, call `scaffoldComponent({ json, hasStorybook }, config.project.codeComponentsDir)` to get the file SHAPES (Claude refines them).
8. Build the `systemPrompt` for the batch (reuse the React adapter's `REACT_SYSTEM_PROMPT` plus a "for THESE components" section listing each component's CVA shape + variant axes + intrinsic element).
9. Compute target paths via `uiComponentFile` / `uiStoryFile`.
10. Return `toolText("Ready to scaffold <n> component(s).", { ... })` with this detail shape:
    ```ts
    {
      components: Array<{
        name: string;
        kebabName: string;
        targetPath: string;          // <codeComponentsDir>/ui/<kebab>.tsx (relative)
        storyPath?: string;          // <codeComponentsDir>/ui/<kebab>.stories.tsx (relative)
        dsJson: ComponentJson;
        scaffoldShape: { tsx: string; stories?: string };   // from buildComponentTsx / buildStoryTsx
      }>;
      systemPrompt: string;
      hasStorybook: boolean;
      skipped: { name: string; reason: string }[];
      testFramework: "vitest" | "none";
    }
    ```

The `scaffoldShape` payload contains the structural skeleton (cva calls, prop interfaces, exports). Claude's job in the conversation is to fill in the Tailwind utility classes for each variant value and any other content (text labels, ARIA attributes). Claude then submits the completed files via `kotikit_scaffold_save`.

### Tool definition

```ts
registry.tools.push({
  name: "kotikit_scaffold_start",
  description: "Gather scaffolding context for one or more DS components — returns component skeletons Claude refines into production code.",
  inputSchema: {
    type: "object",
    properties: {
      names: { type: "array", items: { type: "string" }, description: "Component names to scaffold. Omit to scaffold all design-only components." },
    },
  },
});
```

**Acceptance criteria**
- `bun test src/mcp/tools/scaffold-start.test.ts` (or in a single `scaffold.test.ts`):
  - **happy path** with two components in the registry → tool returns the 2-component detail bundle, `systemPrompt` mentions both, paths are correct.
  - **missing JSONs**: a row whose JSON file doesn't exist → skipped entry, no error.
  - **no names + no design-only rows** → friendly error.
  - **missing gates** → friendly error.
  - **Storybook absent** → `hasStorybook: false`, scaffoldShape entries have no `stories` property.
  - **Storybook present** → `hasStorybook: true`, scaffoldShape entries have `stories`.

**Commit**: `feat(mcp): add scaffold_start tool with batch context bundle`

---

### P4-C3 — `kotikit_scaffold_save` MCP tool
**Depends on:** P4-C2, P4-A1, P4-A4, Phase 3 gate runner + autoCommit
**Complexity:** L

**What to build**

(Same file as C2: `src/mcp/tools/scaffold.ts`.)

### `kotikit_scaffold_save`

Input:
```ts
{ files: { path: string; content: string }[] }
```

Logic:
1. Validate every `path` is inside `<codeComponentsDir>/ui/` (use `uiDir(...)` as the anchor; reject path traversal).
2. Load config + open registry.
3. Determine `kind` per file: `"create"` if the file didn't exist before, `"update"` if it did. The overall commit `kind` is `"create"` if ANY component file was freshly created, else `"update"`.
4. Write all files (creating parent dirs).
5. Build an AdapterContext fixture (use the `reactAdapter`'s `qualityGates` definition — but the spec/dsComponents fields aren't quite right for a batch scaffold). Approach: use the FIRST component's JSON as the AdapterContext spec proxy. The gates don't actually consult the spec content — they're file-driven via `filesArg`. Document this in the code.
6. Run gates ONCE across the entire batch: `runGates({ files: allPaths, only: undefined })` — tsc, eslint, prettier, vitest (if testFramework=vitest AND any test files were written; in Phase 4 default no tests so vitest is skipped).
7. If `!report.passed`: return `toolText(formatGateReport(report) + "\n\nFix the failures and call implement_code_gate to re-validate.", { report })` with `isError: true`. **Files stay on disk.** **No commit. No registry upserts. No spec changes** (scaffold doesn't touch specs anyway).
8. If passed:
   - For each component that had its `.tsx` written (deduplicate by kebab name extracted from path):
     - Compute the registry row: `{kind: "component", name: <PascalCase from filename>, dsPath: <existing or null>, codePath: <relative path>, status: "synced"}`.
     - `upsertRegistry(db, row)`. The merge logic preserves `dsPath` if it was set during sync (the new row's `dsPath` is filled from `getRegistry` lookup, falling back to null only if it was never set).
   - Build the commit subject suffix per §0 ("(Button)", "(Button, Card, Input)", "(12 components)").
   - `autoCommit({ root, scope: "scaffold", kind, files: [...allPaths, registryDbPath(root)], enabled: config.git.autoCommit, subjectScope: "code", subjectSuffix: ` scaffold (...)` })`. Actually — closer look: `autoCommit` builds the subject as `feat(${scopePrefix}): ${kind} ${scope}${suffix}`. So if `scope = "scaffold"` and `suffix = " (Button, Card, Input)"`, the subject becomes `feat(code): create scaffold (Button, Card, Input)` — which is exactly what §0 specifies. Good.
   - Return `toolText("Scaffolded <n> component(s). All gates passed. <commit subject>.", { report, commit, paths })`.

### Tool definition

```ts
registry.tools.push({
  name: "kotikit_scaffold_save",
  description: "Write the refined scaffold files, run gates once on the batch, then commit and mark each component synced.",
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
    },
    required: ["files"],
  },
});
```

The `registerScaffoldTools` function accepts the same `gateRunner` injection opt as `registerImplementCodeTools` for tests.

**Acceptance criteria**
- `bun test src/mcp/tools/scaffold.test.ts`:
  - **happy path, 2 components, gates pass**: 4 files written (2 tsx + 2 stories), registry has 2 `synced` rows, one commit `feat(code): create scaffold (Button, Card)`.
  - **single component**: subject is `feat(code): create scaffold (Button)`.
  - **6+ components**: subject is `feat(code): create scaffold (6 components)` (verify the exact wording).
  - **gates fail**: files written, no commit, no registry change. Re-run with passing stub → completes.
  - **path traversal**: reject + no writes.
  - **autoCommit off**: no commit, but registry still upserted to `synced`.
  - **synced rows preserve dsPath from sync**: pre-seed registry with `{kind:"component", name:"Button", ds_path:"components/button.json", status:"design-only"}`. Scaffold Button. After save, registry has `{name:"Button", ds_path:"components/button.json", code_path:"src/components/ui/button.tsx", status:"synced"}`.

**Commit**: `feat(mcp): add scaffold_save with batch gates and single commit`

---

## TIER 3 — Phase 3 fix

### P4-D1 — `implement_code_save` writes `kind: "screen"`
**Depends on:** P4-A1
**Complexity:** S

**What to build**

Edit `src/mcp/tools/implement-code.ts`. The current `_save` calls `upsertRegistry(db, { name, codePath, status: "code-only" })`. After Phase 4's schema migration the `RegistryRow` type requires `kind` and `dsPath`. Update the call:

```ts
upsertRegistry(db, {
  kind: "screen",
  name: componentName,
  dsPath: null,
  codePath,
  status: "code-only",
});
```

Update the existing Phase 3 tests in `src/mcp/tools/implement-code.test.ts` to expect the `kind` field where they assert registry contents (a couple of test assertions need adjustments).

**Acceptance criteria**
- All Phase 3 `implement-code` tests pass against the migrated schema.
- New assertion in at least one test: after `_save`, `getRegistry(db, "screen", componentName)` returns the row (NOT `getRegistry(db, "component", componentName)`).

**Commit**: `fix(mcp): implement_code_save writes kind=screen rows`

---

## TIER 4 — Wire + E2E

### P4-E1 — Register scaffold tools in `server.ts`
**Depends on:** P4-C2, P4-C3
**Complexity:** S

**What to build**

Edit `src/mcp/server.ts`. Add:
```ts
import { registerScaffoldTools } from "./tools/scaffold.js";
// ...
registerScaffoldTools(registry, ctx);
```

Update `src/mcp/server.test.ts` "registers all" assertion to include `"kotikit_scaffold_start"` and `"kotikit_scaffold_save"`. Tool count goes from 19 → 21.

**Acceptance criteria**
- `bun test src/mcp/server.test.ts` passes with the two new tools.
- `bun x tsc --noEmit` clean.

**Commit**: `feat(mcp): register phase 4 scaffold tools in server`

---

### P4-E2 — End-to-end smoke test
**Depends on:** P4-E1
**Complexity:** L

**What to build**

`test/e2e/phase4.test.ts`. Drive the Phase 4 happy path in-process against a temp project dir.

Pattern (same as phase2 + phase3 E2E):
- Build a registry with the Phase 1-4 tool set + a `gateRunner` stub.
- Create a temp dir + git init + node_modules/.bin stubs (so verifyEnvironment passes).
- For Storybook detection: write a fake `.storybook/main.ts` (or omit it for a separate test).

Scenarios:

1. **Sync populates DS rows, scaffold turns them into code:**
   - Drive `kotikit_config_init` (or directly write config).
   - Stub `kotikit_sync_ds` to populate `design-system/` and `registry.db` with 3 DS components (Button, Card, Input). Use the Phase 2 `FigmaClient` injection pattern (see `test/e2e/phase2.test.ts`).
   - Call `kotikit_registry_search({status: "design-only"})` — confirm 3 rows.
   - Call `kotikit_scaffold_start({ names: ["Button", "Card"] })` — confirm 2-component context bundle.
   - Generate fake-but-valid file contents from the `scaffoldShape.tsx` (just write the empty CVA shape as-is — gates are stubbed).
   - Call `kotikit_scaffold_save({ files: [4 files] })` — assert pass: 4 files on disk at `src/components/ui/{button,card}.{tsx,stories.tsx}`, registry shows Button + Card as `synced`, one commit `feat(code): create scaffold (Button, Card)`.

2. **Scaffold without Storybook present:**
   - Same setup but no `.storybook/`. Scaffold one component.
   - Assert: `hasStorybook: false` in start response, only the `.tsx` file in `_save` payload, registry status = `synced`, no `.stories.tsx` on disk.

3. **Gate failure path:**
   - Scaffold one component, stub gate runner to fail eslint.
   - Assert: file written, no commit, registry row stays `design-only`.

4. **Sync re-run preserves `synced` rows:**
   - After test 1's scaffold-success, re-run sync. Assert the Button registry row still has `status: synced` and `code_path` unchanged.

5. **Phase 3 + Phase 4 coexistence:**
   - Create a screen spec via spec_create (Phase 3 path), implement_code_save it.
   - Confirm registry has the `kind: "screen"` row and the `kind: "component"` rows from sync side by side, both queryable.

**Acceptance criteria**
- `bun test test/e2e/phase4.test.ts` — all 5 scenarios pass.
- `bun test` — full suite still green (~430+ tests).
- `bun x tsc --noEmit` clean.

**Commit**: `test(e2e): add phase 4 scaffolding and registry coexistence test`

---

## 2. Definition of Done for Phase 4

- [ ] `bun install`, `bun x tsc --noEmit`, and `bun test` all pass.
- [ ] `bun run src/mcp/server.ts` exposes 21 tools (Phase 1-3 + `kotikit_scaffold_start`, `kotikit_scaffold_save`).
- [ ] Designer flow: sync DS → run `scaffold_start({names})` → Claude generates files → `scaffold_save({files})` → all files written, gates pass, one commit, every selected component flips `design-only → synced`.
- [ ] Registry schema is migrated to v1 (kind + ds_path); the migration is idempotent and never destroys data.
- [ ] Sync writes `design-only` DS rows during the existing transaction without clobbering `synced` or `code-only` rows.
- [ ] Storybook stories emitted in CSF3, one per variant axis (not cartesian product). Storybook absent → story skipped + note returned, component still marked `synced`.
- [ ] Scaffolded files use the CVA pattern with lowercased-kebab variant values and defaults derived from Figma metadata.
- [ ] Quality gates run ONCE across the batch (not per file).
- [ ] Each task lands as one atomic commit with `feat(<scope>): <summary>` + the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

## 3. Parallelization summary

- **Wave 1 (4 agents):** A1, A2, A3, A4 — fully independent.
- **Wave 2 (3 agents):** B1, B2, B3 — after Wave 1.
- **Wave 3 (3 agents):** C1, C2, C3 — after Wave 2.
- **Wave 4 (1 agent):** D1 — Phase 3 fix.
- **Wave 5 (1 agent):** E1 — wire.
- **Wave 6 (1 agent):** E2 — the proof.

Larger tasks: B1 (scaffolder), C3 (scaffold_save), E2 (E2E). Most others are S/M.

## 4. Atomic commit discipline

- **One task = one commit.** No bundling, no splitting.
- **Conventional commits subject.** `feat(<scope>): <imperative summary>`. Subject under 72 chars.
- **Body explains the why, not the what.** Two or three sentences.
- **Co-author footer mandatory.** Last line:
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- **No `--no-verify`.** No bypassing hooks.
- **Commit only when tests + typecheck pass.** Run `bun test <files-touched>` and `bun x tsc --noEmit` first.
- **No amending.** A correction is a new commit (`fix(<scope>): …`).
- **Tests pass for the WHOLE suite, not just the new ones.** After each commit, the full `bun test` must stay green.

## 5. Out of scope (for Phase 4)

These are explicitly **NOT** in Phase 4:

- Drift audit (`kotikit_audit`, mismatch report) — Phase 6.
- Figma plugin / design track — Phase 5.
- Code → Figma reverse generation — V2+.
- Auto-installing Storybook in the user's project.
- Test generation for DS components (vitest only runs on existing test files in the batch).
- Per-component scaffolding tests beyond stories (no Vitest for DS components in Phase 4).
- Multi-framework adapters (Vue, Svelte) — Phase 6.
- Storybook variant cartesian product — only one story per axis.
- Tailwind class generation — kotikit emits the CVA SHAPE, Claude fills in the Tailwind utility strings.
- Pagination for the design-only list (`listDesignOnlyComponents` returns up to 1000).
- Status transitions besides `design-only → synced` and `code-only → synced` (no manual "unsync").
