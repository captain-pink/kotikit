# Kotikit — Phase 6 Implementation Plan

> **Phase 6 deliverable:** Three things shipped together:
> 1. A **drift audit** (`kotikit_audit`) that walks the registry and surfaces design ↔ code mismatches with a minimal, decisive report.
> 2. **Token consumption optimizations** so a typical conversation stays well clear of the 5-hour budget — a tools-results size cut of ~5×, achieved by extracting duplicated system prompts, paginating scaffold bundles, and lazy-loading DS component JSONs.
> 3. **A complete documentation pass** — a designer-friendly README, per-module docs (one per `src/<dir>`), a tools cheat-sheet, a TOKENS.md describing measured costs + mitigation strategies, and NEXT_STEPS.md for future improvements.
>
> Explicit cuts from the original Phase 6: **no Playwright** (Chrome DevTools MCP is a peer tool Claude invokes directly — kotikit doesn't proxy it), **no second framework adapter** (premature; React adapter hasn't been exercised at scale).

This document is self-contained. A senior engineer or AI agent with **Phase 1-5 context** can read it and build the right thing. Read §0 before picking up any task.

---

## 0. Orientation — what you are building (read this first)

### Architectural decisions that are non-negotiable

These were settled in advance. Do **not** re-litigate them.

1. **Drift audit MVP: registry walk + variant-name diff.** For each `kind="component"` registry row, the audit produces one entry: `design-only` (no `code_path`), `code-only` (no `ds_path`), `synced-ok` (both paths exist, variant names match), or `synced-mismatched` (both paths exist, variant names differ). The diff compares the DS JSON's `variants[].propertyName` against the code file's `cva({...variants: {...}})` keys via a regex over the `.tsx`. No prop-type comparison, no runtime browser check.

2. **Chrome DevTools MCP is NOT a kotikit tool.** It's a peer MCP server that Claude composes alongside kotikit. Phase 6 documents this composition in the README ("after committing, ask Claude to open the URL with Chrome DevTools to validate") but ships no kotikit-side wrapper. Same reasoning would have applied to Playwright; user has correctly identified the simpler path.

3. **MCP-protocol-level prompt caching is not achievable today.** Sonnet 4.6's MCP stack doesn't surface `cache_control` markers on tool results. Phase 6 optimizes instead by (a) **shrinking tool result payloads**, (b) **deduplicating static content across calls** via a new `kotikit_get_system_prompt` tool, and (c) **lazy-loading large DS JSON dictionaries** via `componentRefs` + opt-in `expand`. Caching is the client's problem; kotikit makes it easy by emitting stable prefixes.

4. **Top three token hotspots, top three fixes:**
   - **Hotspot A**: `kotikit_scaffold_start` returning N×(DS JSON + scaffold shape) for N components — easily 30-50 KB at N=20. **Fix:** pagination (`pageSize` default 3, `nextCursor`) + `compact: true` default that strips DS JSON to `{name, variants[], slots[]}`.
   - **Hotspot B**: `REACT_SYSTEM_PROMPT` (~1.5KB) duplicated in `implement_code_start` and `scaffold_start`; `BRAINSTORM_SYSTEM_PROMPT` (~800B) returned every brainstorm. **Fix:** new tool `kotikit_get_system_prompt({ kind })` returns the long doctrine; the other tools return `{ systemPromptRef: "react", ... }` instead of the inline string. Claude fetches the prompt once per session, reuses it in conversation history.
   - **Hotspot C**: `implement_code_start` and `design_get_screen` returning full DS JSON for every referenced component. **Fix:** default response carries `componentRefs: [{name, path, key}]`; opt-in `expand: true` returns the current behavior. Claude calls `kotikit_ds_get_component({path})` per ref on demand, which is already in the tool surface.

5. **Token measurement: hand-rolled, one-shot.** A new dev script `scripts/measure-tokens.ts` runs every tool against a fixture project, JSON-stringifies the response, prints `bytes / ~tokens` (bytes ÷ 3.8). The output is pasted into `docs/TOKENS.md`. **No runtime instrumentation** — measuring tokens at runtime costs tokens.

