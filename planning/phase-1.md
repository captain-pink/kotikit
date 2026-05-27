# Kotikit — Phase 1 Implementation Plan

> **Phase 1 deliverable:** *A designer can describe what they want to build in plain language and get a complete, structured, git-committed spec they could hand to any developer or AI agent and get an identical result.*
>
> No design sync. No code generation. Just: **brainstorm → spec → saved to disk → committed to git**, all behind the single conversational command `/kotikit:auto`.

This document is self-contained. A senior engineer or AI agent with **zero prior kotikit context** should be able to read it and build the right thing the first time. Read §0 (orientation) before picking up any task.

---

## 0. Orientation — what you are building (read this first)

Kotikit is a **local MCP server** (Bun + `@modelcontextprotocol/sdk`) that plugs into Claude Code. Its primary user is a **UX/UI designer who is not a developer**. The product mandate is **zero cognitive load**: the designer never sees a flag, a schema, or a git command. They type `/kotikit:auto` and have a conversation. The agent (Claude, driving the MCP tools) does everything else.

Phase 1 ships these capabilities:

1. **Config + init** — first run is a friendly conversation that writes `.kotikit/config.json`.
2. **Specs** — structured JSON describing screens, validated by Zod, written to `.kotikit/specs/<scope>/`.
3. **Flows** — a multi-screen request produces one `flow.json` manifest plus one `<screen>.spec.json` per screen, all in one folder.
4. **Git** — every spec save auto-commits with a conventional-commits message (local only).
5. **Brainstorm** — a deep-questioning agent that refuses to stop until the spec is unambiguous.
6. **`/kotikit:auto`** — the one front door that orchestrates init-check → brainstorm → create → commit → "what next?".

### The one structural rule you must never break

> **One spec = one screen.** A multi-screen flow is a *folder* containing one `<screen>.spec.json` per screen plus one `flow.json`. A single screen is a folder with one `spec.json`. A 20-screen flow has 20 spec files. There is no "too big" exception.

### Folder layout produced by Phase 1

```
.kotikit/
  config.json
  index.json                       # tiny: scope → {title, kind, status, screens, updatedAt}
  specs/
    checkout-flow/                 # multi-screen flow
      flow.json
      cart.spec.json
      shipping.spec.json
      payment.spec.json
      review.spec.json
      confirmation.spec.json
    profile-page/                  # single screen
      spec.json
```

### Source layout you will create

```
src/
  mcp/
    server.ts                      # MCP entry point, registers all tools
    tools/
      config.ts                    # config_status, config_init, config_get
      brainstorm.ts                # the deep-questioning tool
      spec.ts                      # spec_create, spec_get, spec_list, spec_update
      flow.ts                      # flow_create
      git.ts                       # git_commit (used by spec/flow tools)
  spec/
    schema.ts                      # Zod: ScreenSpec, FlowManifest
    engine.ts                      # file read/write/list, path helpers
    decompose.ts                   # single vs multi-screen detection helpers
    index-store.ts                 # read/write .kotikit/index.json
  git/
    auto-commit.ts                 # conventional commit, local only
  config/
    schema.ts                      # Zod: Config + defaults
    load.ts                        # read config, resolve ${ENV} and op:// secrets
    init.ts                        # build config object from wizard answers
  util/
    paths.ts                       # resolve .kotikit root, scope/screen paths
    ids.ts                         # uuid + slugify + ISO timestamp
    result.ts                      # plain-English error helpers
CLAUDE.md                          # documents /kotikit:auto
package.json
tsconfig.json (already exists, tune it)
```

### Conventions every task must follow

- **Language/runtime:** TypeScript, Bun. Use `bun:sqlite` later (not Phase 1). No CommonJS.
- **Validation:** every external/persisted shape goes through a Zod schema. Never trust raw JSON from disk.
- **Errors:** all user-facing errors are **plain English**, no stack traces, no jargon. Use `util/result.ts` helpers. Example: `"I couldn't find a screen called 'cart' in the 'checkout-flow' flow. The screens I have are: shipping, payment."`
- **Spec files are human-readable.** Always write JSON with `JSON.stringify(obj, null, 2)` and a trailing newline. A designer should be able to open the file and understand it.
- **Tool results are MCP `CallToolResult`** with a `content: [{ type: "text", text }]` payload. Tools return data as pretty JSON inside the text block plus a one-line plain-English summary first.
- **Absolute imports** off `src/` are fine via tsconfig paths; relative is also acceptable. Be consistent within a task.
- **No network, no Figma, no codegen in Phase 1.** If a task seems to need them, it is out of scope.

### Shared types (define in `spec/schema.ts` and `config/schema.ts`, import everywhere)

These are the canonical shapes. Do not redefine them per file.

```ts
// config/schema.ts
export const ConfigSchema = z.object({
  figma: z.object({
    token: z.string().optional(),                    // "${FIGMA_TOKEN}" or "op://..." (unused in P1)
    designSystemFiles: z.array(z.object({
      key: z.string(),
      name: z.string(),
    })).default([]),
  }).default({ designSystemFiles: [] }),
  project: z.object({
    framework: z.enum(["react"]).default("react"),    // only react in V1
    codeComponentsDir: z.string().default("src/components"),
    tests: z.boolean().default(true),
  }),
  defaults: z.object({
    breakpoints: z.array(z.number().int().positive()).default([375, 768, 1024, 1440]),
    themes: z.array(z.string()).default(["light", "dark"]),
  }),
  git: z.object({
    autoCommit: z.boolean().default(true),
  }).default({ autoCommit: true }),
});
export type Config = z.infer<typeof ConfigSchema>;
```

