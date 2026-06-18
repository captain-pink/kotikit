# Planning

## What it does

The planning module manages ephemeral, regenerable plans that guide an agent through multi-step code generation and design application. It owns two independent plan tracks: the code track (Phase 3) that breaks screen implementation into ordered steps, and the design track (Phase 5) that describes how to build a screen in Figma using the bridge. Plans are written next to their spec files inside `.kotikit/specs/<scope>/`, deleted once the work is done, and regenerated if ever needed again.

## Public surface

**Code plans** (`src/planning/code-plan-schema.ts`, `src/planning/plan-store.ts`, `src/planning/code-planner.ts`)
- `CodePlan`, `CodePlanSchema` — the plan shape (version, scope, screen, componentName, targetPath, testPath, dsComponentRefs, steps, createdAt)
- `CodePlanStepKind` — `"scaffold-component" | "compose-states" | "compose-interactions" | "compose-accessibility" | "compose-responsive" | "generate-test"`
- `CodePlanStep`, `CodePlanStepSchema`
- `parseCodePlan(raw)` — validates raw JSON, throws plain-English error on failure
- `generateCodePlan(opts)` — async; uses the spec, config, and DS component list to build a `CodePlan`
- `writeCodePlan(root, scope, screenSlug | null, plan)` — async; writes to the scope directory
- `readCodePlan(root, scope, screenSlug | null)` — async; returns `CodePlan | null`
- `deleteCodePlan(root, scope, screenSlug | null)` — async; removes the plan file

**Design plans** (`src/planning/design-plan-schema.ts`, `src/planning/design-plan-store.ts`, `src/planning/design-planner.ts`)
- `DesignPlan`, `DesignPlanSchema` — the plan shape (version, scope, screen, pageName, states, steps, createdAt)
- `DesignPlanStepKind` — `"define-state-frame" | "apply-auto-layout" | "place-component" | "bind-variable"`
- `DesignPlanStep` — a discriminated union of the four step kinds, each with its own validated fields
- `parseDesignPlan(raw)` — validates raw JSON, throws `KotikitError` on failure
- `generateDesignPlan(opts)` — async; builds a `DesignPlan` from the spec and config
- `writeDesignPlan(root, scope, screen | null, plan)` — async
- `readDesignPlan(root, scope, screen | null)` — async; returns `DesignPlan | null`
- `deleteDesignPlan(root, scope, screen | null)` — async

**Design node maps, comments, and preferences** (`src/planning/design-node-map.ts`, `src/planning/design-comments.ts`, `src/db/design-review-db.ts`)
- `DesignNodeMap` — persisted per-screen Figma node map written by `kotikit_design_apply_step` when the plugin reports Figma node metadata
- `readDesignNodeMap(root, scope, screen | null)` — async; returns `DesignNodeMap | null`
- `upsertDesignNodeMapEntry(root, scope, screen | null, update)` — async; merges a step's latest target node metadata into the map
- `mapCommentsToDesignNodes(comments, nodeMap, options)` — pure mapper that links Figma comments by `client_meta.node_id` and leaves unmatched comments unmapped instead of guessing
- `design-review.db` — local review ledger for comment sessions, micro-adjustments, reply outbox rows, preference candidates, and active design preferences

## How it works

Both plan tracks follow the same lifecycle: a MCP tool generates and writes the plan, a second tool reads and returns it to the agent, the agent executes the steps (via codegen or bridge tool calls), and a third tool deletes it on completion. Plans are intentionally ephemeral — they are never committed to version control and are always regenerable from the spec they reference. This makes them safe to delete and keeps the `.kotikit/specs/` directory tidy between sessions.

The code plan's `steps` array maps directly to the code generation loop in `kotikit_implement_code_start`. Each step has a `kind` (which determines what the agent writes) and optional `notes` (which carry spec-derived context like "The list uses a pull-to-refresh gesture" for `compose-interactions`). The step kinds form a deliberate ordering: scaffold first, then states, then interactions, then accessibility, then responsive, then tests. This order ensures the file exists before richer behavior is layered in.

The design plan's steps use a discriminated union on `kind`. Each step kind carries exactly the fields the corresponding Figma operation needs: `define-state-frame` carries dimensions; `apply-auto-layout` carries direction, padding, and spacing; `place-component` carries the component name, DS key, and variant overrides; `bind-variable` carries the variable name and the CSS property to bind it to. The bridge flow reads one step at a time, executes it in the Figma plugin, and records the result through `kotikit_design_apply_step`.

Apply results are recorded in two forms. The JSONL apply log stays as the append-only audit trail. The optional `design.node-map.json` is a compact, validated map from design-plan steps to Figma node IDs. `kotikit_design_review_comments` uses that map with Figma comment `client_meta.node_id` values to tell the agent which planned component or frame a review comment targets. Comments without node IDs, or comments whose node IDs are outside the map, are returned as unmapped rather than inferred from text.

Review results and refinements live in `.kotikit/design-review.db`. Agents record micro-adjustments through `kotikit_design_adjustment_record` instead of expanding specs or prompts with verbose change history. Repeated feedback can become a design memory candidate; promoted preferences are returned by `kotikit_design_get_screen` as `designPreferences` so future design passes can apply project taste before the same comment appears again.

## When to extend it

- Adding a new code step kind (e.g. `"compose-animation"`) — extend `CodePlanStepKindSchema`, add logic to `generateCodePlan` to include it when the spec signals animation requirements, and update the MCP `implement_code_start` tool to handle the new kind.
- Adding a new design step kind (e.g. `"export-asset"`) — add a new variant to `DesignPlanStepSchema` as a discriminated union member with its own Zod schema, then handle it in the bridge apply loop.
- Adding a design-to-code synchronization step — a third plan kind (e.g. `SyncPlan`) would follow the same store pattern; add `syncPlanPath` to `src/util/paths.ts` first.
- Persisting plan history instead of deleting — replace `deleteCodePlan` with an archive move to a `.kotikit/history/` directory; the reader interface stays the same.

## Related

- [spec](./spec.md) — plans reference specs by scope and screen slug; `ScreenSpec` is the primary input to both generators
- [codegen](./codegen.md) — code plan steps map to codegen operations in the implement flow
- [util](./util.md) — `codePlanPath`, `designPlanPath`, and `designNodeMapPath` live here
- [mcp](./mcp.md) — `kotikit_plan_code`, `kotikit_implement_code_start`, `kotikit_plan_design`, `kotikit_design_apply_step`, and the design review/comment/memory tools are the tool wrappers
- `planning/phase-3.md` — code plan design rationale
- `planning/phase-5.md` — design plan design rationale; bridge integration