6. **Documentation lives in `docs/` with three audiences:**
   - `README.md` — for a UX/UI designer who has never seen kotikit. Linear "first hour" walkthrough. No phase numbers, no schema dumps, no jargon.
   - `docs/modules/<name>.md` — one file per top-level `src/<dir>` (config, spec, sync, codegen, planning, db, mcp, util, git) — for an engineer or future Claude conversation that needs to understand a subsystem.
   - `docs/tools.md` — the single scrollable cheat-sheet of every MCP tool (name, purpose, input/output, token estimate).
   - `docs/TOKENS.md` — measured costs + mitigation strategies + the unavoidable caveats about MCP caching.
   - `NEXT_STEPS.md` (repo root) — concrete follow-up work for V2+.

7. **All token optimizations are additive and backwards-compatible.** Existing callers (Phase 1-5 E2E tests, the Figma plugin) continue to work without changes. The optimizations are opt-in via input flags (`expand`, `pageSize`, `cursor`) that default to the new lean behavior. The single REQUIRED behavior change: `systemPrompt` field in `implement_code_start` / `scaffold_start` / `brainstorm_start` may shrink to a stub mentioning the new tool — tests that asserted on its content need updating.

8. **Phase 6 ships one new MCP tool** (`kotikit_audit`) **plus one infrastructure tool** (`kotikit_get_system_prompt`). Total tool count: 24 → 26.

### Folder layout produced by Phase 6

```
.kotikit/
  audit-report.json              # NEW — written by kotikit_audit

scripts/
  measure-tokens.ts              # NEW — dev-only token measurement

docs/
  modules/
    config.md                    # NEW (×9)
    spec.md
    sync.md
    codegen.md
    planning.md
    db.md
    mcp.md
    util.md
    git.md
  tools.md                       # NEW — MCP tool cheat-sheet
  TOKENS.md                      # NEW — costs + strategies

README.md                        # REWRITTEN — designer-friendly
NEXT_STEPS.md                    # NEW — V2+ wishlist
```

### Shared types (canonical)

The audit report schema (`src/audit/schema.ts`):

```ts
import { z } from "zod";

export const AuditOutcomeSchema = z.enum([
  "synced-ok",            // both paths present, variants match
  "synced-mismatched",    // both paths present, variants differ
  "design-only",          // ds_path set, code_path null
  "code-only",            // code_path set, ds_path null
]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditEntrySchema = z.object({
  name: z.string(),
  outcome: AuditOutcomeSchema,
  dsPath: z.string().nullable(),
  codePath: z.string().nullable(),
  // For synced-mismatched only: the variant axis names that differ
  variantDelta: z.object({
    dsOnly: z.array(z.string()),     // axes present in DS but not in code
    codeOnly: z.array(z.string()),   // axes present in code but not in DS
  }).optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditReportSchema = z.object({
  version: z.literal(1),
  ranAt: z.string(),
  summary: z.object({
    syncedOk: z.number().int().nonnegative(),
    syncedMismatched: z.number().int().nonnegative(),
    designOnly: z.number().int().nonnegative(),
    codeOnly: z.number().int().nonnegative(),
  }),
  entries: z.array(AuditEntrySchema),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;
```

The new `kotikit_get_system_prompt` tool input:

```ts
type SystemPromptKind = "react" | "brainstorm" | "scaffold";
// Input: { kind: SystemPromptKind }
// Output: { prompt: string, kind: SystemPromptKind, version: "1" }
```

---

## 1. Dependency tiers (the build order)

| Tier | Tasks | Theme |
|---|---|---|
| **Tier 0** | P6-A1 | Drift audit engine + AuditReport schema |
| **Tier 1** | P6-B1, P6-B2 | `kotikit_audit` tool + new `kotikit_get_system_prompt` tool |
| **Tier 2** | P6-C1, P6-C2, P6-C3 | Token optimizations: scaffold pagination, implement_code_start lazy expand, brainstorm prompt extraction |
| **Tier 3** | P6-D1 | `scripts/measure-tokens.ts` measurement script |
| **Tier 4** | P6-E1, P6-E2, P6-E3 | Documentation: README, module docs, tools cheat-sheet |
| **Tier 5** | P6-E4, P6-E5 | TOKENS.md (uses D1 numbers) + NEXT_STEPS.md |
| **Tier 6** | P6-F1, P6-F2 | Wire into server + E2E audit test |
| **Final** | Opus review | One round of cross-review, fix anything that comes back |

Each task ends with **one atomic git commit** in conventional-commits format (`feat(<scope>): <summary>` / `docs(<scope>): <summary>`), with the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

---

## TIER 0 — Drift audit engine

### P6-A1 — Audit engine + schema
**Depends on:** Phase 4 registry DAO (`src/db/registry-db.ts`)
**Complexity:** M

