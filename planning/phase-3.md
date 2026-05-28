# Kotikit — Phase 3 Implementation Plan

> **Phase 3 deliverable:** *A designer says "build this screen in React" inside `/kotikit:auto` and ends up with a production-grade React component on disk — TypeScript strict, jsx-a11y clean, prettier formatted, with passing Vitest unit tests — auto-committed with a conventional-commits message. The spec moves from `draft → active` when implementation passes the gates.*
>
> Build on top of Phase 1 (mutable specs, auto-commit) and Phase 2 (design-system search). No Figma plugin, no scaffolding multi-component sweeps, no Playwright integration runs, no Chrome DevTools validation. Just **spec → planned steps → generated component → static gates → commit**, behind the same `/kotikit:auto` front door.

This document is self-contained. A senior engineer or AI agent with **Phase 1 + Phase 2 context only** should be able to read it and build the right thing. Read §0 before picking up any task.

---

## 0. Orientation — what you are building (read this first)

### Architectural decisions that are non-negotiable

These were settled in advance. Do **not** re-litigate them.

1. **MVP cut: static gates + unit tests only.** Phase 3 ships `tsc --noEmit`, `eslint` (with `jsx-a11y`), `prettier --check`, and `vitest run`. **Playwright integration tests and Chrome DevTools MCP validation defer to Phase 6** — they need runtime infrastructure (dev server, browser) that Phase 3 has no reason to introduce.

