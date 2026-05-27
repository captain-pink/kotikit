# Kotikit — Framework Plan

> A Claude Code plugin (MCP server) that lets a UX/UI designer ship both the design (Figma) and the production frontend code from one plain-language workflow. The **spec is the source of truth**. Everything else is a regenerable artifact. The primary user is a designer who is **not** a developer — zero cognitive load is the product mandate.

---

## 0. TL;DR for the impatient

- **One front door:** `/kotikit:auto`. No sub-commands, no flags, no terminal jargon. The designer types it once, then just answers plain-language questions. The agent runs the whole workflow conversationally.
- **Flow:** Brainstorm → Spec → (Phase 2+: Plan → Implement). The spec, and the conversation that produces it, is everything in Phase 1.
- **Granularity rule — one spec = one screen.** A multi-screen flow is a *folder* containing one `<screen>.spec.json` per screen plus a single `flow.json` manifest that connects them. A single screen is a folder with one `spec.json`. There is no "too big" exception: a 20-screen onboarding flow is 20 spec files + one manifest. Plans are generated per screen, so they stay small and parallel-executable.
- **Specs are mutable.** They are readable JSON files in `.kotikit/specs/`. **Git is the history.** No hashing, no locks, no immutability ceremony.
- **Git is automatic.** On every spec save kotikit auto-commits with a conventional-commits message (`feat(spec): create <scope>` / `feat(spec): update <scope>`). Local only — never auto-pushes, never auto-branches. Opt out with `"autoCommit": false`.
- **Token efficiency is the prime directive.** The agent never loads a whole manifest, a whole icon list, or a whole component database. It *searches* (SQLite FTS5) and pulls back exactly the rows it needs, then reads individual files by path.
- **Global config inheritance.** `.kotikit/config.json` defines breakpoints and themes once. Every spec inherits them. A spec overrides only what differs via a small `overrides` block.
- **Two spec states:** `draft` → `active`. That is the entire lifecycle.
- **Code quality is the framework's job, not the user's.** A fixed best-practices baseline (TS strict, WCAG-AA, error boundaries, responsive, no debug code) ships by construction. Tests are on by default and togglable in config.
- **V1 is design → code only.** Figma design system → React components. Code → Figma is explicitly V2+. There is no reverse path in V1.
- **React-first, framework-agnostic by design.** Everything framework-specific lives behind one adapter interface. No CI/CD. No lock-in.

---

## 1. Philosophy & Problem Statement

The "is code or Figma the source of truth?" debate is the wrong fight. Code is an artifact. Figma is an artifact. Both drift, both get reinterpreted, both end up with five versions of the same button and nobody able to say which one is canonical.

**Kotikit's thesis:** the *specification* is the source of truth. Design and code are generated from it. The spec captures intent — what a screen does, how it looks, the states it has, the constraints it must satisfy. From the spec you can produce a faithful design *and* a faithful codebase.

Three things shape every decision below:

**1. The primary user is a UX/UI designer, not an engineer.** Designers are getting squeezed — told they are too slow, that they cannot deliver code, that they cannot keep up with AI-accelerated teams. Kotikit gives a designer the ability to own the entire UI surface: design *and* frontend. The framework cannot assume the user knows React, accessibility rules, git internals, or even what a terminal is. **The framework is the senior engineer in the room.** The entire interface is one command and a conversation.

**2. Mutable specs, git as history, git driven for the user.** A spec is a file. You edit it. `git diff` tells you what changed and `git log` tells you who and when. But the designer never has to *touch* git — kotikit auto-commits every save with a clean conventional-commits message. No locks, no content hashes, no compliance ceremony. We are building a fast, lightweight tool a solo designer can run today, not a compliance system.

**3. Token efficiency is a first-class architectural constraint, not a tuning pass.** Every data structure is designed around one question: *can the agent get exactly what it needs without loading a large file into context?* If the answer is no, the design is wrong. A 1000-icon manifest is 10k+ wasted tokens every load. A 500-component manifest is 50–100KB of garbage in the context window. We refuse to pay that. The agent searches an on-device SQLite index, gets back the handful of matching `(name, path)` rows, and reads only the individual files those paths point to. Every token matters.

What is new is bringing formal-spec rigor to a designer's desk in a form they can actually run, behind a single conversational command, with token discipline that makes it cheap enough to use every day.

---

## 2. Core Concepts