**What to build**

`src/audit/schema.ts` — the schemas from §0.

`src/audit/engine.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { AuditEntry, AuditReport } from "./schema.js";
import { searchRegistry } from "../db/registry-db.js";

export interface RunAuditOpts {
  root: string;
  registryDb: Database;
}

/**
 * Walk the component-kind registry rows and classify each one.
 * For synced rows, compare DS JSON variants vs code variants via regex.
 * Pure function — caller writes the report to disk.
 */
export async function runAudit(opts: RunAuditOpts): Promise<AuditReport>;
```

Algorithm:
1. `rows = searchRegistry(db, { kind: "component", limit: 1000 })`.
2. For each row, classify:
   - `dsPath === null && codePath !== null` → `code-only`.
   - `dsPath !== null && codePath === null` → `design-only`.
   - Both present → compare variants:
     - Read DS JSON: `${root}/design-system/${dsPath}`. Parse via `ComponentJsonSchema`. Collect `variants.map(v => v.propertyName)` lowercased.
     - Read code file: `${root}/${codePath}`. Find `cva({...variants: { <key>: ... }})` keys via regex (`/variants:\s*\{([^}]+)\}/s` then `\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g`). Lowercase them.
     - If sets are equal → `synced-ok`.
     - Else → `synced-mismatched` with `variantDelta: { dsOnly: [...], codeOnly: [...] }`.
   - Missing files (DS JSON or code file) on a `synced` row → fall through to `synced-mismatched` with a note. (Actually: classify by what we found — if code file missing, mark as `design-only` because the code path is stale; if DS JSON missing, mark as `code-only`. Update the registry row to reflect the actual status.)
3. Build summary counts.
4. Return AuditReport with `ranAt: nowIso()`, `version: 1`.

**Acceptance criteria**

`bun test src/audit/engine.test.ts`:
- A registry with one synced row whose variants match → `synced-ok`.
- A registry row whose DS has `[Variant, Size]` and code has `[Variant]` → `synced-mismatched`, `variantDelta.dsOnly === ["size"]`.
- A `design-only` row stays `design-only`.
- A `code-only` row stays `code-only`.
- Missing DS JSON on a synced row → reclassified.
- Missing code file on a synced row → reclassified.
- Summary counts are correct across a mixed fixture.

**Commit**: `feat(audit): add drift audit engine with variant-name diff`

---

## TIER 1 — MCP tools

### P6-B1 — `kotikit_audit` MCP tool
**Depends on:** P6-A1
**Complexity:** S

**What to build**

`src/mcp/tools/audit.ts`:

### `kotikit_audit`
Input: `{}` (no arguments — uses ctx.root).

Logic:
1. Check `registryDbPath(ctx.root)` exists. If not, friendly error: `"No registry yet — run sync_ds first."`.
2. Open registry readonly.
3. `report = await runAudit({ root: ctx.root, registryDb: db })`.
4. Write report to `${root}/.kotikit/audit-report.json` (pretty JSON + newline).
5. Build a friendly summary: `"Audit complete: <N> entries (<n1> synced-ok, <n2> mismatched, <n3> design-only, <n4> code-only)."`.
6. Return `toolText(summary, { report })`.

**Acceptance criteria**

`bun test src/mcp/tools/audit.test.ts`:
- Empty registry → friendly error.
- Registry with 4 rows of different outcomes → report written, summary correct.
- Report validates against `AuditReportSchema`.

**Commit**: `feat(mcp): add audit tool walking registry for drift`

---

### P6-B2 — `kotikit_get_system_prompt` MCP tool
**Depends on:** existing `REACT_SYSTEM_PROMPT` and `BRAINSTORM_SYSTEM_PROMPT` constants
**Complexity:** S

**What to build**

`src/mcp/tools/system-prompt.ts`:

### `kotikit_get_system_prompt`
Input: `{ kind: "react" | "brainstorm" | "scaffold" }`.

Logic:
1. Import `REACT_SYSTEM_PROMPT` from `src/codegen/react/system-prompt.ts`.
2. Import `BRAINSTORM_SYSTEM_PROMPT` from `src/mcp/tools/brainstorm.ts`.
3. For `scaffold`, return REACT_SYSTEM_PROMPT (Phase 4 scaffold uses the React prompt — same shape).
4. Return `toolText("System prompt for <kind> (v1).", { prompt: <text>, kind, version: "1" })`.