```ts
// spec/schema.ts
const InheritOr = <T extends z.ZodTypeAny>(overrides: T) =>
  z.union([z.literal("inherits"), z.object({ overrides })]);

export const ScreenSpecSchema = z.object({
  id: z.string().uuid(),
  version: z.string().default("1.0.0"),
  status: z.enum(["draft", "active"]).default("draft"),
  title: z.string().min(1),
  type: z.literal("screen"),
  flowRef: z.string().optional(),                     // "checkout-flow/flow.json"; omitted for single-screen
  context: z.object({
    description: z.string().min(1),
    userTypes: z.array(z.string()).default([]),
    entryPoints: z.array(z.string()).default([]),
  }),
  requirements: z.object({
    functional: z.array(z.string()).default([]),
    states: z.record(z.string(), z.string()),         // { loading, empty, error, filled, ... }
    responsive: InheritOr(z.object({ breakpoints: z.array(z.number().int().positive()) })),
    themes: InheritOr(z.object({ themes: z.array(z.string()) })),
  }),
  components: z.array(z.object({
    name: z.string(),
    dsKey: z.string().optional(),
    usage: z.string().optional(),
  })).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  metadata: z.object({
    createdAt: z.string(),                            // ISO-8601
    updatedAt: z.string(),                            // ISO-8601
  }),
});
export type ScreenSpec = z.infer<typeof ScreenSpecSchema>;

export const FlowManifestSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  screens: z.array(z.object({
    id: z.string(),                                   // short slug, e.g. "cart"
    path: z.string(),                                 // "cart.spec.json"
    title: z.string(),
  })).min(1),
  transitions: z.array(z.object({
    from: z.string(),
    to: z.string(),
    trigger: z.string(),
  })).default([]),
  sharedState: z.array(z.string()).default([]),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});
export type FlowManifest = z.infer<typeof FlowManifestSchema>;
```

---

## 1. Dependency tiers (the build order)

Tasks in the same tier have no dependencies on each other and **can be executed in parallel**.

| Tier | Tasks | Theme |
|---|---|---|
| **Tier 0** | P1-A1, P1-A2, P1-A3, P1-A4 | Foundations: scaffolding, utils, both Zod schema files, error helpers |
| **Tier 1** | P1-B1, P1-B2, P1-B3 | Engines on top of schemas: config load/init, spec engine + index store, git auto-commit |
| **Tier 2** | P1-C1, P1-C2, P1-C3 | Domain logic: flow decomposition, spec CRUD tool, MCP server skeleton |
| **Tier 3** | P1-D1, P1-D2, P1-D3 | Tools wired to engines: config tool, flow tool, brainstorm tool |
| **Tier 4** | P1-E1 | The front door: `/kotikit:auto` CLAUDE.md command |
| **Tier 5** | P1-F1 | End-to-end smoke test |

Dependency graph (text):

```
A1 ─┐
A2 ─┼─► B1 ─► D1 ─┐
A3 ─┼─► B2 ─► C1 ─┼─► C2 ─► C3 ─► D2 ─┐
A4 ─┘   B3 ──────►    (server)  D3 ─┼─► E1 ─► F1
                                     ┘
```

---

## TIER 0 — Foundations (no dependencies, start immediately)

### P1-A1 — Project scaffolding & build config
**Depends on:** none
**Complexity:** S

**What to build**
- Update `package.json`:
  - `"name": "kotikit"`, `"type": "module"`, `"version": "0.1.0"`.
  - `"bin": { "kotikit-mcp": "./src/mcp/server.ts" }`.
  - Scripts: `"mcp": "bun run src/mcp/server.ts"`, `"typecheck": "tsc --noEmit"`, `"test": "bun test"`.
  - Dependencies: `@modelcontextprotocol/sdk`, `zod`, `simple-git`. DevDeps keep `@types/bun`.
  - Run `bun add @modelcontextprotocol/sdk zod simple-git` to populate `bun.lock`.
- Create empty directory tree under `src/` exactly as in §0 (with `.gitkeep` or a placeholder `index.ts` exporting nothing, so the folders exist).
- Tune `tsconfig.json`: keep `strict: true`; additionally set `"noUnusedLocals": true`, `"noUnusedParameters": true`, `"noImplicitOverride": true`. Add a `paths` mapping `"@/*": ["./src/*"]` and `"baseUrl": "."` (optional but recommended).
- Add `.gitignore` entries (append, do not clobber existing): `.kotikit/**/*.local.json`, `*.log`. **Do not** ignore `.kotikit/specs` or `.kotikit/config.json` — those are the product output and must be committable.
- Delete the placeholder `index.ts` at repo root or repurpose it to re-export the server. Update `README.md` "To run" section to mention the MCP server (one line).

**Acceptance criteria**
- `bun install` succeeds; `@modelcontextprotocol/sdk`, `zod`, `simple-git` appear in `package.json` and `bun.lock`.
- `bun run typecheck` runs (will pass trivially since no real code yet).
- All directories from §0 exist.
- `cat .gitignore` shows `.kotikit/specs` is **not** ignored.

---