### 2.1 Screen Spec

A spec is a structured, **mutable** document describing **exactly one screen**. It captures:

- **Context** — what the screen accomplishes, for whom, and how the user gets there.
- **Functional requirements** — behaviors, and every state (loading, empty, error, filled, plus any screen-specific states).
- **Design constraints** — responsive + theme behavior (inherited from config unless overridden), component references (by design-system key).
- **Acceptance criteria** — concrete, testable statements. These directly seed the generated tests in later phases.

**Granularity rule (the single most important structural decision):**

> **One spec = one screen.**

- A "screen" is a single destination the user lands on (cart, profile, settings, dashboard).
- A multi-screen **flow** (checkout, onboarding, password reset) is a *folder* of N screen specs plus one `flow.json` manifest that wires them together.
- There is **no "how big is too big" exception.** A 20-screen onboarding flow is 20 spec files + one manifest. This keeps every spec small, focused, and (in later phases) parallel-plannable and parallel-implementable.
- A small widget (date picker, toast, avatar) is **never** a spec. In later phases it appears as a step inside a screen's plan and, if reusable, lives in the component registry.

**Lifecycle — two states, that is all:**

```
draft → active
```

- `draft` — being brainstormed / freshly created. Mutable. Can be deleted freely.
- `active` — has been used to generate a plan or implementation (Phase 2+). Still fully mutable. It just means "real work has flowed through this."

No `immutable`, `deprecated`, `superseded`, `recalled`. If a spec is wrong, you edit it; git remembers the old version. If a spec is dead, delete the file; git remembers it existed.

### 2.2 Flow Manifest

When the designer describes something spanning multiple screens, kotikit brainstorms the whole flow up front, then emits **one `flow.json`** describing all screens, the transitions between them, and the shared state — alongside one `<screen>.spec.json` per screen. The manifest is the connective tissue; each screen spec stays self-contained.

### 2.3 Folder layout for specs

Multi-screen flow:

```
.kotikit/specs/checkout-flow/
  flow.json              ← manifest: screens + transitions + sharedState
  cart.spec.json
  shipping.spec.json
  payment.spec.json
  review.spec.json
  confirmation.spec.json
```

Single screen (still a folder, no manifest):

```
.kotikit/specs/profile-page/
  spec.json
```

This plays perfectly with git — a flow's entire history is one directory — and avoids any "which bucket does this go in" paralysis.

### 2.4 Plan (Phase 2+)

A plan is generated **from a single screen spec, on demand**, and is **ephemeral**. It breaks one screen into concrete, ordered, implementable steps for one track (design or code). Plans are disposable scratch paper, regenerated from the current spec whenever needed. Because granularity is one-spec-per-screen, plans are inherently small and can be executed in parallel across screens. (Detailed in Phase 3 / Phase 5.)

### 2.5 Component Registry (Phase 4)

The bridge between the design system and the codebase. One lightweight entry per component: `DS component (name + key) ↔ code component (path) ↔ status`, where status ∈ `design-only | code-only | synced`. It powers scaffolding ("DS components with no code yet") and the drift audit ("which mappings disagree?"). Queryable from both directions. Lives in SQLite (`design-system/registry.db`) so it is searchable, not loadable.

### 2.6 Design System Snapshot (Phase 2)