**Acceptance criteria**

`bun test src/mcp/tools/system-prompt.test.ts`:
- Each of the 3 kinds returns the corresponding prompt string.
- Unknown kind → friendly error.
- Prompt content includes the literal quality bar sentence.

**Commit**: `feat(mcp): add get_system_prompt tool extracting shared doctrine`

---

## TIER 2 — Token optimizations (additive)

### P6-C1 — Scaffold pagination + compact mode
**Depends on:** P6-B2 (so we can return systemPromptRef)
**Complexity:** M

**What to build**

Edit `src/mcp/tools/scaffold.ts`. Input for `kotikit_scaffold_start` gains:
- `pageSize?: number` (default 3, max 10).
- `cursor?: string` (the name of the last component returned in the prior page, so we can offset from it).
- `compact?: boolean` (default `true`).
- `expand?: boolean` (default `false`).

Response shape:
```ts
{
  components: [...], // pageSize items
  nextCursor?: string,
  hasMore: boolean,
  totalRemaining: number,
  systemPromptRef: "react",     // NEW — no inline prompt
  hasStorybook: boolean,
  skipped: [...],
  testFramework: "vitest" | "none",
}
```

When `compact === true`, each `components[i].dsJson` is replaced with a stripped view:
```ts
{
  name: string;
  key: string;
  variants: { propertyName: string; values: string[] }[];   // names + values only
  propertyNames: string[];                                  // names only — no defaults
}
```

When `compact === false`, full `ComponentJson` is returned.

The `systemPrompt` field that previous Phase 4 tests assert on can stay (for backwards compat) but should be SHORT — a one-line stub: `"For the full React adapter prompt, call kotikit_get_system_prompt({ kind: 'scaffold' })."`. This lets tests pass while saving the actual 1.5K.

Sort components by name; cursor is the last name in the prior page.

Add `bun test src/mcp/tools/scaffold.test.ts` cases:
- 10 components, default pageSize → 3 returned + `nextCursor` set + `hasMore: true`.
- 2 components → 2 returned + `nextCursor` undefined + `hasMore: false`.
- `compact: true` (default) — `dsJson` is the stripped shape (no `path`, no `description`, no `updatedAt`).
- `compact: false` — full `ComponentJson` returned.
- `systemPromptRef` present in response.
- Existing Phase 4 happy-path test still passes (the stub `systemPrompt` is fine).

**Commit**: `feat(mcp): paginate scaffold_start and add compact dsJson mode`

---

### P6-C2 — `implement_code_start` lazy DS expansion
**Depends on:** P6-B2
**Complexity:** S

**What to build**

Edit `src/mcp/tools/implement-code.ts`. Add `expand?: boolean` (default `false`) to `kotikit_implement_code_start` input.

When `expand === false` (the new default), the response replaces `dsComponents: Record<string, ComponentJson>` with `componentRefs: Array<{name: string; path: string; key: string}>`. Claude fetches per-component JSON on demand via the existing `kotikit_ds_get_component({path})` tool.

When `expand === true`, returns the current behavior (full `dsComponents` dictionary).

Also replace `systemPrompt: REACT_SYSTEM_PROMPT + screen context` with:
- `systemPromptRef: "react"`.
- `screenContext: string` — JUST the per-screen interpolated section (spec excerpt, breakpoints, themes, flow info), without the big base prompt. This is ~200 bytes vs ~1500.

The full per-screen prompt is reconstructed by Claude as: `[prompt from kotikit_get_system_prompt({ kind: "react" })] + screenContext`.

Update tests:
- Default call → response has `componentRefs`, NOT `dsComponents`.
- `expand: true` → response has `dsComponents`.
- `systemPrompt` shrinks to a stub mentioning `get_system_prompt`.

**Commit**: `feat(mcp): replace dsComponents dump with componentRefs in implement_code_start`

---

### P6-C3 — Brainstorm prompt reference
**Depends on:** P6-B2
**Complexity:** S

**What to build**

Edit `src/mcp/tools/brainstorm.ts`. The `kotikit_brainstorm_start` response currently includes `systemPrompt: BRAINSTORM_SYSTEM_PROMPT`. Replace with `systemPromptRef: "brainstorm"`.

Keep `systemPrompt` field present with a stub: `"For the full brainstorm doctrine, call kotikit_get_system_prompt({ kind: 'brainstorm' })."`. This preserves backwards compat for the test that asserts the field exists.