### P1-A2 — Core utilities (`util/`)
**Depends on:** none
**Complexity:** S

**What to build**
- `src/util/ids.ts`:
  ```ts
  export const uuid = (): string => crypto.randomUUID();
  export const nowIso = (): string => new Date().toISOString();
  /** "Checkout Flow" -> "checkout-flow"; collapses spaces/punctuation, lowercases. */
  export const slugify = (input: string): string => /* impl */;
  ```
  `slugify` rules: trim, lowercase, replace any run of non-alphanumerics with a single `-`, strip leading/trailing `-`. `"My Profile Page!"` → `"my-profile-page"`.
- `src/util/paths.ts`:
  ```ts
  export const KOTIKIT_DIR = ".kotikit";
  export const configPath = (root: string) => `${root}/.kotikit/config.json`;
  export const indexPath = (root: string) => `${root}/.kotikit/index.json`;
  export const scopeDir = (root: string, scope: string) => `${root}/.kotikit/specs/${scope}`;
  export const screenSpecPath = (root: string, scope: string, screenSlug: string) =>
    `${root}/.kotikit/specs/${scope}/${screenSlug}.spec.json`;
  export const singleSpecPath = (root: string, scope: string) =>
    `${root}/.kotikit/specs/${scope}/spec.json`;
  export const flowManifestPath = (root: string, scope: string) =>
    `${root}/.kotikit/specs/${scope}/flow.json`;
  /** Walk up from cwd to find the nearest dir containing .kotikit, else return cwd. */
  export const findProjectRoot = (start?: string): string => /* impl */;
  ```

**Acceptance criteria**
- `bun test` for a `util/ids.test.ts` proving: `slugify("Checkout Flow") === "checkout-flow"`, `slugify("  A/B  c! ") === "a-b-c"`, `uuid()` matches the v4 regex, `nowIso()` parses back to a Date.
- `findProjectRoot` returns a directory string; given a temp dir with a nested `.kotikit`, returns the dir containing `.kotikit`.

---

### P1-A3 — Zod schemas (config + spec + flow)
**Depends on:** none
**Complexity:** M

**What to build**
- `src/config/schema.ts` — the `ConfigSchema` exactly as in §0. Export `Config` type and a `defaultConfig()` factory that returns a fully-defaulted object (React, `src/components`, tests true, default breakpoints/themes, autoCommit true, empty designSystemFiles).
- `src/spec/schema.ts` — `ScreenSpecSchema`, `FlowManifestSchema`, the `InheritOr` helper, and exported types exactly as in §0.
- Add two factory helpers in `spec/schema.ts`:
  ```ts
  export function newScreenSpec(input: {
    title: string; description: string; flowRef?: string;
  }): ScreenSpec;   // fills id (uuid), version "1.0.0", status "draft", metadata timestamps,
                    // requirements.responsive/themes = "inherits", empty arrays/records as needed
  export function newFlowManifest(input: {
    title: string; description: string;
    screens: { id: string; path: string; title: string }[];
  }): FlowManifest;
  ```
  (These call `util/ids` for `uuid`/`nowIso`.)
- Add a strict parse helper that throws a plain-English error on failure:
  ```ts
  export function parseScreenSpec(raw: unknown): ScreenSpec;   // ScreenSpecSchema.parse w/ friendly message
  export function parseFlowManifest(raw: unknown): FlowManifest;
  export function parseConfig(raw: unknown): Config;           // lives in config/schema.ts
  ```

**Acceptance criteria**
- `bun test schema.test.ts` proves: a valid screen-spec object round-trips through `parseScreenSpec`; an object missing `context.description` throws with a message naming the missing field; `"inherits"` is accepted for `requirements.responsive`; `{ overrides: { breakpoints: [375] } }` is accepted; a string for `breakpoints` is rejected.
- `newScreenSpec({ title: "Cart", description: "x" })` returns an object that passes `ScreenSpecSchema.parse`.
- `defaultConfig()` passes `ConfigSchema.parse`.

---

### P1-A4 — Plain-English result/error helpers (`util/result.ts`)
**Depends on:** none
**Complexity:** S

**What to build**
- `src/util/result.ts`:
  ```ts
  export class KotikitError extends Error {
    constructor(public userMessage: string, public hint?: string) { super(userMessage); }
  }
  /** Build the text payload an MCP tool returns: a one-line summary, then optional detail JSON. */
  export function toolText(summary: string, detail?: unknown): { content: { type: "text"; text: string }[] };
  /** Convert any thrown error into a friendly tool result (never leaks stack traces). */
  export function toolError(err: unknown): { content: { type: "text"; text: string }[]; isError: true };
  ```
- `toolError` rule: if `err instanceof KotikitError`, surface `userMessage` (+ `hint` on a second line). Otherwise emit a generic friendly line (`"Something went wrong while saving your spec. The file was not changed."`) and never the raw stack.

**Acceptance criteria**
- `bun test result.test.ts`: `toolError(new KotikitError("No screen named 'cart'", "Try: shipping, payment"))` produces text containing both the message and the hint, and `isError: true`.
- `toolError(new Error("ENOENT: …"))` produces a generic friendly message and does **not** contain the substring `ENOENT`.
- `toolText("Saved.", { ok: true })` produces a single text block whose text starts with `"Saved."` and contains the pretty-printed JSON.

---

## TIER 1 — Engines (depend on Tier 0)