2. **Three-tool split for code generation.** Kotikit owns deterministic work (file I/O, validation, gating, commits, registry upserts). Claude in the conversation owns code writing. Three tools:
   - `kotikit_implement_code_start` — returns the context bundle Claude needs (spec, DS component JSONs, adapter system prompt, target file paths, registry hits, config knobs).
   - `kotikit_implement_code_save` — writes the proposed files, runs the gates, commits + updates spec + upserts registry on success.
   - `kotikit_implement_code_gate` — re-runs the gates on files already on disk and returns structured errors. Used after Claude edits a file in place to fix a gate failure (so Claude doesn't have to re-send the whole payload).

   A separate `kotikit_plan_code` tool produces the ephemeral `<screen>.code.plan.json` upstream.

3. **One screen at a time.** Cross-screen wiring (router setup, shared context providers, data hooks for state across the flow) is out of scope. The planner *reads* the `flow.json` `sharedState` and `transitions` fields into the per-screen system prompt as constraints ("this screen reads `cartItems` from a context named CartContext; assume it exists"), but it does not generate that shared infrastructure.

4. **Registry stub.** Phase 3 introduces a minimal `registry.db` (one table: `name TEXT PRIMARY KEY, code_path TEXT, status TEXT`) so `implement_code_start` can search "does a code component for `Button` already exist?" and `implement_code_save` can upsert the screen as `code-only`. The full bidirectional registry with `ds_path` and scaffolding lands in Phase 4.

5. **File structure: flat with colocated test.** Generated outputs:
   ```
   <codeComponentsDir>/<scope>/<PascalCaseName>.tsx
   <codeComponentsDir>/<scope>/<PascalCaseName>.test.tsx
   ```
   For a single-screen scope like `profile-page`, the output is `<codeComponentsDir>/profile-page/ProfilePage.tsx` (the scope's PascalCase). For a flow screen `checkout-flow/cart`, the output is `<codeComponentsDir>/checkout-flow/Cart.tsx`. No `index.tsx` barrels, no folder-per-screen.

6. **Pre-flight or fail.** Missing tools in the user's project (no `tsc`, no `eslint`, etc.) → fail loudly **before** Claude generates any code. `kotikit_config_status` is extended with a `gates` field listing the resolved/missing gates. `kotikit_implement_code_start` refuses to begin if any required gate is missing. **Never auto-install. Never skip-and-warn.**

7. **Vitest as the default unit framework.** Configurable via a new `project.testFramework: "vitest" | "none"` (default `"vitest"`). When `"none"`, no test file is generated and the vitest gate is skipped. Playwright and other runners are not in scope.

8. **Adapter interface is the framework boundary.** All React-specific knowledge lives behind `src/codegen/adapter.ts`. A future Vue or Svelte adapter implements the same interface without touching the planner, the gate runner, or the MCP tools. The adapter owns: name, system prompt, import statement formatting, file name conventions, test scaffold, quality-gate command list, environment verifier, and gate-output parser. Routing, state, and data fetching are NOT in the adapter — they appear as adapter prompt fragments, surfaceable via `project.conventions` config keys later.

### The §7 quality baseline (carried into every generation)

Every generated React component must satisfy these by construction (the adapter's `systemPrompt()` carries them as hard constraints):

- TypeScript strict — no `any`, no `@ts-ignore`, explicit prop types.
- Semantic HTML first; ARIA only where semantics fall short.
- Full keyboard navigation; correct focus order; focus management for overlays.
- Labelled inputs; `aria-live` for async feedback; reduced-motion respected.
- WCAG-AA contrast.
- Responsive — honors `config.defaults.breakpoints` (or per-spec `overrides`).
- Error boundary on every page-level component.
- No `console.log`; no commented-out debug code.
- Tests generated from `spec.acceptanceCriteria` when `project.tests === true` AND `project.testFramework !== "none"`.

The gates enforce the parts that can be statically checked. The adapter system prompt + spec + DS JSONs carry the rest as instructions.

### Folder layout produced by Phase 3

Inside the user's project:

```
<codeComponentsDir>/                 # default src/components
  checkout-flow/
    Cart.tsx
    Cart.test.tsx
    Shipping.tsx
    Shipping.test.tsx
    ...
  profile-page/
    ProfilePage.tsx
    ProfilePage.test.tsx
```

Inside kotikit's `.kotikit/` (next to existing specs):

```
.kotikit/
  specs/
    checkout-flow/
      flow.json
      cart.spec.json
      cart.code.plan.json              # ephemeral, regenerable
      shipping.spec.json
      shipping.code.plan.json
      ...
  registry.db                          # minimal: name → code_path → status
```

The plan file lives next to the spec and is regenerable; nothing prevents the designer from deleting it.

### Source layout you will create

```
src/
  mcp/
    tools/
      plan-code.ts             # kotikit_plan_code
      implement-code.ts        # kotikit_implement_code_start, _save, _gate
      registry.ts              # kotikit_registry_search
  planning/
    code-plan-schema.ts        # Zod schema + types
    code-planner.ts            # spec → CodePlan
    plan-store.ts              # read/write <screen>.code.plan.json
  codegen/
    adapter.ts                 # framework-agnostic interface
    react/
      adapter.ts               # the React+shadcn adapter implementation
      system-prompt.ts         # the quality-bar-encoded prompt (carries §7 verbatim)
      test-scaffold.ts         # Vitest test template
    gate-runner.ts             # spawns tsc/eslint/prettier/vitest, parses output
    gate-output.ts             # framework-neutral gate result types
    environment.ts             # detect installed gate binaries in the user's project
  db/
    registry-db.ts             # minimal one-table SQLite for Phase 3
  git/
    auto-commit.ts             # extend to support feat(code): ... subjects
  util/
    paths.ts                   # extend with code-target + plan + registry helpers
  config/
    schema.ts                  # add project.testFramework
```

### Conventions every task must follow

- **Language/runtime:** TypeScript, Bun. No CommonJS.
- **Validation:** every external/persisted shape goes through Zod.
- **Errors:** all user-facing errors are plain English via `KotikitError`. Gate failures are surfaced verbatim (the user can read tsc/eslint output) but each gate-failure response also carries a one-line "what to do" line.
- **All shell-outs go through `Bun.spawn`.** Resolve binaries by probing the project's local `node_modules/.bin/` first, then falling back to `bunx --no-install` (which fails fast rather than auto-fetching). Never silently install anything in the user's project.
- **All gate commands run in the user's project directory** (`cwd: config.project.root || ctx.root`). Never in kotikit's directory.
- **Code commits use a new conventional-commits scope `code`:**
  - First create: `feat(code): create <scope>/<screen>`
  - Subsequent edits: `feat(code): update <scope>/<screen>`
  - Footer: `Co-authored-by: Claude Code <noreply@anthropic.com>` (unchanged).

### Shared types (canonical)

```ts
// src/planning/code-plan-schema.ts
export const CodePlanStepSchema = z.object({
  kind: z.enum([
    "scaffold-component",      // create the screen-level component
    "compose-states",          // add loading/empty/error/filled state branches
    "compose-interactions",    // wire event handlers, validation
    "compose-accessibility",   // explicit a11y attrs / focus management
    "compose-responsive",      // breakpoint behavior
    "generate-test",           // emit the *.test.tsx
  ]),
  title: z.string(),
  notes: z.array(z.string()).default([]),
});

export const CodePlanSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),       // omitted for single-screen scopes
  componentName: z.string(),           // PascalCase
  targetPath: z.string(),              // relative to project root
  testPath: z.string().optional(),     // omitted when tests off
  dsComponentRefs: z.array(z.object({  // refs from spec.components
    name: z.string(),
    dsKey: z.string().optional(),
  })).default([]),
  steps: z.array(CodePlanStepSchema).min(1),
  createdAt: z.string(),
});
export type CodePlan = z.infer<typeof CodePlanSchema>;
```

```ts
// src/codegen/gate-output.ts
export interface GateResult {
  gate: "tsc" | "eslint" | "prettier" | "vitest";
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** Parsed structured failures (file path + line + column + message). */
  failures: { file: string; line?: number; column?: number; rule?: string; message: string }[];
  /** Raw stderr/stdout for the user to read verbatim if the parser missed something. */
  raw: string;
}
```

```ts
// src/codegen/adapter.ts — the framework boundary
export interface AdapterContext {
  root: string;                                          // user's project root
  config: Config;                                        // resolved kotikit config
  spec: ScreenSpec;                                      // the screen being built
  flowManifest?: FlowManifest;                           // optional flow context
  dsComponents: Record<string, ComponentJson>;           // keyed by spec.components[].name
}

export interface Adapter {
  name: string;                                          // "react"

  /** The full quality-bar-encoded system prompt for code generation. */
  systemPrompt(ctx: AdapterContext): string;

  /** "import { Button } from '@/components/ui/button';" */
  importStatement(componentName: string, dsKey?: string): string;

  /** ("Cart", "component") → "Cart.tsx" ; ("Cart", "test") → "Cart.test.tsx" */
  fileNameFor(componentName: string, kind: "component" | "test"): string;

  /** Vitest test scaffold for a screen. Returns the .test.tsx contents. */
  testScaffold(ctx: AdapterContext): string;

  /** The ordered gate commands to run. Each spawns one process. */
  qualityGates(ctx: AdapterContext): GateCommand[];

  /** Probe the user's project for required binaries before generation starts. */
  verifyEnvironment(root: string, testFramework: "vitest" | "none"):
    Promise<{ ok: true } | { ok: false; missing: string[] }>;

  /** Parse a gate's raw stderr/stdout into structured failures. */
  transformGateOutput(gate: "tsc" | "eslint" | "prettier" | "vitest", raw: string):
    { failures: GateResult["failures"] };
}

export interface GateCommand {
  gate: "tsc" | "eslint" | "prettier" | "vitest";
  cmd: string[];                                         // ["bunx", "tsc", "--noEmit"]
  /** Files to pass as positional args, when applicable. */
  filesArg?: string[];
  required: boolean;                                     // false for vitest when tests off
}
```

```ts
// src/db/registry-db.ts (minimal)
export interface RegistryRow {
  name: string;
  codePath: string;                       // relative to project root
  status: "code-only" | "design-only" | "synced";
}
```

### Config schema extension

`src/config/schema.ts` gains:

```ts
project: z.object({
  framework: z.enum(["react"]).default("react"),
  codeComponentsDir: z.string().default("src/components"),
  tests: z.boolean().default(true),
  testFramework: z.enum(["vitest", "none"]).default("vitest"),    // NEW
}),
```

Adding it default-on means existing configs continue to validate (Zod will fill the default).

### Path helpers added to `src/util/paths.ts`

```ts
export const codePlanPath = (root: string, scope: string, screenSlug: string | null): string;
export const registryDbPath = (root: string): string;
// Code targets are inside the user's project, not .kotikit/, but we still centralize:
export const codeComponentDir = (root: string, codeComponentsDir: string, scope: string): string;
export const codeComponentFile = (root: string, codeComponentsDir: string, scope: string, fileName: string): string;
```

---

## 1. Dependency tiers (the build order)

Tasks in the same tier have **no dependencies on each other** and can be executed in parallel. Each task ends with **one atomic git commit** in conventional-commits format (`feat(<scope>): <summary>` / `chore(...)` / `docs(...)` / `test(...)`), with the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

| Tier | Tasks | Theme |
|---|---|---|
| **Tier 0** | P3-A1, P3-A2, P3-A3, P3-A4, P3-A5 | Foundations: config field, path helpers, adapter interface, registry stub, gate-output types |
| **Tier 1** | P3-B1, P3-B2, P3-B3, P3-B4, P3-B5 | Engines: React adapter, code planner, plan store, code commit subject, environment verifier |
| **Tier 2** | P3-C1, P3-C2, P3-C3 | Gate runner, code commit extension, gate-result parser |
| **Tier 3** | P3-D1, P3-D2, P3-D3, P3-D4, P3-D5 | MCP tools: plan_code, implement_code_start, _save, _gate, registry_search |
| **Tier 4** | P3-E1 | Extend `kotikit_config_status` with the `gates` field |
| **Tier 5** | P3-F1, P3-F2 | Wire into server + end-to-end smoke test |

Dependency graph:

```
A1 (config)        ─┐
A2 (paths)         ─┼─► (B1 React adapter, B2 planner, B3 store, B5 verifier)  ─┐
A3 (adapter iface) ─┤                                                            ├─► (D1 plan_code,
A4 (registry stub) ─┤                                                            │    D2 implement_start,
A5 (gate-output)   ─┘                                                            │    D3 implement_save,
                                                                                 │    D4 implement_gate,
                    ┌─► (C1 gate runner, C2 commit extension, C3 parsers)  ──────┤    D5 registry_search) ──► E1 (config_status ext) ──► F1 (wire) ──► F2 (E2E)
                    │
                    └─ (after B5)
```

---

## TIER 0 — Foundations (no dependencies, start immediately)

### P3-A1 — Config schema extension: `testFramework`
**Depends on:** none
**Complexity:** S

**What to build**
- Edit `src/config/schema.ts`. Add `testFramework: z.enum(["vitest", "none"]).default("vitest")` to the `project` object schema.
- Edit `src/config/init.ts`. Extend `InitAnswers` with `testFramework?: "vitest" | "none"` and pass through.
- Update `defaultConfig()` test fixtures if any explicitly construct the `project` object literal — the default should carry `testFramework: "vitest"`.

**Acceptance criteria**
- `bun test src/config/schema.test.ts src/config/load.test.ts` passes.
- `defaultConfig().project.testFramework === "vitest"`.
- `buildConfig({ testFramework: "none" })` returns config with `testFramework: "none"`.
- Existing configs without `testFramework` continue to parse (the default fills it in).

**Commit**: `feat(config): add project.testFramework defaulting to vitest`

---

### P3-A2 — Path helpers for code targets, plans, and registry
**Depends on:** none
**Complexity:** S

**What to build**

Extend `src/util/paths.ts` and `src/util/ids.ts`:

```ts
// paths.ts
export const codePlanPath = (
  root: string,
  scope: string,
  screenSlug: string | null
): string => {
  const name = screenSlug ? `${screenSlug}.code.plan.json` : "code.plan.json";
  return `${root}/.kotikit/specs/${scope}/${name}`;
};

export const registryDbPath = (root: string): string =>
  `${root}/.kotikit/registry.db`;

/** The directory where generated screen components for a scope live. */
export const codeComponentDir = (
  root: string,
  codeComponentsDir: string,
  scope: string
): string => `${root}/${codeComponentsDir}/${scope}`;

export const codeComponentFile = (
  root: string,
  codeComponentsDir: string,
  scope: string,
  fileName: string
): string => `${root}/${codeComponentsDir}/${scope}/${fileName}`;
```

```ts
// ids.ts
/** "checkout-flow" → "CheckoutFlow"; "profile-page" → "ProfilePage"; "cart" → "Cart". */
export function pascalCase(input: string): string {
  // split on -, _, /, whitespace; capitalize each token; join.
}

/** Derive the component name from a scope+screen pair.
 *  Single-screen (no screen): pascalCase(scope) — "profile-page" → "ProfilePage".
 *  Multi-screen (with screen): pascalCase(screen) — "cart" → "Cart". */
export function componentNameFor(scope: string, screenSlug: string | null): string {
  return screenSlug ? pascalCase(screenSlug) : pascalCase(scope);
}
```

**Acceptance criteria**
- `bun test src/util/paths.test.ts src/util/ids.test.ts` passes.
- `pascalCase("checkout-flow") === "CheckoutFlow"`, `pascalCase("text_field") === "TextField"`, `pascalCase("https-config") === "HttpsConfig"`.
- `componentNameFor("profile-page", null) === "ProfilePage"`.
- `componentNameFor("checkout-flow", "cart") === "Cart"`.
- All new path helpers return the expected absolute path.

**Commit**: `feat(util): add code-target paths, registry path, and pascalCase`

---

### P3-A3 — Adapter interface definition
**Depends on:** none (declares the interface; implementations come later)
**Complexity:** S

**What to build**

`src/codegen/adapter.ts` containing exactly:
- The `Adapter` interface from §0.
- The `AdapterContext` interface.
- The `GateCommand` interface.
- Re-exports of `GateResult` from `./gate-output.js` (the type lives there per A5).

No implementations. No React-specific code. This file is the framework boundary — if anything React-specific leaks here, the boundary is wrong.

**Acceptance criteria**
- `bun x tsc --noEmit` is clean.
- The file exports `Adapter`, `AdapterContext`, `GateCommand`.
- A trivial smoke test in `src/codegen/adapter.test.ts` constructs a stub `Adapter` and asserts the interface compiles.

**Commit**: `feat(codegen): add framework-agnostic adapter interface`

---

### P3-A4 — Registry minimal table (one-column schema)
**Depends on:** P2 `src/db/sqlite.ts`
**Complexity:** S

**What to build**

`src/db/registry-db.ts`:

```ts
import type { Database } from "bun:sqlite";

export interface RegistryRow {
  name: string;
  codePath: string;
  status: "code-only" | "design-only" | "synced";
}

export function initRegistryDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry (
      name      TEXT PRIMARY KEY,
      code_path TEXT,
      status    TEXT NOT NULL CHECK (status IN ('code-only', 'design-only', 'synced'))
    );
  `);
}

export function upsertRegistry(db: Database, row: RegistryRow): void {
  db.prepare(`
    INSERT INTO registry (name, code_path, status)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      code_path = excluded.code_path,
      status    = excluded.status;
  `).run(row.name, row.codePath, row.status);
}

export function searchRegistry(
  db: Database,
  queryTerm: string,
  limit: number = 25
): RegistryRow[];                          // simple LIKE search; FTS not needed for one column

export function getRegistry(db: Database, name: string): RegistryRow | null;
```

Search uses `LIKE` with a leading-character match (not FTS5) — Phase 3 doesn't justify FTS infrastructure for a single column. Phase 4 may rebuild this as FTS when the registry grows.

**Acceptance criteria**
- `bun test src/db/registry-db.test.ts` (in-memory):
  - Init creates the table.
  - Upsert + getRegistry round-trips.
  - Upsert by name overwrites (`status` updates).
  - `searchRegistry(db, "Button")` finds an inserted "Button".
  - `searchRegistry(db, "But")` finds via prefix (`LIKE 'But%'`).

**Commit**: `feat(db): add minimal registry table with name/code_path/status`

---

### P3-A5 — Gate-result types
**Depends on:** none
**Complexity:** S

**What to build**

`src/codegen/gate-output.ts` containing exactly the `GateResult` type from §0 plus:

```ts
export interface GateRunReport {
  ranAt: string;
  totalDurationMs: number;
  results: GateResult[];
  passed: boolean;                          // all required gates passed
}
```

No logic. Just types.

**Acceptance criteria**
- `bun x tsc --noEmit` clean.
- `src/codegen/gate-output.test.ts` (trivial — just verify the type compiles and a literal GateResult value is assignable).

**Commit**: `feat(codegen): add gate-result and run-report types`

---

## TIER 1 — Engines (depend on Tier 0)

### P3-B1 — React adapter implementation
**Depends on:** P3-A1, P3-A2, P3-A3, P3-A5
**Complexity:** L

**What to build**

`src/codegen/react/system-prompt.ts` exports a single string constant `REACT_SYSTEM_PROMPT` carrying the §7 quality baseline as hard constraints. It must contain (verbatim, as strings):
- "TypeScript strict — no `any`, no `@ts-ignore`"
- "WCAG-AA accessibility"
- "Error boundary on every page-level component"
- "no console.log"
- the literal quality bar sentence: "any developer or designer could build this identically from the spec alone"

It should also declare conventions Claude must follow:
- shadcn imports: `import { Button } from "@/components/ui/button";` (lowercase last segment).
- File names: `<PascalCase>.tsx` and colocated `<PascalCase>.test.tsx`.
- Default export is the named component.
- Use `function ComponentName(props: Props) {}` not arrow consts.

`src/codegen/react/test-scaffold.ts` exports a function `vitestScaffold(componentName, acceptanceCriteria[])` returning the full `<Component>.test.tsx` contents as a string:
- imports React Testing Library, Vitest's `describe/it/expect`, the component.
- `describe(componentName, ...)` with one `it(...)` per acceptance criterion (the criterion text becomes the test name; the body is `// TODO: implement assertion for: <criterion>` — Claude fills these in during generation, and the gate run accepts skipped tests as long as the file compiles).

`src/codegen/react/adapter.ts` exports `reactAdapter: Adapter` implementing:
- `name: "react"`.
- `systemPrompt(ctx)`: returns `REACT_SYSTEM_PROMPT` plus an interpolated section listing the screen spec, the resolved breakpoints (from config or spec override), the DS components available, and any flow context.
- `importStatement(name, dsKey?)`: returns `import { ${name} } from "@/components/ui/${kebabCase(name)}";`.
- `fileNameFor(name, kind)`: `${name}.tsx` or `${name}.test.tsx`.
- `testScaffold(ctx)`: returns `vitestScaffold(componentName, ctx.spec.acceptanceCriteria)`.
- `qualityGates(ctx)`: returns the ordered list:
  - `tsc`: `["bunx", "--no-install", "tsc", "--noEmit"]` (no file args — runs full project tsc).
  - `eslint`: `["bunx", "--no-install", "eslint", "--max-warnings", "0"]` with `filesArg: [generatedFile, generatedTestFile?]`.
  - `prettier`: `["bunx", "--no-install", "prettier", "--check"]` with `filesArg: [generatedFile, generatedTestFile?]`.
  - `vitest`: `["bunx", "--no-install", "vitest", "run"]` with `filesArg: [generatedTestFile]` if a test exists and `testFramework: "vitest"`. `required: false` when `testFramework === "none"`.
- `verifyEnvironment(root, testFramework)`: for each required tool (`tsc`, `eslint`, `prettier`, optionally `vitest`), check if `${root}/node_modules/.bin/<tool>` exists. Return `{ok: true}` if all found, otherwise `{ok: false, missing: [...]}`.
- `transformGateOutput(gate, raw)`: regex-parse known formats:
  - `tsc`: `^(.+\.tsx?)\((\d+),(\d+)\): error TS\d+: (.+)$` → `{file, line, column, message}`.
  - `eslint`: parse the default formatter — lines like `  10:5  error  Some message  rule/name` per file.
  - `prettier`: lines like `[warn] path/to/file.tsx` → `{file, message: "Code style issues found"}`.
  - `vitest`: parse `FAIL` lines from the default reporter.
  - Unrecognized lines stay in `raw` only.

**Acceptance criteria**
- `bun test src/codegen/react/adapter.test.ts`:
  - `reactAdapter.systemPrompt(...)` contains the literal quality-bar sentence and the §7 constraint phrases.
  - `reactAdapter.importStatement("TextField", "abc") === 'import { TextField } from "@/components/ui/text-field";'`.
  - `reactAdapter.fileNameFor("Cart", "component") === "Cart.tsx"`, `("Cart", "test") === "Cart.test.tsx"`.
  - `reactAdapter.qualityGates(ctxWithVitest)` includes a `vitest` command; with `testFramework: "none"`, vitest is absent or marked `required: false`.
  - `reactAdapter.verifyEnvironment(tmpRootWithNoBin, "vitest")` returns `{ok: false, missing: ["tsc", "eslint", "prettier", "vitest"]}`.
  - `transformGateOutput("tsc", "src/Foo.tsx(10,5): error TS2304: Cannot find name 'Bar'.")` returns one failure with file/line/column/message populated.

**Commit**: `feat(codegen): add react adapter with system prompt and gate commands`

---

### P3-B2 — Code planner: spec → CodePlan
**Depends on:** P3-A1, P3-A2, P3-A3
**Complexity:** M

**What to build**

`src/planning/code-plan-schema.ts` — the Zod schemas from §0.

`src/planning/code-planner.ts`:

```ts
export interface PlanCodeInput {
  root: string;
  scope: string;
  screen: string | null;
  spec: ScreenSpec;
  flowManifest?: FlowManifest;
  config: Config;
}
export function generateCodePlan(input: PlanCodeInput): CodePlan;
```

The planner is **pure** (no disk I/O). It derives:
- `componentName`: `componentNameFor(scope, screen)`.
- `targetPath`: relative path: `<codeComponentsDir>/<scope>/<componentName>.tsx`.
- `testPath`: same with `.test.tsx`, present only if `config.project.tests && config.project.testFramework === "vitest"`.
- `dsComponentRefs`: copied from `spec.components` (name + dsKey).
- `steps`: ordered list. Always:
  1. `scaffold-component` — "Scaffold `<ComponentName>` with prop types from the spec's data contracts."
  2. `compose-states` — for each state key in `spec.requirements.states`, add a notes line: e.g., "Loading state shows: <state desc>".
  3. `compose-interactions` — for each `spec.requirements.functional` item, add a notes line.
  4. `compose-accessibility` — generic step with notes "Ensure keyboard order, focused-first, aria-live for async feedback, AA contrast."
  5. `compose-responsive` — note the breakpoints (from config or spec override).
  6. `generate-test` — only if a `testPath` is set. Notes list `spec.acceptanceCriteria`.

**Acceptance criteria**
- `bun test src/planning/code-planner.test.ts`:
  - Single-screen plan (spec with no `flowRef`): correct `componentName`, `targetPath`, `testPath` set.
  - Multi-screen plan (spec with `flowRef`): correct `componentName = "Cart"`, `targetPath = "src/components/checkout-flow/Cart.tsx"`.
  - `tests: false` config → no `testPath`, no `generate-test` step.
  - `testFramework: "none"` → no `testPath`, no `generate-test` step.
  - Spec with 4 state keys → `compose-states` step has 4 notes lines.
  - Schema-validates through `CodePlanSchema.parse`.

**Commit**: `feat(planning): add code planner producing ephemeral code plans`

---

### P3-B3 — Plan store: read/write `<screen>.code.plan.json`
**Depends on:** P3-A2, P3-B2
**Complexity:** S

**What to build**

`src/planning/plan-store.ts`:

```ts
export async function writeCodePlan(
  root: string,
  scope: string,
  screen: string | null,
  plan: CodePlan
): Promise<string>;                                       // returns the written path

export async function readCodePlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<CodePlan | null>;                              // null if missing

export async function deleteCodePlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<void>;
```

All writes pretty-JSON + trailing newline. All reads validate through `CodePlanSchema.parse`; on malformed JSON the function throws a `KotikitError` with a plain-English message.

**Acceptance criteria**
- `bun test src/planning/plan-store.test.ts` (temp dir):
  - write → read round-trips and validates.
  - missing file → read returns `null`.
  - malformed file → `KotikitError`.
  - delete removes the file; subsequent read returns `null`.

**Commit**: `feat(planning): add ephemeral code plan store`

---

### P3-B4 — Auto-commit extension for `feat(code): …`
**Depends on:** existing `src/git/auto-commit.ts`
**Complexity:** S

**What to build**

Edit `src/git/auto-commit.ts`. The current `autoCommitSpec` hardcodes `feat(spec): ${kind} ${scope}` as the subject. Extend it without breaking existing callers:

```ts
export interface AutoCommitOpts {
  root: string;
  scope: string;
  kind: "create" | "update";
  files: string[];
  enabled: boolean;
  /** NEW. Subject prefix. Defaults to "feat(spec)". */
  subjectScope?: "spec" | "code";
  /** NEW. Optional subject suffix appended after scope. e.g. "/cart". */
  subjectSuffix?: string;
}
```

If `subjectScope === "code"`, subject is `feat(code): ${kind} ${scope}${subjectSuffix ?? ""}` — so a multi-screen flow's cart commit reads `feat(code): create checkout-flow/cart`.

Footer unchanged. Behavior matrix unchanged.

Rename the export to `autoCommit` (the new name) and alias `autoCommitSpec` for backwards compatibility, or just keep the original name. Pick the cleanest approach and document it.

**Acceptance criteria**
- `bun test src/git/auto-commit.test.ts`: existing tests pass unchanged.
- New test: `subjectScope: "code"` + `subjectSuffix: "/cart"` produces subject `feat(code): create <scope>/cart`.
- New test: omitting `subjectScope` produces the unchanged `feat(spec)` subject.

**Commit**: `feat(git): support code-scoped conventional commits in auto-commit`

---

### P3-B5 — Environment verifier (centralized check + cache)
**Depends on:** P3-B1 (uses `Adapter.verifyEnvironment`)
**Complexity:** S

**What to build**

`src/codegen/environment.ts`:

```ts
export interface EnvironmentReport {
  ok: boolean;
  missing: { gate: "tsc" | "eslint" | "prettier" | "vitest"; hint: string }[];
}

/**
 * Probe the user's project for required gate binaries.
 * Resolves via the adapter's verifyEnvironment, then attaches
 * install hints per missing tool.
 */
export async function verifyGateEnvironment(opts: {
  root: string;
  adapter: Adapter;
  testFramework: "vitest" | "none";
}): Promise<EnvironmentReport>;
```

The hints map (hard-coded for Phase 3):
- `tsc` → "Add typescript: `bun add -d typescript`"
- `eslint` → "Add eslint with jsx-a11y: `bun add -d eslint eslint-plugin-jsx-a11y`"
- `prettier` → "Add prettier: `bun add -d prettier`"
- `vitest` → "Add vitest with React Testing Library: `bun add -d vitest @testing-library/react @testing-library/jest-dom jsdom`"

**Acceptance criteria**
- `bun test src/codegen/environment.test.ts`:
  - All tools present (mock adapter returns `{ok: true}`) → report `ok: true, missing: []`.
  - Some missing → report `ok: false` with one entry per missing tool and the matching hint string.

**Commit**: `feat(codegen): add environment verifier with install hints`

---

## TIER 2 — Gate runner + parsers (depend on Tier 0/1)

### P3-C1 — Gate runner (spawns + collects + structures)
**Depends on:** P3-A5, P3-B1 (uses the adapter's `qualityGates` and `transformGateOutput`)
**Complexity:** M

**What to build**

`src/codegen/gate-runner.ts`:

```ts
export interface RunGatesOpts {
  root: string;                                   // user's project root (cwd for spawns)
  adapter: Adapter;
  ctx: AdapterContext;
  files: string[];                                // generated file paths (absolute), used as filesArg
  /** Restrict to specific gates (used by _gate re-runs). Default: all required. */
  only?: ("tsc" | "eslint" | "prettier" | "vitest")[];
  /** Timeout per gate in ms. Default: 60_000 (60 s). */
  timeoutMs?: number;
}

export async function runGates(opts: RunGatesOpts): Promise<GateRunReport>;
```

Algorithm:
1. Get `gates = adapter.qualityGates(ctx)`.
2. Filter by `only` (if set) and by `gate.required || only?.includes(gate.gate)`.
3. For each gate in declared order:
   - Build command: `[...cmd, ...(filesArg ? files.filter(f => relevant(gate, f)) : [])]`. For `tsc`, never pass file args (run full project tsc). For `eslint`/`prettier`/`vitest`, pass only the files relevant to that gate.
   - `Bun.spawn({ cmd, cwd: opts.root, stdout: "pipe", stderr: "pipe", env: {...process.env, FORCE_COLOR: "0"} })`.
   - Race against timeout. On timeout, kill and record `failures: [{file: "", message: "Timed out after <ms>"}]`, `exitCode: -1`, `passed: false`.
   - Read stdout + stderr.
   - Compute `passed = exitCode === 0`.
   - If failed, `failures = adapter.transformGateOutput(gate.gate, raw).failures`.
   - Push `GateResult`.
4. `passed = results.every((r) => r.passed || !r.required)`.

The runner is the only place that touches `Bun.spawn`. Tests inject a stub via an optional `spawn` parameter (same pattern as P2-A2's `resolveSecretImpl`).

**Acceptance criteria**
- `bun test src/codegen/gate-runner.test.ts` with a stub spawn:
  - All gates pass (exit 0) → `report.passed === true`, four results.
  - One gate fails → `report.passed === false`, only that gate's failures populated.
  - `only: ["tsc"]` runs exactly one gate.
  - Timeout: simulate by returning never-resolving spawn → result has the timeout failure recorded, runner does not hang the test.
  - `tsc` is invoked without file arguments; `eslint` and `prettier` receive the file list.

**Commit**: `feat(codegen): add gate runner with timeout and gate-specific args`

---

### P3-C2 — Code commit helper (wires B4 into the implementation pipeline)
**Depends on:** P3-B4
**Complexity:** S

**What to build**

A small helper in `src/codegen/code-commit.ts` so the implementation tool doesn't sprinkle commit logic. It is a thin wrapper:

```ts
export async function autoCommitCode(opts: {
  root: string;
  scope: string;
  screen: string | null;        // null for single-screen
  kind: "create" | "update";
  files: string[];              // absolute paths to the generated files
  enabled: boolean;
}): Promise<CommitResult>;
```

Implementation: build `subjectSuffix = screen ? `/${screen}` : ""` and call the extended `autoCommit` with `subjectScope: "code"`. Returns the same `CommitResult` type.

**Acceptance criteria**
- `bun test src/codegen/code-commit.test.ts` (temp git repo):
  - Single screen → commit subject `feat(code): create profile-page`.
  - Multi-screen → commit subject `feat(code): create checkout-flow/cart`.
  - `enabled: false` produces no commit.

**Commit**: `feat(codegen): add code commit helper using code-scoped subjects`

---

### P3-C3 — Gate-result formatter for human-readable tool replies
**Depends on:** P3-A5
**Complexity:** S

**What to build**

`src/codegen/gate-report.ts`:

```ts
/** Convert a GateRunReport into a one-paragraph + bulleted-list plain text summary
 *  suitable for inclusion in a tool's text response. */
export function formatGateReport(report: GateRunReport): string;
```

Format:
```
Gates: 3 of 4 passed (tsc, prettier, vitest). 1 failed (eslint).

eslint:
  src/components/checkout-flow/Cart.tsx:14:3  error  Form labels must have associated controls  jsx-a11y/label-has-associated-control
  src/components/checkout-flow/Cart.tsx:22:9  error  Buttons must have discernible text          jsx-a11y/button-has-name
```

**Acceptance criteria**
- `bun test src/codegen/gate-report.test.ts`:
  - All-pass report formats as a clean one-liner with no failure list.
  - Mixed report includes the failure block with file:line:column per failure.

**Commit**: `feat(codegen): add human-readable gate-report formatter`

---

## TIER 3 — MCP tools (depend on Tier 2)

### P3-D1 — `kotikit_plan_code` tool
**Depends on:** P3-B2, P3-B3, P3-A4
**Complexity:** S

**What to build**

`src/mcp/tools/plan-code.ts` exports `registerPlanCodeTools(registry, ctx)`.

### `kotikit_plan_code`
Input: `{ scope: string; screen?: string }`

Logic:
1. Read the spec via the existing engine (`readScreenSpec(root, scope, screen ?? null)`).
2. If `scope` has a `flow.json`, also read it (`readFlowManifest(root, scope)`).
3. Load config (default if missing).
4. `generateCodePlan({ root, scope, screen ?? null, spec, flowManifest, config })`.
5. `writeCodePlan(root, scope, screen ?? null, plan)`.
6. Return `toolText("Code plan written. <n> steps for <ComponentName>.", { planPath, plan })`.

Friendly errors when the spec is missing, surfaced as plain-English.

**Acceptance criteria**
- `bun test src/mcp/tools/plan-code.test.ts` (temp dir):
  - Single-screen plan: writes `<scope>/code.plan.json`.
  - Multi-screen plan: writes `<scope>/<screen>.code.plan.json`.
  - Missing spec: returns friendly error.
  - `tests: false` config → plan has no `testPath`.

**Commit**: `feat(mcp): add plan_code tool producing ephemeral code plans`

---

### P3-D2 — `kotikit_implement_code_start` tool
**Depends on:** P3-B1, P3-B2, P3-B3, P3-B5, P3-A4
**Complexity:** M

**What to build**

`src/mcp/tools/implement-code.ts` (this file hosts all three implement_code tools):

### `kotikit_implement_code_start`
Input: `{ scope: string; screen?: string }`

Logic:
1. `loadConfig`; error if missing.
2. `readScreenSpec` for the screen; error if missing.
3. Optional `readFlowManifest`.
4. `verifyGateEnvironment({ root, adapter: reactAdapter, testFramework })`. If `ok: false`, return a `toolError(new KotikitError("Some required gate tools aren't installed in your project.", "<formatted missing-tools hint list>"))`. **No code generation starts until gates resolve.**
5. Read the plan via `readCodePlan`. If absent, run `generateCodePlan` and write it. (Auto-plan so the front door doesn't need to call plan_code first.)
6. For each `dsComponentRef`:
   - If `dsKey`, query the registry for `name` (Phase 3 will mostly return nothing — registry is empty until first save).
   - Read the DS component JSON via `componentJsonPath` (if `design-system/` exists). Skip silently if not found.
7. Build the `AdapterContext`, call `reactAdapter.systemPrompt(ctx)`.
8. Compute target paths:
   - `componentTargetPath = codeComponentFile(root, codeComponentsDir, scope, reactAdapter.fileNameFor(componentName, "component"))`.
   - `testTargetPath` = same with `"test"` kind, only if the plan has a `testPath`.
9. Return `toolText(...)` with detail:
   ```json
   {
     "componentName": "...",
     "targetPath": "...",
     "testPath": "...",
     "systemPrompt": "...",
     "spec": { ... },
     "flow": { ... | undefined },
     "dsComponents": { "Button": {...componentjson...}, ... },
     "config": { "breakpoints": [...], "themes": [...] },
     "registryHits": [ { "name": "Button", "codePath": "..." } ],
     "testFramework": "vitest" | "none",
     "testScaffold": "...the .test.tsx contents..."
   }
   ```
   `testScaffold` is the adapter's pre-built test file template Claude can fill in.

**Acceptance criteria**
- `bun test src/mcp/tools/implement-code-start.test.ts` (or merged into `implement-code.test.ts`):
  - Happy path returns the full context bundle with `systemPrompt` containing the bar sentence and the spec details.
  - Missing spec → friendly error.
  - Missing gates (mocked verifier returns `ok: false`) → friendly error mentioning the missing tools.
  - With a design-system mirror present, `dsComponents` contains the JSON for any spec.components reference whose JSON exists.
  - Without a design-system mirror, `dsComponents` is `{}` and the tool does NOT error.

**Commit**: `feat(mcp): add implement_code_start tool with context bundle`

---

### P3-D3 — `kotikit_implement_code_save` tool
**Depends on:** P3-C1, P3-C2, P3-A4, existing spec update
**Complexity:** L

**What to build**

(Same file as D2: `src/mcp/tools/implement-code.ts`.)

### `kotikit_implement_code_save`
Input:
```ts
{
  scope: string;
  screen?: string;
  files: { path: string; content: string }[];   // absolute paths
}
```

Logic:
1. Validate input: every `path` must resolve inside `<root>/<codeComponentsDir>/<scope>/`. Reject path-traversal or anything outside.
2. Write each file (creating parent dirs).
3. Build `AdapterContext` (same as D2 step 7).
4. `runGates({ root, adapter: reactAdapter, ctx, files: filePaths, only: requiredGatesForChange })`. Required gates: all four for a fresh write; on a re-run from `_gate`, the caller chooses.
5. If `report.passed === false`: return `toolText(formatGateReport(report) + "\n\nFix the failures and call implement_code_gate to re-validate.", { report })` with `isError: true`. **Do NOT commit. Do NOT update spec.**
6. If `report.passed === true`:
   - `upsertRegistry(db, { name: componentName, codePath: targetPath, status: "code-only" })`.
   - `autoCommitCode({ root, scope, screen, kind: writeKind, files, enabled: config.git.autoCommit })`. `writeKind = "create"` if any of the target files were freshly created, else `"update"` (track this from step 2's file existence check).
   - Update spec status to `"active"` via `parseScreenSpec(...)` + `writeScreenSpec(...)` (only the spec's `status` and `metadata.updatedAt` change). Skip if already `"active"`.
   - Return `toolText("Implemented <ComponentName>. All gates passed. <commit subject>.", { report, commit, paths })`.

`writeKind` heuristic: `"create"` if the component file did not exist before step 2; otherwise `"update"`.

**Acceptance criteria**
- `bun test src/mcp/tools/implement-code-save.test.ts` (temp git repo, stub gate runner):
  - All gates pass → files written, registry has the new row, spec status is `"active"`, one commit `feat(code): create checkout-flow/cart`.
  - One gate fails → files written (so the next call can patch them), but no commit, spec status unchanged.
  - Path traversal attempt → friendly error, no files written.
  - Update on an already-existing target → commit subject is `feat(code): update <scope>/<screen>` and spec status stays `"active"` (no double-bump).
  - With `autoCommit: false` → no commit, files still written, gates still run.

**Commit**: `feat(mcp): add implement_code_save with gates and atomic commit`

---

### P3-D4 — `kotikit_implement_code_gate` tool
**Depends on:** P3-C1, P3-C3
**Complexity:** S

**What to build**

(Same file: `src/mcp/tools/implement-code.ts`.)

### `kotikit_implement_code_gate`
Input:
```ts
{
  scope: string;
  screen?: string;
  only?: ("tsc" | "eslint" | "prettier" | "vitest")[];
}
```

Logic:
1. Read the spec, flow, config. Resolve the component and test paths via the same code as `_save` step 1.
2. Verify the files exist on disk; if not, friendly error ("There's no generated code yet — call implement_code_save first.").
3. Build the `AdapterContext`, `runGates({ ..., files: existingPaths, only })`.
4. Return `toolText(formatGateReport(report), { report })`. `isError: true` if any required gate failed.

No commits, no spec status changes — gates are read-only.

**Acceptance criteria**
- `bun test src/mcp/tools/implement-code-gate.test.ts`:
  - Files exist + all gates pass → `isError: false` + clean summary.
  - Files exist + one gate fails → `isError: true` + the formatted failures.
  - Files don't exist → friendly error, gates not invoked.
  - `only: ["eslint"]` runs only eslint.

**Commit**: `feat(mcp): add implement_code_gate for on-disk re-validation`

---

### P3-D5 — `kotikit_registry_search` tool (read-only)
**Depends on:** P3-A4
**Complexity:** S

**What to build**

`src/mcp/tools/registry.ts` exports `registerRegistryTools(registry, ctx)`.

### `kotikit_registry_search`
Input: `{ query: string; limit?: number }`

Logic:
1. If `registryDbPath(ctx.root)` doesn't exist, `toolText("Registry is empty.", { results: [] })` (NOT an error — just no results).
2. Open the DB readonly, `searchRegistry(db, query, limit ?? 25)`, close.
3. Return `toolText("Found <n> code components matching <query>.", { results })`.

Phase 4 will add `kotikit_registry_update`; Phase 3 ships read-only.

**Acceptance criteria**
- `bun test src/mcp/tools/registry.test.ts`:
  - Empty registry → `{ results: [] }`.
  - Seeded with two rows → search returns matching rows.

**Commit**: `feat(mcp): add registry_search read-only tool`

---

## TIER 4 — Status extension (depends on Tier 3)

### P3-E1 — Extend `kotikit_config_status` with `gates` field
**Depends on:** P3-B5
**Complexity:** S

**What to build**

Edit `src/mcp/tools/config.ts`. The handler for `kotikit_config_status` currently returns `{ initialized, isGitRepo, missing }`. Add:

```ts
{
  initialized: boolean;
  isGitRepo: boolean;
  missing: string[];                                                  // existing
  gates: { ok: boolean; missing: { gate: string; hint: string }[] }; // NEW (only present when initialized)
}
```

When `initialized: true`, call `verifyGateEnvironment(...)` and attach the result. When `initialized: false`, omit `gates` (no point — there's no config to read `testFramework` from yet).

**Acceptance criteria**
- `bun test src/mcp/tools/config.test.ts` (existing tests pass + new assertions):
  - After init with a project root that has all tools → `gates.ok === true, missing: []`.
  - After init with a project root that has none → `gates.ok === false`, `missing` lists tsc/eslint/prettier (and vitest if testFramework is "vitest").
  - Before init → `gates` is undefined.

**Commit**: `feat(mcp): extend config_status with gate environment report`

---

## TIER 5 — Wire + E2E (depend on Tier 3 + 4)

### P3-F1 — Wire tools into `server.ts`
**Depends on:** P3-D1..D5
**Complexity:** S

**What to build**

Edit `src/mcp/server.ts`. Add four `register*Tools` calls:
- `registerPlanCodeTools(registry, ctx)` — registers `kotikit_plan_code`.
- `registerImplementCodeTools(registry, ctx)` — registers `_start`, `_save`, `_gate` (one registrar, three tools).
- `registerRegistryTools(registry, ctx)` — registers `kotikit_registry_search`.

Update `src/mcp/server.test.ts` so the "registers all" assertion lists the new tool names. Total tools after Phase 3: **19** (14 from Phase 1+2 + 5 new).

**Acceptance criteria**
- `bun test src/mcp/server.test.ts` passes.
- `bun x tsc --noEmit` clean.
- The five new tool names are present in the registered list.

**Commit**: `feat(mcp): register phase 3 code planning and implementation tools`

---

### P3-F2 — End-to-end smoke test
**Depends on:** P3-F1
**Complexity:** L

**What to build**

`test/e2e/phase3.test.ts`. Drives the Phase 3 happy path in-process against a temp project dir that simulates a real React project. The trick: we don't want CI to actually install React + Vitest + ESLint to make this work. So we mock the gate runner.

Approach:
- The test injects a stub `runGates` via a registration option (similar to P2's `figmaClientFactory`). The implement tools accept `gateRunner?: typeof runGates` in their `RegisterX` opts.
- The test config sets `project.testFramework: "vitest"` and `project.tests: true`.
- The test runs:

1. **Setup**: temp git repo + `git init` + name/email + `bun add` skipped (we mock everything).
2. **`kotikit_config_init`** with `testFramework: "vitest"`, `autoCommit: true`.
3. **`kotikit_plan_code({ scope: "profile-page" })`** after writing a single-screen spec to disk.
4. Assert the plan file is on disk with the right `targetPath`, `testPath`, and step list.
5. **`kotikit_implement_code_start({ scope: "profile-page" })`**:
   - Stub the environment verifier so it returns `{ ok: true }` (no real binaries).
   - Assert the response contains the system prompt, spec, target paths, and test scaffold.
6. **`kotikit_implement_code_save({ scope, files: [{path: targetPath, content: fakeReactCode}, {path: testPath, content: fakeTestCode}] })`**:
   - Stub gate runner to return all-passed.
   - Assert files are on disk, registry has the row, spec status is `"active"`, one git commit `feat(code): create profile-page`.
7. **Failure-then-fix sub-test**: stub gate runner to fail eslint on first call, then call `_gate` with a stubbed pass; assert no double-commit and the second call returns `isError: false`.
8. **Multi-screen variant**: write a flow with two screen specs; run `plan_code` + `implement_code_*` for one screen; assert commit subject contains `<scope>/<screen>` and the registry row exists.
9. **Path traversal**: `_save` with `path: "../etc/passwd"` returns a friendly error and writes nothing.

**Acceptance criteria**
- `bun test test/e2e/phase3.test.ts` passes.
- `bun x tsc --noEmit` clean for the entire repo.

**Commit**: `test(e2e): add phase 3 code generation and gate smoke test`

---

## 2. Definition of Done for Phase 3

- [ ] `bun install`, `bun x tsc --noEmit`, and `bun test` all pass.
- [ ] `bun run src/mcp/server.ts` exposes 19 tools (Phase 1+2 + `kotikit_plan_code`, `kotikit_implement_code_start`, `kotikit_implement_code_save`, `kotikit_implement_code_gate`, `kotikit_registry_search`).
- [ ] A designer (or the E2E test acting as one) can: pick a spec → get a code plan → get a context bundle → submit generated files → see them validated by tsc/eslint/prettier/vitest → see them auto-committed with `feat(code): create <scope>/<screen>` → see the spec status flip `draft → active`.
- [ ] Missing gate tools in the user's project halt code generation at `_start` with a plain-English error naming the missing tools and the exact install command.
- [ ] All gate failures surface their structured failures plus the raw output — Claude can fix in place and re-run via `_gate` without re-sending files.
- [ ] Generated files land at `<codeComponentsDir>/<scope>/<PascalCase>.tsx` (plus `.test.tsx` when `testFramework: "vitest"` and `tests: true`).
- [ ] The registry receives one row per implemented screen (`status: "code-only"`).
- [ ] Adapter discipline: nothing React-specific lives outside `src/codegen/react/`. The `Adapter` interface in `src/codegen/adapter.ts` is the only export the planner, gate runner, and MCP tools import.
- [ ] Each task lands as one atomic commit with a conventional-commits subject and the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

## 3. Parallelization summary (for a swarm of agents)

- **Wave 1 (5 agents):** A1, A2, A3, A4, A5 — fully independent.
- **Wave 2 (5 agents):** B1, B2, B3, B4, B5 — after Wave 1. B1 is L; others are S/M.
- **Wave 3 (3 agents):** C1, C2, C3 — after Wave 1+2. C1 is M.
- **Wave 4 (5 agents):** D1, D2, D3, D4, D5 — after Wave 3. D3 is L.
- **Wave 5 (1 agent):** E1 — after Wave 4 (needs B5 from Wave 2 but waits for D's tool to extend).
- **Wave 6 (1 agent):** F1 — wire.
- **Wave 7 (1 agent):** F2 — the proof.

The two largest (B1 React adapter, D3 implement_save) are L; everything else is S/M. Sized for one agent in 30–90 minutes each.

## 4. Atomic commit discipline (read before starting any task)

- **One task = one commit.** No bundling, no splitting.
- **Conventional commits subject.** `feat(<scope>): <imperative summary>`. Subject under 72 chars.
- **Body explains the why, not the what.** Two or three sentences.
- **Co-author footer mandatory.** Last line:
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- **No `--no-verify`.** No bypassing hooks.
- **Commit only when tests + typecheck pass.** Run `bun test <files-touched>` and `bun x tsc --noEmit` first.
- **No amending.** A correction is a new commit (`fix(<scope>): …`).
- **Tests pass for the WHOLE suite, not just the new ones.** After each commit, the full `bun test` must stay green.

## 5. Out of scope (for Phase 3)

These are explicitly **not** in Phase 3 and should not be implemented even if the agent feels like it:

- Playwright integration tests, browser orchestration, dev-server lifecycle.
- Chrome DevTools MCP integration, runtime layout/contrast checking.
- Scaffolding sweeps (multi-DS-component → multi-code-file in one pass) — Phase 4.
- Storybook story generation — Phase 4.
- The DS side of the registry (`ds_path` column, design-only/synced status) — Phase 4.
- Multi-framework adapters (Vue, Svelte). The interface is in place; only `react` is implemented.
- Cross-screen shared infrastructure (router config, context providers, app shell).
- Auto-installing tsc/eslint/prettier/vitest into the user's project.
- Reverse path (code → Figma generation).
- CI/CD integration.