Test changes: the existing test that asserts the literal quality bar sentence inside `systemPrompt` should EITHER:
- Move that assertion to `kotikit_get_system_prompt({ kind: "brainstorm" })` instead, OR
- Stay on `kotikit_brainstorm_start` but assert on `systemPromptRef === "brainstorm"`.

**Commit**: `feat(mcp): replace brainstorm system prompt with reference`

---

## TIER 3 — Token measurement

### P6-D1 — `scripts/measure-tokens.ts`
**Depends on:** P6-C1, P6-C2, P6-C3 (so it measures the OPTIMIZED tools)
**Complexity:** M

**What to build**

`scripts/measure-tokens.ts`:

```ts
#!/usr/bin/env bun
/**
 * Measure the byte/token cost of each kotikit tool response against a fixture project.
 * Usage: bun run scripts/measure-tokens.ts
 * Prints a table:
 *   tool                            bytes   ~tokens   notes
 *   kotikit_spec_list                 412       108
 *   kotikit_scaffold_start (1 comp)  1843       485
 *   ...
 */
```

Algorithm:
1. Create a temp project with a fixture: 1 spec, 1 flow with 3 screens, 3 DS components synced (Button, Card, Input), 1 design plan written.
2. For each tool name, call the handler with fixture-appropriate inputs.
3. Serialize the response, count bytes.
4. Approximate tokens as `Math.round(bytes / 3.8)`.
5. Print a TSV table to stdout.
6. Repeat key measurements with both default and `expand: true` modes for `implement_code_start` and `scaffold_start` so the doc can show the delta.

Output should be deterministic enough to paste into `docs/TOKENS.md` without manual edits.

Add a `package.json` script: `"measure": "bun run scripts/measure-tokens.ts"`.

**Acceptance criteria**

- `bun run measure` runs cleanly and prints the table.
- No test file needed — this is a dev script.

**Commit**: `feat(scripts): add measure-tokens dev script`

---

## TIER 4 — Documentation

### P6-E1 — README rewrite (designer-friendly)
**Depends on:** existing tool surface
**Complexity:** L

**What to build**

Rewrite `README.md` from scratch. The current README is engineer-flavored (mentions phases, schema dumps). The new one targets a UX/UI designer who has never seen kotikit.

Structure:

```markdown
# kotikit

kotikit turns your Figma design system into real, working React code — through a conversation with Claude.

You describe a screen, Claude asks the right questions, kotikit saves a precise spec.
Then kotikit pulls your design system, generates the screen as React code, and commits everything as you go.

Designed for designers. No git knowledge required.

## Who this is for

Designers who use [Claude Code](https://claude.com/claude-code) in VS Code,
have a Figma design system, and want to ship screens as code without writing it by hand.

## Prerequisites (5 minutes)

1. **Bun** — `curl -fsSL https://bun.sh/install | bash` (one line in Terminal).
2. **Claude Code** — installed in VS Code, signed in.
3. **A Figma personal access token** — Figma → Settings → Account → Personal access tokens.
4. **Your project should be a git repo** — `cd your-project && git init` if not.

## Install (2 minutes)

[step-by-step copy-paste block: clone, install, add to claude.json, restart]

## Your first hour

### 30 seconds — sync your design system

[Claude prompt + expected output]

### 3 minutes — build your first screen

[Claude prompt that walks brainstorm → spec → implement_code → scaffold]

### 1 minute — run the drift audit

[Claude prompt]

## Troubleshooting

[5 verbatim error messages and exact fixes]

## Where to learn more

- `docs/tools.md` — every Claude command kotikit understands.
- `docs/modules/` — how each piece works.
- `docs/TOKENS.md` — keeping conversations cheap.
- `NEXT_STEPS.md` — what's coming.
- `planning/phase-N.md` — the design rationale for each phase (for engineers).

## License

