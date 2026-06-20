# Util

## What it does

The util module provides the shared foundation that every other module depends on: path helpers that centralize where every kotikit file lives on disk, ID and slug utilities for generating UUIDs and converting names between case conventions, and the error/result helpers that ensure every error reaching the designer is a plain-English `KotikitError` with no stack trace or system message leaking through. Centralizing these primitives means tests across the codebase can swap the project root to a temp directory with a single variable change.

## Public surface

**Paths** (`src/util/paths.ts`)

Core kotikit state:
- `KOTIKIT_DIR` — the string `".kotikit"`, used when constructing paths manually
- `configPath(root)` — `.kotikit/config.json`
- `indexPath(root)` — `.kotikit/index.json`
- `scopeDir(root, scope)` — `.kotikit/specs/<scope>/`
- `screenSpecPath(root, scope, screenSlug)` — `.kotikit/specs/<scope>/<slug>.spec.json`
- `singleSpecPath(root, scope)` — `.kotikit/specs/<scope>/spec.json`
- `flowManifestPath(root, scope)` — `.kotikit/specs/<scope>/flow.json`
- `codePlanPath(root, scope, screenSlug | null)` — `.kotikit/specs/<scope>/<slug>.code.plan.json` or `code.plan.json`
- `designPlanPath(root, scope, screen | null)` — `.kotikit/specs/<scope>/<screen>.design.plan.json`
- `designApplyLogPath(root, scope, screen | null)` — `.kotikit/specs/<scope>/<screen>.design.apply.log`
- `bridgeConfigPath(root)` — `.kotikit/bridge.json`
- `registryDbPath(root)` — `.kotikit/registry.db`

Design system artifacts:
- `designSystemDir(root)` — `design-system/`
- `componentsDbPath(root)` — `design-system/components.db`
- `iconsDbPath(root)` — `design-system/icons.db`
- `variablesJsonPath(root)` — `design-system/variables.json`
- `manifestPath(root)` — `design-system/manifest.json`
- `componentJsonPath(root, slug)` — `design-system/components/<slug>.json`
- `checkpointPath(root)` — `design-system/.sync-checkpoint.json`
- `syncReportPath(root)` — `design-system/.sync-report.json`

Generated code:
- `codeComponentDir(root, codeComponentsDir, scope)` — `<codeComponentsDir>/<scope>/`
- `codeComponentFile(root, codeComponentsDir, scope, fileName)` — `<codeComponentsDir>/<scope>/<fileName>`
- `uiDir(root, codeComponentsDir)` — `<codeComponentsDir>/ui/`
- `uiComponentFile(root, codeComponentsDir, kebabName)` — `<codeComponentsDir>/ui/<kebab-name>.tsx`
- `uiStoryFile(root, codeComponentsDir, kebabName)` — `<codeComponentsDir>/ui/<kebab-name>.stories.tsx`

Project root discovery:
- `findProjectRoot(start?)` — walk up from `start` (default `process.cwd()`) looking for a directory that contains `.kotikit/`; returns the original start if no such directory is found

**Environment** (`src/util/env.ts`)
- `parseDotEnv(text)` — parse simple `.env` content into key/value pairs
- `loadDotEnv(root, options?)` — load `<root>/.env` into `process.env`; existing non-empty values are preserved, while `{ overrideEmpty: true }` refreshes empty placeholders such as `FIGMA_TOKEN=`

**IDs and slug helpers** (`src/util/ids.ts`)
- `uuid()` — `crypto.randomUUID()`
- `nowIso()` — `new Date().toISOString()`
- `slugify(input)` — trim, lowercase, replace non-alphanumeric runs with `-`, strip leading/trailing `-`
- `pascalCase(input)` — split on `-_/ whitespace`, capitalize each token, join: `"checkout-flow"` → `"CheckoutFlow"`
- `componentNameFor(scope, screenSlug | null)` — `pascalCase(screenSlug ?? scope)`: the React component name for a scope+screen pair
- `slugifyComponentName(name)` — CamelCase-aware kebab-casing for component filenames: `"ButtonGroup"` → `"button-group"`, `"HTTPSConfig"` → `"https-config"`

**Error and result helpers** (`src/util/result.ts`)
- `KotikitError` — extends `Error`; carries `userMessage` (shown to the designer) and optional `hint` (a one-line follow-up suggestion)
- `toolText(summary, detail?)` — build the `{ content: [{ type: "text", text }] }` MCP result; appends pretty-printed `detail` JSON after a blank line when provided
- `toolError(err)` — convert any thrown value to a safe MCP error result; `KotikitError` surfaces `userMessage + hint`; any other error returns a generic message with no system details

## How it works

All path helpers are pure functions that take `root` as their first argument and return a string. This design is deliberate: the entire `.kotikit/` directory tree is rooted at a single variable. Test files create a temp directory, pass it as `root`, and get a fully isolated state tree without any mocking or patching. The same isolation applies to the `design-system/` subtree for sync tests and to `<codeComponentsDir>/` for codegen tests.

`findProjectRoot` walks the directory tree upward until it finds a directory containing `.kotikit/`. This allows kotikit to work correctly when an MCP client opens or starts from a file inside a subdirectory of the project root. When no explicit start path is passed, it prefers Claude Code's `CLAUDE_PROJECT_DIR` environment variable before falling back to `process.cwd()`, which keeps project-scoped `.mcp.json` installs pointed at the target React app even if Claude starts the server process elsewhere. If no `.kotikit/` ancestor is found (e.g. in a fresh project that has not yet been initialized), it returns the starting directory, which is safe because `configExists` will return `false` and the init flow will trigger.

`toolError` is the single choke point that prevents internal errors from leaking to the designer. Any `catch` block in a tool handler should call `return toolError(err)` rather than re-throwing or constructing a manual error response. For `KotikitError` specifically, the `hint` is appended on a second line if present, giving the designer a concrete next action alongside the error message.

## When to extend it

- Adding a new file that kotikit writes — add a path helper function following the `const xyzPath = (root: string, ...): string => ...` pattern; never hardcode the path in the module that uses it.
- Adding a new error category (e.g. a structured validation error with field names) — consider subclassing `KotikitError` and updating `toolError` to handle the subclass; keep the output to the designer as plain English.
- Changing where the design system lives (e.g. moving to `.kotikit/design-system/`) — update `designSystemDir` and its derivatives; all callers use the helpers rather than constructing paths directly.
- Adding a new ID format (e.g. sequential IDs for plan steps) — add a new helper function in `ids.ts`; do not modify `uuid` or `nowIso`.

## Related

- [config](./config.md) — uses `configPath` and `findProjectRoot`
- [spec](./spec.md) — uses `scopeDir`, `screenSpecPath`, `singleSpecPath`, `flowManifestPath`, `indexPath`
- [sync](./sync.md) — uses all `design-system/` path helpers and `checkpointPath`
- [codegen](./codegen.md) — uses `codeComponentDir`, `codeComponentFile`, `uiDir`, `uiComponentFile`, `uiStoryFile`
- [planning](./planning.md) — uses `codePlanPath`, `designPlanPath`, `designApplyLogPath`
- [db](./db.md) — uses `componentsDbPath`, `iconsDbPath`, `registryDbPath`
- [mcp](./mcp.md) — uses `findProjectRoot`, `bridgeConfigPath`
- [git](./git.md) — uses `KotikitError` (re-exported from result)
