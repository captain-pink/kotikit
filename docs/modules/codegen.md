# Codegen

## What it does

The codegen module owns everything that turns a `ScreenSpec` into runnable code: a framework-agnostic `Adapter` interface, the React adapter that implements it (including the quality-bar-encoded system prompt, CVA-pattern component scaffolder, and Storybook story emitter), the gate runner that executes `tsc / eslint / prettier / vitest` and returns structured results, the environment verifier that checks for required binaries before generation starts, and the `autoCommitCode` helper that creates a conventional commit once generated files are written.

## Public surface

**Adapter interface** (`src/codegen/adapter.ts`)
- `Adapter` — the framework interface every code generator must implement
- `AdapterContext` — `{ root, config, spec, flowManifest?, dsComponents }` passed to every adapter method
- `GateKind` — `"tsc" | "eslint" | "prettier" | "vitest"`
- `GateCommand` — `{ gate, cmd, filesArg?, required }`
- `GateResult`, `GateRunReport` — re-exported from `gate-output.ts`

**React adapter** (`src/codegen/react/adapter.ts`)
- `reactAdapter` — the singleton `Adapter` implementation for React + shadcn + CVA
- `REACT_SYSTEM_PROMPT` — the exported constant; also retrievable via `kotikit_get_system_prompt({ kind: "react" })`
- `buildReactSystemPrompt(ctx)` — builds the full per-screen prompt by interpolating spec excerpt, breakpoints, and flow info into `REACT_SYSTEM_PROMPT`

**Scaffolder** (`src/codegen/react/scaffold.ts`)
- `scaffoldComponent({ json, hasStorybook })` — returns `ScaffoldResult` with 1 or 2 `ScaffoldedFile` objects
- `buildComponentTsx(json, codeComponentsDir)` — pure function; produces the `.tsx` file content
- `ScaffoldResult`, `ScaffoldedFile`

**Storybook story emitter** (within `src/codegen/react/scaffold.ts` and `src/codegen/react/storybook-detect.ts`)
- `buildStoryTsx` — CSF3 story file; one story per variant axis, no cartesian explosion
- `hasStorybook(root)` — probe; checks for storybook config in the user's project

**CVA helpers** (`src/codegen/react/cva-helpers.ts`)
- `slugifyVariantValue(input)` — Figma variant value → lowercase-kebab slug
- `kebabCase(input)` — identifier-flavored variant of `slugifyVariantValue`
- `emitCvaVariantsBlock(json)` — emit the full `cva("", { variants: {...}, defaultVariants: {...} })` call
- `emitPropsInterface(json, intrinsicElement)` — emit the TypeScript `interface <Name>Props` declaration
- `intrinsicElementFor(componentName)` — heuristic that maps "Button" → `"button"`, "TextField" → `"input"`, etc.
- `deriveVariantDefaults(json)` — pick the first value per axis as the CVA default
- `variantPropKey(figmaPropertyName)` — alias for `kebabCase`; clarifies intent at call sites

**Gate runner** (`src/codegen/gate-runner.ts`)
- `runGates(opts)` — spawn gate commands, collect results; sequential; `tsc` is always project-wide (no file args)
- `RunGatesOpts`, `SpawnFn`

**Environment verifier** (`src/codegen/environment.ts`)
- `verifyGateEnvironment({ root, adapter, testFramework })` — delegates detection to the adapter; attaches paste-able install hints for each missing tool
- `EnvironmentReport` — `{ ok, missing: MissingGate[] }`
- `MissingGate` — `{ gate, hint }`

**Code commit** (`src/codegen/code-commit.ts`)
- `autoCommitCode({ root, scope, screen, kind, files, enabled, coAuthor? })` — wrapper over `autoCommit` with `subjectScope: "code"`; subject suffix is `/<screen>` for multi-screen flows

**Gate report formatter** (`src/codegen/gate-report.ts`)
- `formatGateReport(report)` — returns a human-readable string the agent can include in its response

## How it works

The `Adapter` interface decouples tool layer code from framework-specific decisions. Every method that needs framework knowledge (`systemPrompt`, `importStatement`, `fileNameFor`, `testScaffold`, `qualityGates`, `verifyEnvironment`, `transformGateOutput`) is delegated to the adapter. The MCP tools that drive code generation only import the adapter interface, never the `reactAdapter` singleton directly — this ensures that adding a Vue adapter in the future requires no changes to the tool layer.

The CVA pattern (class-variance-authority) is the scaffold's structural backbone. `buildComponentTsx` emits all Tailwind utility class strings as empty string placeholders (`""`). kotikit owns the shape — the variant axes, their values, the props interface, and the component skeleton — while the agent fills in actual Tailwind classes during the implement pass. This division of responsibility keeps scaffolded files valid TypeScript from the first generation: the shape is correct even before styling classes are added.

Gate commands run sequentially. `tsc` receives no per-file arguments (it must type-check the whole project to catch cross-file issues). All other gates (`eslint`, `prettier`, `vitest`) receive the list of generated files as positional arguments so they operate only on what just changed. Each gate has a 60-second timeout by default. The gate runner collects all results and returns a `GateRunReport`; it never throws — even a timeout is recorded as a failed result with a structured failure entry.

Storybook story generation uses CSF3 format. Stories are one-per-axis (one story showing the `variant` axis values, one showing `size` axis values, etc.) rather than a full cartesian product, which would produce O(N^M) stories for N values across M axes. This keeps the story file readable and avoids Storybook slowdown on large component sets.

## When to extend it

- Adding a Vue or Svelte adapter — implement the `Adapter` interface in a new `src/codegen/vue/` directory; update the MCP tools that currently hardcode `reactAdapter` to read `config.project.framework` and dispatch to the right adapter.
- Adding a new gate kind (e.g. a custom lint rule) — extend the `GateKind` union, add an entry to the adapter's `qualityGates()`, and add an `INSTALL_HINTS` entry in `environment.ts`.
- Changing the CVA default derivation — edit `deriveVariantDefaults`; the current heuristic (first value in the axis array) is documented as a Phase 5+ refinement placeholder.
- Adding a new file type from the scaffolder (e.g. a CSS module) — add an entry to `ScaffoldResult.files`; the caller already iterates `files` and writes each one.

## Related

- [sync](./sync.md) — `ComponentJson` is the input shape `AdapterContext.dsComponents` carries
- [planning](./planning.md) — `CodePlan` describes which codegen steps to run for a screen
- [git](./git.md) — `autoCommitCode` delegates to `autoCommit`
- [mcp](./mcp.md) — `kotikit_implement_code_start`, `kotikit_scaffold_start`, and related tools orchestrate codegen calls
- `planning/phase-3.md` — implement_code design; gate-runner architecture
- `planning/phase-4.md` — scaffold pagination; CVA pattern; Storybook story format