MIT.
```

Keep it under **600 lines** rendered. No phase numbers. No schema dumps. Working copy-paste blocks for every step. Mention Chrome DevTools MCP as a composable peer ("after kotikit commits the code, ask Claude to open it with Chrome DevTools MCP to validate visually").

**Acceptance criteria**

- A designer who has never seen kotikit can install, sync, and ship one screen using ONLY the README.
- All copy-paste blocks are runnable.
- The arc covers: install → first sync → first screen → audit → troubleshooting → links.
- No mention of phases, schemas, or `feat(scope): subject` commit grammar.

**Commit**: `docs(readme): rewrite README for designer-first onboarding`

---

### P6-E2 — Per-module docs (9 files in `docs/modules/`)
**Depends on:** existing codebase
**Complexity:** L

**What to build**

One markdown file per top-level `src/<dir>`:

- `docs/modules/config.md` — config schema, secret resolution (`${ENV}` + `op://`), `kotikit_config_init` walkthrough.
- `docs/modules/spec.md` — spec engine, flow vs single-screen, `ScreenSpec` / `FlowManifest` shapes, mutation rules.
- `docs/modules/sync.md` — Figma client (rate-limit + backoff), multi-file merge, checkpoint resume, DS row writeback to registry.
- `docs/modules/codegen.md` — adapter interface, React adapter, gate runner, scaffolder, CVA emission.
- `docs/modules/planning.md` — code-plan, design-plan, plan stores.
- `docs/modules/db.md` — SQLite + bun:sqlite usage, FTS5 tokens, registry migration.
- `docs/modules/mcp.md` — server build, ToolRegistry pattern, bridge transport.
- `docs/modules/util.md` — path helpers, ids, error helpers.
- `docs/modules/git.md` — auto-commit, conventional-commits subject construction.

Each file follows the same structure (~300-500 words):

```markdown
# <Module name>

## What it does
<one paragraph: the responsibility this module owns>

## Public surface
<list of exports + one-line each: function/type/tool>

## How it works
<2-3 paragraphs: architecture, key decisions, edge cases>

## When to extend it
<scenarios where a designer or engineer would touch this module>

## Related
<links to adjacent modules>
```

Goal: an engineer (or a future Claude conversation) can read one file to understand a subsystem without grepping source code.

**Acceptance criteria**

- 9 files exist, one per `src/<dir>`.
- Each follows the same structural template.
- All public surface items are listed and described.
- No file exceeds ~500 lines (concise).

**Commit**: `docs(modules): add per-module documentation for all src/ directories`

---

### P6-E3 — `docs/tools.md` MCP tool cheat-sheet
**Depends on:** existing tool surface
**Complexity:** M

**What to build**

`docs/tools.md`: ONE scrollable page listing all 26 MCP tools (24 from Phase 1-5 + audit + get_system_prompt). For each tool:

- Name (`kotikit_<tool>`).
- One-sentence purpose.
- Input shape (TypeScript type, not JSON schema).
- Output shape summary.
- Token cost estimate (from the measurement script).
- Example Claude prompt that triggers it.
- "See also" links.

Group by phase for browsing, but make sure each entry is self-contained so it can be Cmd-F'd:

```markdown
# kotikit MCP Tools

26 tools, organized by what they do.

## Setup
### kotikit_config_status
Purpose: Check whether kotikit is initialized in this project.
Input: `{}`
Output: `{ initialized: boolean; isGitRepo: boolean; missing: string[]; gates?: ... }`
Token cost: ~200 tokens.
Example: "Check if kotikit is set up here."
See also: config_init.

### kotikit_config_init
...

## Specs
...

## Design System
...

## Code Generation
...

## Design Track
...

## Audit
### kotikit_audit
Purpose: Walk the registry and report drift between design and code.
...
```

**Acceptance criteria**

- Every registered tool (count == 26 after F1) has an entry.
- Token-cost column matches the measurement script output (or marks "TBD" if not measured).
- Examples are runnable Claude prompts.

**Commit**: `docs(tools): add MCP tool cheat-sheet`

---

## TIER 5 — Strategy docs

### P6-E4 — `docs/TOKENS.md`
**Depends on:** P6-D1 (numbers), P6-C1/C2/C3 (optimizations)
**Complexity:** M

**What to build**

`docs/TOKENS.md` — the operational guide for keeping conversations cheap.

Sections:

1. **Why this matters** — Sonnet 4.6 has a weekly budget; the user reports hitting it in 20 minutes. This doc explains what's expensive and how to stay under.
2. **Measured costs** — table from `bun run measure`. Two columns: default + `expand: true`. Highlight any tool over ~1000 tokens.
3. **The three big mitigations:**
   - `kotikit_get_system_prompt` — fetch once per session, reuse.
   - Scaffold pagination — default `pageSize: 3`, scaffold in batches.
   - `componentRefs` (lazy) — Claude calls `ds_get_component` on demand instead of receiving every JSON eagerly.