### P1-B1 — Config engine: load + resolve + init builder
**Depends on:** P1-A2, P1-A3, P1-A4
**Complexity:** M

**What to build**
- `src/config/load.ts`:
  ```ts
  export async function loadConfig(root: string): Promise<Config | null>; // null if no config.json yet
  export async function configExists(root: string): Promise<boolean>;
  export async function writeConfig(root: string, config: Config): Promise<void>; // pretty JSON + newline, creates .kotikit/
  /** Resolve ${ENV_VAR} and op://… in the figma.token field. P1: env expansion only;
      op:// returns the literal string with a TODO note (Phase 2 wires `op read`). */
  export function resolveSecret(value: string | undefined): string | undefined;
  ```
  - `loadConfig` reads the file, JSON-parses, runs `parseConfig` (friendly errors via KotikitError), then resolves the token. If the file is missing, return `null` (not an error).
  - `resolveSecret`: `"${FIGMA_TOKEN}"` → `process.env.FIGMA_TOKEN`. `"op://..."` → return unchanged (Phase 2). Plain string → unchanged.
- `src/config/init.ts`:
  ```ts
  export interface InitAnswers {
    framework?: "react";
    codeComponentsDir?: string;
    tests?: boolean;
    autoCommit?: boolean;
    figmaFiles?: { key: string; name: string }[];
  }
  /** Merge wizard answers over defaultConfig(); returns a validated Config. */
  export function buildConfig(answers: InitAnswers): Config;
  ```
  - Every answer is optional; missing answers fall back to `defaultConfig()` values. This is what lets the init *conversation* skip questions the designer doesn't care about.

**Acceptance criteria**
- `bun test config.test.ts` (using a temp dir): `writeConfig` then `loadConfig` round-trips; `loadConfig` on an empty dir returns `null`; a malformed `config.json` throws a `KotikitError` with a plain-English message.
- `buildConfig({})` equals `defaultConfig()`. `buildConfig({ tests: false, codeComponentsDir: "app/ui" })` overrides only those two fields and keeps defaults elsewhere.
- `resolveSecret("${FIGMA_TOKEN}")` with `FIGMA_TOKEN=abc` set returns `"abc"`.

---

### P1-B2 — Spec engine + tiny index store
**Depends on:** P1-A2, P1-A3, P1-A4
**Complexity:** M

**What to build**
- `src/spec/index-store.ts`:
  ```ts
  export interface IndexEntry {
    scope: string;           // folder name
    title: string;
    kind: "screen" | "flow";
    status: "draft" | "active";
    screens: string[];       // screen slugs; single-screen scope -> ["<scope>"] or the lone screen slug
    updatedAt: string;
  }
  export async function readIndex(root: string): Promise<IndexEntry[]>;      // [] if missing
  export async function upsertIndexEntry(root: string, entry: IndexEntry): Promise<void>;
  export async function removeIndexEntry(root: string, scope: string): Promise<void>;
  ```
  - `index.json` is the only "load everything" file; keep it tiny. Pretty JSON + newline.
- `src/spec/engine.ts`:
  ```ts
  export async function writeScreenSpec(root: string, scope: string, screenSlug: string | null, spec: ScreenSpec): Promise<string>;
  // screenSlug=null => single-screen scope -> writes spec.json; otherwise <screenSlug>.spec.json. Returns the path written. Creates dirs.
  export async function readScreenSpec(root: string, scope: string, screenSlug: string | null): Promise<ScreenSpec>;
  export async function writeFlowManifest(root: string, scope: string, manifest: FlowManifest): Promise<string>;
  export async function readFlowManifest(root: string, scope: string): Promise<FlowManifest>;
  export async function listScopes(root: string): Promise<IndexEntry[]>;     // delegates to readIndex
  export async function scopeExists(root: string, scope: string): Promise<boolean>;
  ```
  - All reads validate through the Zod parse helpers (P1-A3). Missing files throw `KotikitError` with friendly text.
  - Writers do **not** commit to git (that is P1-B3, called by the tools). Writers **do** call `upsertIndexEntry`.

**Acceptance criteria**
- `bun test spec-engine.test.ts` (temp dir):
  - Write a single-screen spec → `spec.json` exists at `specs/profile-page/spec.json`, re-read parses equal.
  - Write a flow manifest + two screen specs → files exist at expected paths, re-read parses equal.
  - After writes, `readIndex` returns entries with correct `kind`, `status`, `screens`.
  - `readScreenSpec` on a missing scope throws a `KotikitError` whose message names the scope in plain English.

---

### P1-B3 — Git auto-commit engine
**Depends on:** P1-A2, P1-A4
**Complexity:** M

**What to build**
- `src/git/auto-commit.ts` using `simple-git`:
  ```ts
  export type CommitKind = "create" | "update";
  export interface CommitResult { committed: boolean; reason?: string; sha?: string; message: string; }
  /** Stage the given file paths and create a local conventional commit. Never pushes, never branches. */
  export async function autoCommitSpec(opts: {
    root: string;
    scope: string;
    kind: CommitKind;
    files: string[];           // absolute or root-relative paths to stage
    enabled: boolean;          // config.git.autoCommit
  }): Promise<CommitResult>;
  export async function isGitRepo(root: string): Promise<boolean>;
  export async function gitInit(root: string): Promise<void>;   // local init, no remote
  ```
  - Commit message format:
    - `feat(spec): create <scope>` or `feat(spec): update <scope>`
    - blank line, then footer line: `Co-authored-by: Claude Code <noreply@anthropic.com>`
  - Behavior matrix:
    - `enabled === false` → `{ committed: false, reason: "autoCommit is off", message }` (no git calls).
    - not a git repo → `{ committed: false, reason: "not a git repo" }`. (The *tool* decides whether to offer `gitInit`; the engine just reports.)
    - nothing to commit (no diff) → `{ committed: false, reason: "no changes" }`.
    - success → `{ committed: true, sha, message }`.
  - Only stage the explicit `files` passed in — never `git add -A`.