A local, agent-readable mirror of one *or more* Figma design-system files under `design-system/`, produced by sync. **Not** a file you load — a set of SQLite indexes you *query* plus per-component JSON files you read by path. Multiple Figma files merge into one local snapshot.

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Claude Code session (VS Code)                 │
│                                                                        │
│                          /kotikit:auto   ← the ONE front door          │
│                                  ↕                                     │
│                        Kotikit MCP Server (local Bun process)          │
│                                                                        │
│   tools:  config.* · brainstorm · spec.* · flow.* · git.commit ·       │
│           (Phase2+) ds.search · icons.search · registry.* ·            │
│                     scaffold · audit · sync                            │
└───────────────┬───────────────────────────────────┬───────────────────┘
                │                                     │
        ┌───────▼────────┐                   ┌────────▼─────────┐
        │  Spec Engine    │                   │  Design System   │  (Phase 2+)
        │                 │                   │  Sync            │
        │  .kotikit/specs │                   │                  │
        │   <scope>/      │                   │  bottleneck +    │
        │    spec.json    │                   │  backoff +       │
        │    *.spec.json  │                   │  resume/         │
        │    flow.json    │                   │  checkpoint      │
        │  + auto git     │                   │                  │
        └───────┬─────────┘                   └────────┬─────────┘
                │                                      │  Figma REST API
                │                                      │  (multiple files)
                │                             ┌────────▼─────────┐
                │                             │  design-system/  │
                │                             │   components.db  │ ◄─ FTS5
                │                             │   icons.db       │ ◄─ FTS5
                │                             │   registry.db    │
                │                             │   manifest.json  │ (tiny)
                │                             │   components/*.json
                │                             │   variables.json │
                │                             │   audit-report.json
                │                             └────────┬─────────┘
        ┌───────▼──────────────────────────────────────▼─────────┐
        │              Planning Engine (Phase 3 / 5)               │
        │   per-screen spec → design.plan.json | code.plan.json    │
        └───────┬───────────────────────────────────┬─────────────┘
                │                                     │
        ┌───────▼────────┐                   ┌────────▼──────────────┐
        │  Design Track   │   (Phase 5)       │  Code Track  (Phase 3) │
        │  Figma plugin   │                   │  Chrome DevTools MCP   │
        │  places DS      │                   │  Playwright MCP        │
        │  components by  │                   │  Filesystem (native)   │
        │  key, autolayout│                   │  React + tests         │
        └─────────────────┘                   └────────────────────────┘

V1 data flow is one direction only:  Figma design system ──► React code.
Code ──► Figma is V2+ and intentionally absent.
```

---

## 4. Module Breakdown

### 4.0 Kotikit MCP Server

The plugin is a local MCP server — that is the entire integration story with Claude Code. No proprietary plugin API. VS Code with the Claude Code extension is the primary interface; a separate Figma plugin (Phase 5) drives the design-implementation track.

**Exposed tools (token-disciplined by design):**

| Tool | What it does | Token note | Phase |
|---|---|---|---|
| `kotikit_config_status` | Is kotikit initialized in this project? returns gaps | tiny | 1 |
| `kotikit_config_init` | Write `.kotikit/config.json` from wizard answers | writes one file | 1 |
| `kotikit_config_get` | Read resolved config (secrets resolved) | reads one file | 1 |
| `kotikit_brainstorm` | Deep interactive spec discovery (see §4.2) | conversational | 1 |
| `kotikit_spec_create` | Write a new screen spec | writes a file + git commit | 1 |
| `kotikit_spec_get` | Read a spec by scope/screen | reads one file | 1 |
| `kotikit_spec_list` | List specs/flows with status | reads tiny index | 1 |
| `kotikit_spec_update` | Edit an existing spec | writes a file + git commit | 1 |
| `kotikit_flow_create` | Write `flow.json` + N screen specs | writes files + git commit | 1 |
| `kotikit_git_commit` | Conventional-commit a spec change (local) | one commit | 1 |
| `kotikit_ds_search` | `SELECT name, path FROM components WHERE name MATCH ?` | matching rows only | 2 |
| `kotikit_ds_get_component` | Read one component JSON by path | reads one file | 2 |
| `kotikit_icons_search` | `SELECT name FROM icons WHERE name MATCH ?` | matching rows only | 2 |
| `kotikit_sync_ds` | Trigger / resume Figma sync | proxies to sync engine | 2 |
| `kotikit_plan_create` | Generate an ephemeral per-screen plan | scratch file | 3/5 |
| `kotikit_registry_search` / `_update` | Query / upsert registry mappings | matching rows only | 4 |
| `kotikit_scaffold` | Generate typed components + stories for selected DS components | per-selection | 4 |
| `kotikit_audit` | Run design↔code drift audit, write report | small report | 6 |

**Slash command surface (CLAUDE.md):**
The designer only ever needs **`/kotikit:auto`**. It is the conversational front door that orchestrates everything (init check → brainstorm → spec/flow create → confirm → auto-commit → "what next?"). Power users may eventually reach individual tools, but the documented, supported, recommended interface is one command.

### 4.1 Spec Engine

**Organization: flow-as-folder, spec-as-screen.** Each thing the designer builds gets a folder under `.kotikit/specs/`. A single-screen scope holds one `spec.json`. A multi-screen flow holds one `flow.json` manifest plus one `<screen>.spec.json` per screen.

```
.kotikit/
  config.json
  index.json                        # tiny: scope → {title, kind, status, screens, updatedAt}
  specs/
    checkout-flow/
      flow.json
      cart.spec.json
      shipping.spec.json
      payment.spec.json
      review.spec.json
      confirmation.spec.json
    profile-page/
      spec.json
    onboarding/
      flow.json
      welcome.spec.json
      ...
```

`index.json` is deliberately tiny — scope, title, kind, status, screen names, updatedAt — so `kotikit_spec_list` never reads a single spec body. It is the only "load the whole thing" file in the system, kept small on purpose.

**Screen spec schema** (`<screen>.spec.json`, or `spec.json` for a single-screen scope):

```json
{
  "id": "uuid-v4",
  "version": "1.0.0",
  "status": "draft",
  "title": "Cart Screen",
  "type": "screen",
  "flowRef": "checkout-flow/flow.json",
  "context": {
    "description": "Shows the user's selected items with quantity controls, pricing summary, and a CTA to proceed.",
    "userTypes": ["returning buyer", "guest"],
    "entryPoints": ["Product page add-to-cart", "Navigation cart icon"]
  },
  "requirements": {
    "functional": [
      "User can change item quantity",
      "User can remove items"
    ],
    "states": {
      "loading": "Skeleton of item list",
      "empty": "Illustration + 'Your cart is empty' + Shop CTA",
      "error": "Toast: 'Failed to load cart. Try again.'",
      "filled": "Item list + summary + CTA"
    },
    "responsive": "inherits",
    "themes": "inherits"
  },
  "components": [
    { "name": "Button", "dsKey": "abc123", "usage": "Proceed to Checkout CTA" }
  ],
  "acceptanceCriteria": [
    "Changing quantity updates the price summary in real time",
    "Removing last item shows empty state"
  ],
  "metadata": {
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
}
```

Notes:
- `flowRef` is present only when the screen belongs to a flow; it is omitted for single-screen scopes.
- `responsive` and `themes` are `"inherits"` by default. To override, replace the string with an `overrides` block: `"responsive": { "overrides": { "breakpoints": [375] } }` — a mobile-only screen restates only what differs; everything else is inherited from `config.json`.
- What is **gone** versus the immutable v1 design: `contentHash`, `lockedAt`, `lockedBy`, `supersededBy`, `supersedes`, `auditLog`. Git owns all of that.

**Flow manifest schema** (`flow.json`):

```json
{
  "id": "uuid-v4",
  "title": "Checkout Flow",
  "description": "Full purchase flow from cart review to order confirmation.",
  "screens": [
    { "id": "cart", "path": "cart.spec.json", "title": "Cart" },
    { "id": "shipping", "path": "shipping.spec.json", "title": "Shipping" },
    { "id": "payment", "path": "payment.spec.json", "title": "Payment" },
    { "id": "review", "path": "review.spec.json", "title": "Order Review" },
    { "id": "confirmation", "path": "confirmation.spec.json", "title": "Confirmation" }
  ],
  "transitions": [
    { "from": "cart", "to": "shipping", "trigger": "Proceed to Checkout button" },
    { "from": "shipping", "to": "payment", "trigger": "Continue button" },
    { "from": "payment", "to": "review", "trigger": "Review Order button" },
    { "from": "review", "to": "confirmation", "trigger": "Place Order button" }
  ],
  "sharedState": ["cartItems", "shippingAddress", "paymentMethod"],
  "metadata": { "createdAt": "ISO-8601", "updatedAt": "ISO-8601" }
}
```

### 4.2 Spec Brainstorm Agent (deep by design)

This is the quality engine of the whole product, so it gets its own section.

The brainstorm agent does **not** "ask 3–5 questions." That pattern produces shallow specs that everyone interprets differently — the exact failure kotikit exists to prevent. Instead the agent **hunts for ambiguity and pitfalls until the screen is implementable identically by anyone.**

It must probe, at minimum:

- **State coverage:** loading, empty, error, partial, success, offline, slow-network, first-time vs returning.
- **Visual edge cases:** long text / truncation, missing images, very large lists, RTL, smallest and largest supported viewport, dark mode.
- **Accessibility (WCAG-AA target):** keyboard path through the screen, focus order, focus traps in modals, screen-reader labels, color-contrast targets, reduced-motion.
- **Interaction details:** double-submit, back-button mid-flow, session expiry, validation failure.
- **Data contracts:** what the screen needs, what is optional, what blocks rendering.
- **Responsive behavior:** what reflows, collapses, stays sticky, per breakpoint (relative to inherited config).
- **Flow connectivity (multi-screen only):** entry points, transitions, what state carries across screens.

When the input describes a flow, the agent brainstorms the **whole flow first** (so transitions and shared state are coherent), then drills into each screen.

The agent keeps asking until it can state, with confidence: *"any developer or designer could build this identically from the spec alone."* That sentence is the literal quality bar and appears in the brainstorm system prompt. Only then does it offer to write the spec(s).

All questions are plain language. The agent never asks the designer about JSON, schemas, breakpoint pixel values, or git. It translates everything into design conversation.

### 4.3 Git Integration (automatic, invisible)

Most designers do not use git. Kotikit removes that barrier entirely while keeping a clean, professional history.

- **On every spec save** (`spec_create`, `spec_update`, `flow_create`): kotikit stages the affected spec files and auto-commits.
- **Conventional commits format:**
  - First create of a scope: `feat(spec): create <scope-name>`
  - Subsequent edits: `feat(spec): update <scope-name>`
  - Footer on every commit: `Co-authored-by: Claude Code <noreply@anthropic.com>`
- **Local only.** Never `git push`. Never creates branches. Commits onto whatever branch is currently checked out.
- **Opt out:** `config.json → "git": { "autoCommit": false }`. When off, kotikit writes files and tells the designer in plain English that nothing was committed.
- **No repo yet?** If the project is not a git repo, kotikit explains it in one sentence and offers to `git init` (still no remote, no push). If declined, it falls back to write-only and says so.

### 4.4 Design System Sync (Phase 2)

**Trigger:** `kotikit_sync_ds` (reads file keys + token from `config.json`). Also schedulable.

**Multiple files:** `config.json` lists every design-system Figma file. Sync pulls all and **merges** into one local `design-system/` snapshot. On cross-file name collisions, later-listed file wins; the conflict is recorded in the sync report.

**Rate limits + resilience (non-negotiable):** **bottleneck** to cap request rate; **exponential backoff with jitter** on 429/5xx; **resume/checkpoint** via `design-system/.sync-checkpoint.json` written after each completed unit, so a killed sync resumes instead of restarting. A finished sync clears the checkpoint.

**Algorithm:** per file → metadata/pages → published components & component sets → extract variants/properties/default key → detect icons (`Icon/` prefix or `Icons` page) into `icons.db` → try `variables/local` (warn + continue on 403/Enterprise gate); extract color/text/effect styles (all plans) into `variables.json` → write each non-icon component to `components/<name>.json` + upsert FTS5 row → upsert icon rows → update tiny `manifest.json` + checkpoint.

(Full component JSON schema, manifest schema, and SQLite design are unchanged from prior planning — see §6.)

### 4.5 Planning Engine (Phase 3 / 5)

Takes a **single screen spec** + a track and produces an **ephemeral** plan written next to the spec (`<screen>.code.plan.json` / `<screen>.design.plan.json`). Because granularity is one-spec-per-screen, plans are small and screens can be planned and implemented in parallel. Plans are regenerable from the current spec; nothing migrates.

### 4.6 Implementation Tracks

**Code Track (Phase 3) — V1's payoff track.** The code agent reads a per-screen code plan, searches the registry to reuse existing components, scaffolds the rest from DS component JSON read by path, builds the screen to the §7 quality bar, generates tests from acceptance criteria (when `tests: true`), validates via Chrome DevTools MCP + Playwright MCP, updates the registry, and sets the spec `draft → active`.

**Design Track (Phase 5).** Driven by the Figma plugin (MCP). Reads a per-screen design plan, searches the snapshot for `(name, path)`, reads one component JSON, places components by key with auto-layout, binds variables. This is a separate interface from `/kotikit:auto` and is acknowledged but out of Phase 1 scope.

> **V1 is design → code only.** There is no code → Figma path in V1. The audit (Phase 6) handles "you have both, find mismatches"; *generating* Figma from code is V2+.

### 4.7 Component Scaffolding from the Design System (Phase 4)

`/kotikit:auto` can route the designer into scaffolding: it surfaces DS components with status `design-only`, the designer multi-selects, and for each kotikit reads the component JSON and generates a typed React component exposing **all variants as props** plus a Storybook story covering every variant combination, then marks the registry entry `synced`. Runs the §7 quality bar.

### 4.8 Drift Audit (Phase 6)

Compares `design-system/components/` against the project's components folder and writes a **small** `audit-report.json`. The mismatch list is intentionally **minimal**: name + type-of-mismatch + a one-line prop delta. Nothing more.

```json
{
  "ranAt": "ISO-8601",
  "summary": { "designOnly": 2, "codeOnly": 1, "variantGap": 1, "ok": 44 },
  "mismatches": [
    { "name": "Button", "mismatch": "variant-gap", "delta": "DS has [ghost] variant, code does not" }
  ]
}
```

The audit walks the designer through mismatches one at a time, in plain language, asks which side is canonical, and fixes it (scaffold the missing side, or update props to match the chosen source).

---

## 5. Repository Structure

```
kotikit/
  src/
    mcp/
      server.ts                # MCP server entry point
      tools/
        config.ts              # status / init / get
        brainstorm.ts          # the deep-questioning tool (Phase 1)
        spec.ts                # create/get/list/update (mutable)
        flow.ts                # flow.json + N screen specs
        git.ts                 # conventional-commit on save
        ds-search.ts           # (Phase 2) FTS5 over components.db
        icons-search.ts        # (Phase 2) FTS5 over icons.db
        plan.ts                # (Phase 3/5) ephemeral per-screen plans
        registry.ts            # (Phase 4)
        scaffold.ts            # (Phase 4)
        audit.ts               # (Phase 6)
        sync.ts                # (Phase 2)
    spec/
      engine.ts                # plain file read/write, no locks/hashing
      schema.ts                # Zod schemas (screen spec, flow manifest)
      decompose.ts             # single-screen vs multi-screen detection
      index-store.ts           # read/write tiny .kotikit/index.json
    git/
      auto-commit.ts           # conventional commits, local only
    config/
      schema.ts                # Zod config schema + defaults
      load.ts                  # read config, resolve secrets (op/env)
      init.ts                  # wizard → config.json
    sync/                      # (Phase 2) figma-client, limiter, checkpoint, ...
    db/                        # (Phase 2+) components/icons/registry FTS5
    planning/                  # (Phase 3/5) design-planner, code-planner
    codegen/                   # (Phase 3+) react/ adapter + adapter.ts interface
    audit/                     # (Phase 6) drift.ts
  .kotikit/
    config.json
    index.json
    specs/<scope>/{spec.json | flow.json + *.spec.json}
  design-system/               # (Phase 2+) manifest.json, *.db, components/*.json, ...
  CLAUDE.md                    # documents /kotikit:auto
  package.json
  tsconfig.json
```

---

## 6. SQLite FTS5 Search Design (the token-efficiency core, Phase 2)

Everything here answers one question cheaply: *find the few things the agent needs, return only those, then read individual files by path.* Bun ships `bun:sqlite` with FTS5 — zero extra dependency.

### 6.1 `components.db`

```sql
CREATE VIRTUAL TABLE components USING fts5(
  name,            -- "Button", "PieChart", "Input"
  path UNINDEXED,  -- "components/button.json"
  key  UNINDEXED,  -- Figma component-set key
  props            -- flattened property names, e.g. "Variant State Size Icon"
);
```

Agent query returns a handful of rows (~tens of tokens):

```sql
SELECT name, path, key FROM components WHERE name MATCH 'button*';
```

The agent then reads only `components/button.json`. A 500-component design system costs the size of the matching rows, not 50–100KB.

### 6.2 `icons.db`

A **flat FTS5 table**. No per-icon files, no folders, no 10k-token manifest.

```sql
CREATE VIRTUAL TABLE icons USING fts5(
  name,            -- "arrow-right"
  key  UNINDEXED,  -- Figma node/component key
  svg  UNINDEXED   -- optional inline svg or path; UNINDEXED so it never bloats matches
);
```

1000+ icons cost nothing until you search; a search returns only the matches.

### 6.3 `registry.db`

```sql
CREATE TABLE registry (
  name      TEXT PRIMARY KEY,
  ds_path   TEXT,
  code_path TEXT,
  status    TEXT             -- design-only | code-only | synced
);
```

Queryable both directions; powers `/scaffold` and `/audit`. Small result sets only.

**The rule the agent follows everywhere: search the index, then read one file.** Never load a database. Never load a manifest for lookups.

---

## 7. Code Quality System (non-negotiable, Phase 3)

The user is a designer running code nobody will review. The framework, not the user, owns quality. Generated code meets a **fixed best-practices baseline by construction**:

- **TypeScript strict.** No `any`, no `@ts-ignore`. `tsc --noEmit` must pass.
- **WCAG-AA accessibility.** Semantic HTML first, ARIA only where semantics fall short. Full keyboard navigation, correct focus order, focus management for overlays/modals, labelled inputs, `aria-live` for async feedback, reduced-motion respected, AA contrast.
- **Responsive.** Honors the **global breakpoints from config** (or per-spec overrides). No fixed pixel widths where a fluid value belongs.
- **Error boundary on every page-level component.**
- **No `console.log` or debug code** in generated output.
- **Tests — configurable, on by default.** Unit tests per component + integration tests per screen, generated from acceptance criteria. Controlled by `config.json → project.tests` (`true | false`, default `true`). When `false`, all other baseline items still apply.

**How it is enforced (not just hoped for):** generation prompts carry the baseline as hard constraints per adapter; static gates run automatically (`tsc --noEmit`, ESLint with `jsx-a11y`, Prettier); runtime gates (Chrome DevTools MCP contrast/layout, Playwright integration runs + screenshots) must pass before a step is "done." The designer never has to know any of this happened.

---

## 8. Technical Stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** | Fast startup, native TS, ships `bun:sqlite` |
| Search index | **`bun:sqlite` + FTS5** | Built in; token-efficiency core; no extra dep |
| Schema validation | **Zod** | Runtime + type safety for spec/flow/config schemas |
| MCP server | **`@modelcontextprotocol/sdk`** | Claude Code native integration |
| Git | **`simple-git`** (or shelled `git`) | Auto-commit, conventional messages, local only |
| IDs | **`crypto.randomUUID()`** | uuid-v4 for spec/flow `id` |
| Figma API | **native fetch** (Phase 2) | REST only; no heavy SDK |
| Rate limiting | **bottleneck** (Phase 2) | Figma's req/s caps |
| Backoff | **exponential + jitter** (small util) | Survive 429/5xx during large syncs |
| Secrets | **`.env` + 1Password CLI (`op`)** | Designers are not security experts (§9) |
| File format | **JSON + Markdown** | Human-readable, git-diffable, agent-readable |
| Codegen (V1) | **React + shadcn/ui adapter** | First target; adapter interface keeps it agnostic |
| Browser automation | **Playwright MCP** (Phase 3) | Visual validation + integration test execution |
| Live inspection | **Chrome DevTools MCP** (Phase 3) | Computed styles, contrast, layout debugging |
| Tests | **Bun test** (unit) + **Playwright** (integration) | Built-in + browser-level |

---

## 9. Configuration & Token Security

`.kotikit/config.json` defines global defaults **once**; every spec inherits them.

```json
{
  "figma": {
    "token": "${FIGMA_TOKEN}",
    "designSystemFiles": [
      { "key": "abc123XYZ", "name": "Core Design System" }
    ]
  },
  "project": {
    "framework": "react",
    "codeComponentsDir": "src/components",
    "tests": true
  },
  "defaults": {
    "breakpoints": [375, 768, 1024, 1440],
    "themes": ["light", "dark"]
  },
  "git": {
    "autoCommit": true
  }
}
```

**Inheritance:** specs say `"responsive": "inherits"` / `"themes": "inherits"` and only restate differences via an `overrides` block. A mobile-only screen adds `"overrides": { "breakpoints": [375] }` — nothing else.

**Token security.** Designers are not security experts, so the framework gives a safe default and an easy upgrade:
- **Baseline:** `.env`, git-ignored. `FIGMA_TOKEN=...`. `config.json` references it as `${FIGMA_TOKEN}`.
- **Team upgrade: 1Password CLI (`op`).** `"token": "op://Design/FigmaToken/credential"` is resolved at runtime via `op read`. The token is never written into any committed file. `config/load.ts` detects the `op://` scheme and shells out; otherwise it expands `${ENV_VAR}` from the environment.

---

## 10. End-to-End Workflow

### 10.1 First-time setup — a conversation, not flags

```
> /kotikit:auto
Kotikit isn't set up in this project yet. Want me to set it up? (yes)
→ "What framework is your code in?"            (default: React)
→ "Where do your components live?"             (default: src/components)
→ "Should I generate tests for you?"           (default: yes)
→ "Want me to keep a clean history of your specs automatically?" (git autoCommit)
→ "Do you have a Figma design system to connect? (we can do this later)"
Writes .kotikit/config.json. "All set. What do you want to build?"
```

### 10.2 New work — the single front door

```
> /kotikit:auto
"What do you want to build?"
> "A checkout flow"
Agent recognizes a multi-screen flow → brainstorms the whole flow, then each screen,
hunting states/a11y/edge cases until "anyone could build this identically."
Confirms the screen list with the designer.
Writes:
  .kotikit/specs/checkout-flow/flow.json
  .kotikit/specs/checkout-flow/cart.spec.json
  .kotikit/specs/checkout-flow/shipping.spec.json
  ...etc
Auto-commits:  feat(spec): create checkout-flow
Then: "Done — 5 screens specified and saved. What next?"
   [ Add another screen · Edit a screen · Build the design · Build the code · Done ]
```

A single screen takes the same path and lands in `.kotikit/specs/profile-page/spec.json`.

### 10.3 Editing a spec

```
> /kotikit:auto  →  "Edit a screen"  →  pick scope/screen
Conversational changes. On save: feat(spec): update <scope>. git diff shows exactly
what changed. No locks, no versions, no ceremony. Then: "What next?"
```

The **"What next?" menu is a first-class UX element** at the end of every major action — the designer is never dropped back into a blank prompt wondering what to type.

---

## 11. Phased Rollout

Each phase is independently useful — you can stop after any one and still have a tool that earns its keep.

### Phase 1 — Spec Engine + Brainstorm + Git (the heart)
- MCP server skeleton (Bun, `@modelcontextprotocol/sdk`).
- Config engine + conversational `init`.
- Zod schemas: screen spec, flow manifest, config.
- Mutable spec CRUD over flow-as-folder / spec-as-screen; tiny `index.json`.
- Flow decomposition (single vs multi-screen → N specs + `flow.json`).
- Automatic git commits (conventional, local only, opt-out).
- The **deep** brainstorm agent (the differentiator — get it right first).
- `/kotikit:auto` as the sole conversational front door.
- **Useful alone:** a designer describes anything in plain language and gets a complete, structured, git-committed spec they could hand to any developer or AI agent and get an identical result. No design sync, no codegen needed. *(See `planning/phase-1.md`.)*

### Phase 2 — Design System Sync + Search
- Figma client, bottleneck + backoff, checkpoint/resume; multi-file merge; icon detection.
- `components.db` / `icons.db` FTS5; tiny `manifest.json`; per-component JSON.
- `kotikit_ds_search`, `kotikit_icons_search`, sync (+ schedule); 1Password/`.env` resolution.
- **Useful alone:** a token-cheap, searchable local mirror of the design system.

### Phase 3 — Code Track + Quality System
- Per-screen code planner; React + shadcn adapter behind the adapter interface.
- Quality gates (tsc strict, eslint jsx-a11y, prettier) wired into "step done."
- Unit + integration test generation from acceptance criteria (configurable).
- **Useful alone:** designer → production-grade React from a spec.

### Phase 4 — Component Registry + Scaffolding
- `registry.db`, bidirectional search; multi-select DS → typed components + Storybook stories.
- **Useful alone:** bootstrap a coded library mirroring the design system.

### Phase 5 — Design Track
- Figma plugin integration; per-screen design planner; component placement by key.
- **Useful alone:** designer assembles screens in Figma from the snapshot, no manual search.

### Phase 6 — Drift Audit + Polish
- `/audit` (schedule + manual); minimal `audit-report.json`; one-by-one reconciliation.
- Onboarding docs; second framework adapter to prove the adapter boundary holds.

---

## 12. Architectural Guarantees

- **Adapter discipline.** All framework-specific code lives behind `codegen/adapter.ts`. The spec engine, config, git, planner, search, and quality gates are framework-neutral. If adding Vue later requires touching anything outside `codegen/vue/`, the boundary leaked.
- **Token discipline.** Search the index, read one file. Never load a database or a manifest for lookups.
- **Git owns history.** No content hashes, locks, or supersede chains in the spec model.
- **One spec = one screen.** Flows are folders; granularity never wobbles.
- **One front door.** `/kotikit:auto` is the only command the designer needs to know.
- **V1 is design → code only.** The reverse path is V2+ and intentionally absent.