4. **What you can do as a user** — practical tips:
   - "Don't call sync_ds in the middle of a brainstorm — start a fresh session for sync work."
   - "Brainstorm one screen per session; close the chat when you're done."
   - "Scaffold incrementally: 3-5 components at a time."
   - "Run the audit at the end of a session, not the start."
5. **Why we can't fully cache via MCP** — half a page explaining that MCP-protocol-level `cache_control` markers aren't surfaced by Sonnet 4.6's stack today, so caching is a client concern. We've structured payloads to be naturally cache-friendly; the client does the rest.
6. **How to re-measure when payloads change** — `bun run measure`.

**Acceptance criteria**

- Table from D1 output pasted in (or referenced).
- Three mitigations explained with copy-paste Claude prompts demonstrating each.
- The "5-hour budget burnt in 20 min" pathology is named and explained.
- Honest about MCP caching limits.

**Commit**: `docs(tokens): add token consumption + optimization strategies`

---

### P6-E5 — `NEXT_STEPS.md`
**Depends on:** everything else (so it can name concrete follow-ups)
**Complexity:** S

**What to build**

`NEXT_STEPS.md` at repo root. The Phase 6 deferral list plus concrete V2 items, grouped:

```markdown
# Next steps

What kotikit could grow into. Each item is bite-sized enough to spawn as its own follow-up phase.

## Token efficiency (highest leverage)
- MCP protocol cache_control markers — when Anthropic ships this, retrofit tool responses.
- Tool-call streaming for large bundles (return components one-by-one over a streaming RPC).
- Session-aware deduplication (kotikit remembers what it sent each Claude session).
- Per-user token budget enforcement (refuse calls that would exceed N tokens per call).

## Code track
- Vue and Svelte adapters behind the same Adapter interface (validate the boundary).
- Custom adapter slot in config.json so projects can ship their own.
- Per-project `quality` profile (WCAG-AAA, performance budgets, custom ESLint rules).

## Design track
- Full plan-checklist UI in the Figma plugin (P5-D4, deferred).
- Multi-project bridge selector inside the plugin.
- Flow-level Figma prototype connections.
- Variable binding with `nodeNameHint` resolution.
- Bidirectional sync: edits in Figma flow back into `.kotikit/specs/`.

## Audit
- Prop-type comparison (not just variant names).
- Runtime audit via Chrome DevTools MCP composition.
- Audit auto-runs as a pre-commit hook.
- Audit-fix flow: "I'd like to reconcile the Button mismatch — kotikit, do it."

## Documentation + onboarding
- A real installer (`npx create-kotikit`) that handles bun + Claude Code config in one step.
- Video walkthrough of the first hour.
- Per-tool examples that include Figma file links.

## Architecture
- Code → Figma reverse path (V2+ explicit).
- Real-time collaboration (multiple designers, one bridge).
- Headless mode for CI (drop the MCP server, expose a CLI).
```

**Acceptance criteria**

- All Phase 6 explicit deferrals (Q8) appear here.
- Each item is one or two lines, concrete.
- Grouped so a future contributor can pick from the section that matches their interest.

**Commit**: `docs(next-steps): add forward-looking improvement list`

---

## TIER 6 — Wire + E2E

### P6-F1 — Wire audit + get_system_prompt into `server.ts`
**Depends on:** P6-B1, P6-B2
**Complexity:** S

**What to build**

Edit `src/mcp/server.ts`:
- Import `registerAuditTools` from `./tools/audit.js`.
- Import `registerSystemPromptTools` from `./tools/system-prompt.js`.
- Add `registerAuditTools(registry, ctx)` and `registerSystemPromptTools(registry, ctx)` calls.

Update `src/mcp/server.test.ts` "registers all" assertion: count goes 24 → 26; add `"kotikit_audit"` and `"kotikit_get_system_prompt"` to the expected list.

**Commit**: `feat(mcp): register audit and get_system_prompt tools in server`

---

### P6-F2 — End-to-end audit test
**Depends on:** P6-F1
**Complexity:** M

**What to build**

`test/e2e/phase6.test.ts`. Drives the audit in-process:

1. Init config + git repo.
2. Run sync_ds with a fixture Figma client producing 3 DS components (Button, Card, Input).
3. Scaffold Button only — registry shows Button `synced`, Card + Input `design-only`.
4. Call `kotikit_audit`. Assert:
   - Report file written at `.kotikit/audit-report.json`.
   - 3 entries: Button `synced-ok`, Card `design-only`, Input `design-only`.
   - Summary counts correct.