**Acceptance criteria**
- `bun test git.test.ts` (temp dir, `git init` inside it, set a throwaway `user.email`/`user.name` via local config in the test setup only):
  - Writing a file + `autoCommitSpec({kind:"create", enabled:true})` produces a commit whose subject is exactly `feat(spec): create <scope>` and whose body contains the `Co-authored-by` footer.
  - Second edit + `kind:"update"` produces `feat(spec): update <scope>`.
  - `enabled:false` returns `committed:false` and creates no commit (`git log` count unchanged).
  - Running in a non-repo temp dir returns `committed:false, reason:"not a git repo"` without throwing.
- No branch is ever created; `git branch` count stays at 1.

---

## TIER 2 — Domain logic & server skeleton (depend on Tier 1)

### P1-C1 — Flow decomposition helpers
**Depends on:** P1-A3, P1-B2
**Complexity:** S

**What to build**
- `src/spec/decompose.ts`:
  ```ts
  export interface ScreenDraft {
    slug: string;          // slugified screen id, e.g. "cart"
    title: string;         // "Cart"
    description: string;
    functional: string[];
    states: Record<string, string>;
    components?: { name: string; dsKey?: string; usage?: string }[];
    acceptanceCriteria?: string[];
    userTypes?: string[];
    entryPoints?: string[];
  }
  export interface FlowDraft {
    scope: string;         // slugified flow name, e.g. "checkout-flow"
    title: string;
    description: string;
    screens: ScreenDraft[];
    transitions: { from: string; to: string; trigger: string }[];
    sharedState: string[];
  }
  export interface SingleDraft {
    scope: string;         // slugified screen name, e.g. "profile-page"
    screen: ScreenDraft;
  }
  /** True if the draft has >1 screen. The brainstorm agent supplies the draft; this just classifies + builds files. */
  export function isMultiScreen(d: FlowDraft | SingleDraft): d is FlowDraft;
  /** Turn a FlowDraft into a manifest + N specs ready to write (does NOT write). */
  export function materializeFlow(draft: FlowDraft): {
    manifest: FlowManifest;
    specs: { screenSlug: string; spec: ScreenSpec }[];
  };
  /** Turn a SingleDraft into one ScreenSpec ready to write (does NOT write). */
  export function materializeSingle(draft: SingleDraft): { spec: ScreenSpec };
  ```
  - `materializeFlow` sets each screen spec's `flowRef = "<scope>/flow.json"`, builds the manifest `screens[]` from the drafts (path = `<slug>.spec.json`), and fills metadata via factories from P1-A3.
  - `materializeSingle` produces a spec with **no** `flowRef`.
  - These functions are pure (no disk, no git) so they are trivially unit-testable. The *tool* (P1-D2) writes + commits.

**Acceptance criteria**
- `bun test decompose.test.ts`:
  - `materializeFlow` with 3 screen drafts returns a manifest with 3 `screens` entries (correct paths/titles) and 3 specs each carrying `flowRef`.
  - Each produced spec passes `ScreenSpecSchema.parse`; the manifest passes `FlowManifestSchema.parse`.
  - `materializeSingle` returns a spec with `flowRef === undefined`.
  - `isMultiScreen` correctly classifies both draft shapes.

---

### P1-C2 — Spec CRUD MCP tool
**Depends on:** P1-B2, P1-B3, P1-C1, P1-A4
**Complexity:** M

**What to build**
- `src/mcp/tools/spec.ts` — register four tools. Each takes a Zod-validated input, does the work, and returns `toolText(...)` / `toolError(...)`. Signatures (input shapes):
  - `kotikit_spec_create`
    - input: `{ scope?: string; title: string; draft: SingleDraft | FlowDraft }` (the brainstorm tool produces `draft`; `scope` optional override).
    - Detect single vs multi via `isMultiScreen`. For single: `materializeSingle` → `writeScreenSpec(root, scope, null, spec)`. For multi: `materializeFlow` → `writeFlowManifest` + each `writeScreenSpec(root, scope, slug, spec)`. Then `autoCommitSpec({ kind: "create", files: [...all written paths...], enabled: config.git.autoCommit })`.
    - Returns a plain-English summary: e.g. `"Created the checkout-flow flow with 5 screens and committed it (feat(spec): create checkout-flow)."`
  - `kotikit_spec_get` — input `{ scope: string; screen?: string }`; reads single or one screen of a flow; friendly error listing available screens if not found.
  - `kotikit_spec_list` — input `{}`; returns `readIndex` entries formatted as a readable list (title, kind, status, screen count) — never reads spec bodies.
  - `kotikit_spec_update` — input `{ scope: string; screen?: string; patch: Partial<ScreenSpec> }`; read → deep-merge patch → bump `metadata.updatedAt` → validate → write → `autoCommitSpec({ kind: "update" })`. Reject patches that would change `id` or `type` (friendly error).