5. Manually mutate Button's `.tsx` to add a fake `variants: { size: { ... } }` that doesn't match the DS. Re-run audit. Assert Button now `synced-mismatched` with `variantDelta.codeOnly === ["size"]`.
6. Call `kotikit_get_system_prompt({ kind: "react" })` — assert response contains the literal quality bar sentence and includes "TypeScript strict".
7. Token-shape verification: call `kotikit_implement_code_start` (no expand) — assert response carries `componentRefs` not `dsComponents`, and `systemPromptRef === "react"`.

**Commit**: `test(e2e): add phase 6 audit and token-shape smoke test`

---

## FINAL — Cross-review pass

After all tasks land, run **ONE Opus review** that reads:
- `README.md` (designer perspective)
- `docs/TOKENS.md` (engineer perspective)
- The audit engine + report shape
- Spot-check 2 module docs

The review answers two questions:
1. Could a UX/UI designer install kotikit and ship one screen reading ONLY README + docs/tools.md? If not, what's missing?
2. Are the token mitigations measurable improvements, or did we trade clarity for marginal gains?

Fix whatever the review surfaces. Final commit: `docs: address final review feedback`.

---

## 2. Definition of Done for Phase 6

- [ ] `bun install`, `bun x tsc --noEmit`, and `bun test` all pass.
- [ ] `bun run src/mcp/server.ts` exposes **26 tools** (Phase 1-5 + `kotikit_audit` + `kotikit_get_system_prompt`).
- [ ] `kotikit_audit` walks the registry and produces a 4-category report.
- [ ] `kotikit_implement_code_start` and `kotikit_scaffold_start` ship ~80% smaller default responses than Phase 5 (measured via `scripts/measure-tokens.ts`).
- [ ] `kotikit_get_system_prompt` returns the React, brainstorm, and scaffold doctrines, each fetched once per session.
- [ ] `README.md` is rewritten for a UX/UI designer audience and fits on one scroll page in a browser.
- [ ] 9 module docs exist under `docs/modules/`.
- [ ] `docs/tools.md` lists every MCP tool with token cost.
- [ ] `docs/TOKENS.md` explains the 5-hour-budget pathology and three mitigations.
- [ ] `NEXT_STEPS.md` lists concrete V2+ items.
- [ ] A final Opus review has approved or been addressed.
- [ ] Each task lands as one atomic commit with `feat(<scope>)` / `docs(<scope>)` + `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

## 3. Parallelization summary

- **Wave 1 (1 agent):** A1 audit engine.
- **Wave 2 (2 agents):** B1 audit tool, B2 get_system_prompt tool.
- **Wave 3 (3 agents):** C1 scaffold pagination, C2 implement_code lazy expand, C3 brainstorm prompt ref.
- **Wave 4 (1 agent):** D1 measure-tokens script.
- **Wave 5 (3 agents):** E1 README, E2 module docs, E3 tools cheat-sheet.
- **Wave 6 (2 agents):** E4 TOKENS.md, E5 NEXT_STEPS.md.
- **Wave 7 (1 agent):** F1 wire + F2 E2E test (sequential).
- **Final:** Opus review + fixes.

## 4. Out of scope (explicit deferrals)

- **Playwright** — Chrome DevTools MCP covers the use case as a composed peer tool.
- **Second framework adapter** (Vue/Svelte) — premature; React adapter not yet exercised at scale.
- **Bidirectional sync** (Figma edits → specs) — Phase 5 OOS, still OOS.
- **Code → Figma reverse** — V2+.
- **Runtime drift audit** (browser render + visual diff) — Q1 decision.
- **MCP `cache_control` markers** — not surfaced by Sonnet 4.6 today.
- **Per-tool token telemetry tool** — measurement is static via the script.
- **Auto-generated module docs from JSDoc** — hand-written for designer clarity.
- **Multi-project / monorepo config inheritance** — Phase 5 OOS, still OOS.
- **Token budget enforcement** (refusing tool calls over a quota) — documenting is the V1 answer.

## 5. Atomic commit discipline

Same rules as Phases 1-5:

- One task = one commit.
- Subject `feat(<scope>): <imperative summary>` or `docs(<scope>): <imperative summary>`, under 72 chars.
- Body explains the WHY in 2-3 sentences.
- Footer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` (mandatory).
- No `--no-verify`. No amending.
- Tests + typecheck must pass before each commit.
- The full suite must stay green at every commit.