- Export a `registerSpecTools(server, ctx)` function where `ctx` carries `{ root, loadConfig }` so the server (P1-C3) can inject the project root + config.

**Acceptance criteria**
- `bun test spec-tool.test.ts` (temp git repo): calling the create handler with a multi-screen draft writes manifest + N specs, updates `index.json`, and produces one git commit `feat(spec): create <scope>`.
- `spec_update` changes a field, re-read reflects it, `updatedAt` advanced, and a `feat(spec): update <scope>` commit exists.
- `spec_get` on a nonexistent screen returns an error result whose text lists the real screen names.
- `spec_list` returns text mentioning each scope's title and status, and reads only `index.json` (assert by spying that no `*.spec.json` is read — or simply that result is correct without bodies).

---

### P1-C3 — MCP server skeleton
**Depends on:** P1-A1, P1-A4 (and registers tools from C2/D1/D2/D3 once they exist — see note)
**Complexity:** M

**What to build**
- `src/mcp/server.ts`:
  - Create an MCP `Server` from `@modelcontextprotocol/sdk` with name `"kotikit"`, version from package.json, capabilities `{ tools: {} }`.
  - Build a `ctx` object: `{ root: findProjectRoot(), loadConfig: () => loadConfig(root) }`.
  - Wire **stdio transport** (`StdioServerTransport`) and `server.connect(transport)`.
  - Call `register*Tools(server, ctx)` for each tool module. Until D1/D2/D3 land, this file should compile with whatever modules exist; structure it so adding a new `registerXTools` call is one line.
  - Top-level: print nothing to stdout (stdout is the MCP channel). Log to stderr only.
  - Add a `#!/usr/bin/env bun` shebang (matches the `bin` entry in P1-A1) and ensure it is executable.
- Define and export the shared `ToolContext` type in `src/mcp/context.ts`:
  ```ts
  export interface ToolContext {
    root: string;
    loadConfig: () => Promise<Config | null>;
  }
  ```

**Acceptance criteria**
- `bun run src/mcp/server.ts` starts without crashing and waits on stdio (does not exit immediately, prints nothing to stdout).
- An MCP `tools/list` request over stdio returns the registered tool names (test with a tiny script using the SDK client, or assert via the SDK's in-memory transport in `bun test server.test.ts`).
- `bun run typecheck` passes for the whole `src/` tree.

> **Note for the executor:** C3 can be built against stubbed tool registrars first (so the server compiles), then the real registrars from D1/D2/D3 are dropped in. Keep `registerXTools` calls additive.

---

## TIER 3 — Tools wired to engines (depend on Tier 2)

### P1-D1 — Config MCP tool (status / init / get)
**Depends on:** P1-B1, P1-C3
**Complexity:** M

**What to build**
- `src/mcp/tools/config.ts` — `registerConfigTools(server, ctx)` exposing:
  - `kotikit_config_status` — input `{}`; returns `{ initialized: boolean; isGitRepo: boolean; missing: string[] }` plus a plain-English summary. `missing` lists gentle gaps (e.g. `"no Figma design system connected yet (optional)"`). This is what `/kotikit:auto` calls first.
  - `kotikit_config_init` — input is the `InitAnswers` shape from P1-B1 (all optional). Calls `buildConfig(answers)` → `writeConfig`. If the project is not a git repo and `autoCommit` is true, **do not** auto-init here; report it in the summary so the front door can ask. Returns a friendly `"You're all set. What do you want to build?"` style summary.
  - `kotikit_config_get` — input `{}`; returns the resolved config (secrets resolved via `resolveSecret`, but **never echo the resolved token value** — show `"<resolved from env>"` instead). Friendly error if not initialized: `"Kotikit isn't set up in this project yet. Say the word and I'll set it up."`.

**Acceptance criteria**
- `bun test config-tool.test.ts` (temp dir): `config_status` before init returns `initialized:false`; after `config_init({})` returns `initialized:true`.
- `config_init({ tests:false })` writes a config with `project.tests===false`, everything else default.
- `config_get` never includes the literal token string in its output even when `FIGMA_TOKEN` is set.

---

### P1-D2 — Flow MCP tool
**Depends on:** P1-B2, P1-B3, P1-C1, P1-C3
**Complexity:** S

**What to build**
- `src/mcp/tools/flow.ts` — `registerFlowTools(server, ctx)` exposing:
  - `kotikit_flow_create` — input `{ draft: FlowDraft }`. Materialize via `materializeFlow`, write manifest + all screen specs, update index (each screen + a flow entry), then a single `autoCommitSpec({ kind: "create", files: [manifest + all specs] })`. One commit for the whole flow, not one per screen.
  - Returns: `"Created the <title> flow: <n> screens (cart, shipping, …) saved and committed."` plus the manifest path.
- Note: `kotikit_spec_create` (P1-C2) already handles the case where a draft turns out to be multi-screen; `flow_create` exists as an explicit entry point the brainstorm agent can call when it *knows* it built a flow. Both must converge on identical on-disk output. Factor the shared write+commit into a helper in `spec/engine.ts` or a small `mcp/tools/_write.ts` so they don't diverge.

**Acceptance criteria**
- `bun test flow-tool.test.ts` (temp git repo): `flow_create` with a 5-screen draft writes `flow.json` + 5 `*.spec.json`, makes exactly **one** commit, and the manifest's `screens[].path` values match the written files.
- The result of `flow_create({draft})` is byte-identical on disk to `spec_create({draft})` with the same multi-screen draft (assert by diffing the two output dirs in the test).

---

### P1-D3 — Brainstorm MCP tool (the quality engine)
**Depends on:** P1-A3, P1-C3
**Complexity:** L

**What to build**

This tool is mostly **a system prompt + a small state machine**, not heavy code. The actual questioning is done by Claude in the conversation; the tool's job is to (a) hand Claude the rigorous questioning *strategy*, (b) track which dimensions have been covered, and (c) emit a validated `draft` (`SingleDraft | FlowDraft`) when coverage is complete.

- `src/mcp/tools/brainstorm.ts` — `registerBrainstormTools(server, ctx)` exposing:
  - `kotikit_brainstorm_start` — input `{ idea: string }` (the designer's plain-language description). Returns:
    - A classification guess: `singleScreen` vs `multiScreen` (heuristic: mentions of "flow", "steps", "then", multiple named pages → multi).
    - The **coverage checklist** the agent must satisfy before writing a spec (see below).
    - The **first batch of plain-language questions** to ask, tailored to the idea.
    - The literal quality bar string to keep in mind.
  - `kotikit_brainstorm_assess` — input `{ scope: string; coverage: Record<DimensionKey, "covered" | "open"> ; notes?: string }`. Returns either "keep going, here are the still-open dimensions and suggested questions" or "you're ready — call spec_create/flow_create with this draft shape" plus the exact draft template to fill.
  - Export a `BRAINSTORM_SYSTEM_PROMPT` constant (used in CLAUDE.md / tool description) containing the §4.2 doctrine.
- **Coverage dimensions** (`DimensionKey`): `states`, `visualEdgeCases`, `accessibility`, `interactions`, `dataContracts`, `responsive`, and (multi-screen only) `flowConnectivity`. A spec may not be written while any required dimension is `open`.
- **System-prompt doctrine** (bake this into `BRAINSTORM_SYSTEM_PROMPT`):
  - "You are a meticulous, friendly design lead, not a form. Never ask the designer about JSON, schemas, pixel breakpoints, or git. Ask about the *experience*."
  - "Do NOT stop at 3–5 questions. Keep hunting for ambiguity and pitfalls until you can honestly say: *any developer or designer could build this identically from the spec alone.* That sentence is the bar."
  - Enumerate the dimensions and give 1–2 example plain-language questions each (e.g. accessibility → "If someone is using only a keyboard, what's the path through this screen? What should be focused first?").
  - For multi-screen ideas: "Map the whole flow first — entry points, the order of screens, what carries between them — then drill into each screen."
  - "When done, summarize the screen(s) back to the designer in plain English and ask for confirmation before saving."
- The tool returns plain language and a fillable draft template; it does **not** itself converse turn-by-turn (Claude does that). Keep the code thin and the prompt rich.

**Acceptance criteria**
- `bun test brainstorm.test.ts`: `brainstorm_start({ idea: "a checkout flow with cart, shipping, payment" })` classifies as `multiScreen` and returns a coverage checklist that includes `flowConnectivity`.
- `brainstorm_start({ idea: "a profile page" })` classifies as `singleScreen` and the checklist omits `flowConnectivity`.
- `brainstorm_assess` with all required dimensions `covered` returns a "ready to save" result containing a draft template; with one `open` it returns a "keep going" result naming the open dimension.
- `BRAINSTORM_SYSTEM_PROMPT` contains the literal bar sentence "any developer or designer could build this identically from the spec alone".

---

## TIER 4 — The front door (depends on Tier 3)

### P1-E1 — `/kotikit:auto` slash command (CLAUDE.md)
**Depends on:** P1-D1, P1-D2, P1-D3, P1-C2
**Complexity:** M

**What to build**

This is **prose + orchestration instructions** in `CLAUDE.md`, not TypeScript. It tells Claude how to behave when the designer types `/kotikit:auto`. It is the single, sole documented command.

- Add a `CLAUDE.md` at repo root (and ensure the plugin/MCP config references it). Include a section: `## /kotikit:auto — the only command you need`.
- The command's orchestration script (write this as numbered instructions Claude follows):
  1. **Init check.** Call `kotikit_config_status`. If `initialized: false`, run the **init conversation** (NOT flags): ask, in plain language and one at a time, only the questions that matter — framework (default React, usually skip), where components live, "should I generate tests for you?", "should I keep a clean history of your specs automatically?" (git autoCommit), "do you have a Figma design system to connect? (we can do this later)". Then call `kotikit_config_init` with the gathered `InitAnswers`. If not a git repo and autoCommit is on, ask "I keep a tidy history of your work using git — want me to set that up here? (it stays on your machine)"; if yes, the front door triggers a local init (via a follow-up the config tool reports), else proceed write-only and say so.
  2. **Ask what to build.** "What do you want to build?"
  3. **Brainstorm.** Call `kotikit_brainstorm_start` with the idea. Follow `BRAINSTORM_SYSTEM_PROMPT`: ask deep, plain-language questions, batch by dimension, never stop early. Periodically self-check coverage via `kotikit_brainstorm_assess`. Do not proceed until every required dimension is covered and you can say the bar sentence honestly.
  4. **Confirm.** Summarize the screen(s) back in plain English (for a flow: the screen list + how they connect). Ask the designer to confirm or adjust.
  5. **Create + commit.** Call `kotikit_spec_create` (single) or `kotikit_flow_create` (multi) with the draft. The tool writes files AND auto-commits. Report what was saved and the commit message, in one friendly sentence.
  6. **"What next?" menu** — ALWAYS end here. Present a short menu in plain language:
     `What next?  ·  Add another screen  ·  Edit a screen  ·  List everything I've specced  ·  I'm done for now`
     Route each choice back into the appropriate tool (`spec_update`, `spec_list`, restart brainstorm, or end gracefully).
- **UX rules to state explicitly in CLAUDE.md** (these are load-bearing):
  - Never show the designer JSON unless they ask.
  - Never mention tool names, schemas, or git commands unprompted; speak in design terms.
  - Every error shown to the designer must be the tool's plain-English message.
  - The "What next?" prompt appears after every major action — the designer is never dropped into a blank prompt.

**Acceptance criteria**
- `CLAUDE.md` exists and documents `/kotikit:auto` as the sole front door, with the 6-step orchestration and the UX rules above.
- A human reading only CLAUDE.md can follow the init → brainstorm → confirm → create → "what next?" loop without referencing this plan.
- It explicitly instructs the agent to never surface JSON/git/schema jargon and to always end on the "What next?" menu.

---

## TIER 5 — End-to-end smoke test (depends on everything)

### P1-F1 — End-to-end smoke test
**Depends on:** P1-E1 (and transitively all)
**Complexity:** M

**What to build**
- `test/e2e/phase1.test.ts` — drive the MCP server in-process (SDK in-memory transport or a spawned stdio client) against a **temp project dir** that is a fresh git repo. Simulate the `/kotikit:auto` happy path by calling the tools in the order the front door would:
  1. `kotikit_config_status` → `initialized:false`.
  2. `kotikit_config_init({ tests: true, autoCommit: true })` → config written.
  3. `kotikit_brainstorm_start({ idea: "checkout flow: cart, shipping, payment, review, confirmation" })` → `multiScreen`, checklist includes `flowConnectivity`.
  4. Build a `FlowDraft` (5 screens, transitions, sharedState) — the test supplies this directly, standing in for the brainstorm conversation.
  5. `kotikit_flow_create({ draft })`.
  6. Assert on disk:
     - `.kotikit/config.json` valid against `ConfigSchema`.
     - `.kotikit/specs/checkout-flow/flow.json` valid against `FlowManifestSchema` with 5 screens.
     - 5 `*.spec.json` files, each valid against `ScreenSpecSchema`, each with `flowRef === "checkout-flow/flow.json"`.
     - `.kotikit/index.json` lists the flow.
  7. Assert git: exactly one commit since init-of-specs with subject `feat(spec): create checkout-flow` and a `Co-authored-by: Claude Code <noreply@anthropic.com>` footer; no extra branches; no remote/push.
  8. Then `kotikit_spec_update({ scope:"checkout-flow", screen:"cart", patch:{ title:"Shopping Cart" } })` → file updated, `updatedAt` advanced, new commit `feat(spec): update checkout-flow`.
  9. `kotikit_spec_list({})` → text mentions the flow and its status.
- Add a single-screen variant in the same file: `idea: "a profile page"` → `singleScreen`, produces `.kotikit/specs/profile-page/spec.json` with no `flowRef`, one create commit.

**Acceptance criteria**
- `bun test test/e2e/phase1.test.ts` passes end to end.
- The test proves the Phase 1 deliverable verbatim: a plain-language idea becomes a complete, schema-valid, git-committed set of spec files with zero manual file editing and zero design/codegen.
- `bun run typecheck` passes for the whole repo.

---

## 2. Definition of Done for Phase 1

- [ ] `bun install`, `bun run typecheck`, and `bun test` all pass.
- [ ] `bun run src/mcp/server.ts` runs as an MCP server over stdio; `tools/list` returns all Phase 1 tools.
- [ ] A designer (or the E2E test acting as one) can: type the idea → answer plain-language questions → get a folder of valid, readable spec JSON → see it auto-committed with a conventional message → be offered "What next?".
- [ ] One spec = one screen is enforced everywhere; flows are folders with a manifest.
- [ ] Specs inherit breakpoints/themes from config; overrides work.
- [ ] Git is local-only: no push, no branch creation; opt-out via `autoCommit:false` honored.
- [ ] No JSON/schema/git jargon leaks into any user-facing message; all errors are plain English.
- [ ] No Figma, no SQLite, no codegen exists yet (correctly out of scope).

## 3. Parallelization summary (for a swarm of agents)

- **Wave 1 (4 agents):** A1, A2, A3, A4 — fully independent.
- **Wave 2 (3 agents):** B1, B2, B3 — after Wave 1.
- **Wave 3 (3 agents):** C1, C2, C3 — C3 can start against stubs in parallel with C1/C2 and integrate their registrars.
- **Wave 4 (3 agents):** D1, D2, D3 — after their respective engines/server land.
- **Wave 5 (1 agent):** E1 — CLAUDE.md orchestration.
- **Wave 6 (1 agent):** F1 — the proof.

Each task is sized for **one agent in 30–60 minutes** (senior dev: 2–4 hours). The two largest (D3 brainstorm, F1 e2e) are L; everything else is S/M.
