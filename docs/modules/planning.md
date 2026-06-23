# Planning

## What it does

The planning module manages regenerable plans that guide an agent through multi-step code generation, component decisions, and design application. It owns three independent plan tracks: the code track that breaks screen implementation into ordered steps, the component track that records how missing design-system components should be resolved, and the design track that describes how to build a screen in Figma using the bridge. Plans are written next to their spec files inside `.kotikit/specs/<scope>/` and can be regenerated if ever needed again.

Current product stage: the design track is the guided workflow. The code track
remains available for engineering experiments and future design-to-code work,
but `/kotikit-auto` and `kotikit:auto` should not call it for designers yet.

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
- `DesignPlan`, `DesignPlanSchema` — the plan shape (version, scope, screen, target, pageName, states, layout, steps, createdAt)
- `DesignPlanStepKind` — `"define-state-frame" | "apply-auto-layout" | "define-layout-zone" | "place-component" | "bind-variable"`
- `DesignPlanStep` — a discriminated union of the five step kinds, each with its own validated fields
- `LayoutContract` (`src/planning/layout-contract.ts`) — semantic zones and component placements derived from the spec, independent of any specific design system
- `parseDesignPlan(raw)` — validates raw JSON, throws `KotikitError` on failure
- `generateDesignPlan(opts)` — async; builds a `DesignPlan` from the spec and config
- `writeDesignPlan(root, scope, screen | null, plan)` — async
- `readDesignPlan(root, scope, screen | null)` — async; returns `DesignPlan | null`
- `deleteDesignPlan(root, scope, screen | null)` — async

**Component plans** (`src/planning/component-plan-schema.ts`, `src/planning/component-plan-store.ts`, `src/planning/component-planner.ts`)
- `ComponentPlan`, `ComponentPlanSchema` — the decision artifact for missing components (version, scope, screen, target, mode, literalFallbackAllowed, requiresHumanReview, steps, createdAt)
- `ComponentPlanMode` — `"create-draft-components" | "inline-draft"`
- `ComponentPlanStep` — either `"create-draft-component"` with a `componentSpecRef`, or `"create-inline-draft"` for page-only pieces
- `ComponentTokenRef` — compact references to existing variables or styles the component decision should use; literals are recorded only after explicit designer approval
- `parseComponentPlan(raw)` — validates raw JSON, throws `KotikitError` on failure
- `generateComponentPlan(opts)` — pure; finds unresolved spec components, enforces variable policy, writes the selected component resolution back into the returned spec
- `writeComponentPlan(root, scope, screen | null, plan)` — async
- `readComponentPlan(root, scope, screen | null)` — async; returns `ComponentPlan | null`
- `deleteComponentPlan(root, scope, screen | null)` — async

**Design node maps, review evidence, comments, and preferences** (`src/planning/design-node-map.ts`, `src/planning/design-review.ts`, `src/planning/design-comments.ts`, `src/db/design-review-db.ts`)
- `DesignNodeMap` — persisted per-screen Figma node map written by `kotikit_design_apply_step` when the plugin reports Figma node metadata
- `readDesignNodeMap(root, scope, screen | null)` — async; returns `DesignNodeMap | null`
- `upsertDesignNodeMapEntry(root, scope, screen | null, update)` — async; merges a step's latest target node metadata into the map
- `collectDesignReviewEvidence(input)` — fetches bounded depth-1 Figma target evidence, limits returned child regions, records a versioned cache row, and returns a temporary screenshot URL when available
- `mapCommentsToDesignNodes(comments, nodeMap, options)` — pure mapper that links Figma comments by `client_meta.node_id` and leaves unmatched comments unmapped instead of guessing
- `design-review.db` — local review ledger for comment sessions, standalone design-quality reviews, shallow evidence cache rows, micro-adjustments, reply/comment outbox rows, preference candidates, and active design preferences

## How it works

All plan tracks follow the same lifecycle: a MCP tool generates and writes the plan, a second tool reads and returns it to the agent or plugin, the agent executes the steps (via codegen, component review, or bridge tool calls), and a third tool deletes it on completion when appropriate. Plans are always regenerable from the spec they reference. Code and design apply plans are disposable work queues; component plans also act as compact decision records because they update the spec's component resolution metadata.

The code plan's `steps` array maps directly to the code generation loop in `kotikit_implement_code_start`. Each step has a `kind` (which determines what the agent writes) and optional `notes` (which carry spec-derived context like "The list uses a pull-to-refresh gesture" for `compose-interactions`). The step kinds form a deliberate ordering: scaffold first, then states, then interactions, then accessibility, then responsive, then tests. This order ensures the file exists before richer behavior is layered in.

The design plan's steps use a discriminated union on `kind`. Each step kind carries exactly the fields the corresponding Figma operation needs: `define-state-frame` carries dimensions; `apply-auto-layout` carries direction, padding, and spacing; `define-layout-zone` creates a semantic auto-layout container; `place-component` carries the component name, DS key, variant overrides, semantic role, and target zone; `bind-variable` carries the variable name and the CSS property to bind it to. The bridge flow reads one step at a time, executes it in the Figma plugin, and records the result through `kotikit_design_apply_step`.

Every design plan must include a bound `FigmaDraftTarget`. The target is written to the screen spec or flow manifest by `kotikit_figma_target_bind` after validating the designer-provided page URL. `generateDesignPlan` copies that target into the disposable plan so the plugin can verify the open Figma file, switch to the exact draft page, and create or reuse a Section named `kotikit / <scope> / <screen> / <date>`. All generated frames are parented to that Section, and apply-step logging rejects nodes reported from a different file, page, or Section. This gives Professional-plan teams a branch-free safety boundary for production files.

The component plan sits before design application. When `kotikit_design_get_screen`
finds a component that is not in the synced design system, agents must ask the
designer whether to create reusable draft components or build the pieces inline
in the current page only. `generateComponentPlan` records that decision in the
screen spec so later tools do not guess. If synced variables are available, the
plan captures variable/style references for color and spacing intent. If no
usable variables exist, the planner blocks with a plugin-sync hint unless the
designer explicitly approved literal draft values. Kotikit does not create new
variables in this flow.

Design layout is intentionally generic. `generateDesignPlan` does not know about MUI, shadcn, Ant, or a copied local kit. It reads `spec.components[]`, resolves each component to a broad role such as `primary-action`, `search-input`, `filter-control`, `data-display`, `binary-control`, or `destructive-action`, and maps the role to a stable zone such as `header-actions`, `controls`, `content`, `content-toggles`, or `content-actions`. The plugin then creates those zones with Figma auto-layout and appends imported component instances into the assigned zone. This prevents common failures where unrelated controls, tables, buttons, and switches are all placed into a single stack, while keeping design-system-specific names and variants outside the core planner.

The Figma shim exposes parent node size inspection so zone frames can inherit a sensible width from their parent frame before components are appended. This is still a layout scaffold, not a visual QA engine: later review/gate passes should check overlap, clipping, minimum target size, and responsive state quality.

Apply results are recorded in two forms. The JSONL apply log stays as the append-only audit trail. The optional `design.node-map.json` is a compact, validated map from design-plan steps to Figma node IDs. The map also stores the bound target, page, and Section metadata so future comment review and refinements can prove they are operating inside the approved draft area. `kotikit_design_review_comments` uses that map with Figma comment `client_meta.node_id` values to tell the agent which planned component or frame a review comment targets. Comments without node IDs, or comments whose node IDs are outside the map, are returned as unmapped rather than inferred from text.

Review results and refinements live in `.kotikit/design-review.db`. Agents record micro-adjustments through `kotikit_design_adjustment_record` instead of expanding specs or prompts with verbose change history. Standalone design-quality reviews start with `kotikit_design_review_start`, which gathers screenshot-led, shallow, bounded Figma evidence instead of loading a whole file tree. The reviewing agent records structured findings with `kotikit_design_review_record`; Figma comments are prepared and posted only after user approval. Repeated feedback can become a design memory candidate; promoted preferences are returned by `kotikit_design_get_screen` as `designPreferences` so future design passes can apply project taste before the same comment appears again.

## When to extend it

- Adding a new code step kind (e.g. `"compose-animation"`) — extend `CodePlanStepKindSchema`, add logic to `generateCodePlan` to include it when the spec signals animation requirements, and update the MCP `implement_code_start` tool to handle the new kind.
- Adding a new design step kind (e.g. `"export-asset"`) — add a new variant to `DesignPlanStepSchema` as a discriminated union member with its own Zod schema, then handle it in the bridge apply loop and `kotikit_design_apply_step` schema. Keep file/page/Section validation transport-level; individual step handlers should not decide whether a Figma page is safe.
- Adding a new generic layout role or zone — update `layout-contract.ts`, add planner tests with minimized specs, extend `DesignPlanSchema` enums, and keep the plugin behavior semantic rather than design-system-specific.
- Adding component creation execution — extend the component plan schema only if the existing reusable/inline split cannot describe the new action, then update the Figma plugin apply flow to consume component plans and keep human review as the completion gate.
- Adding a design-to-code synchronization step — a new plan kind (e.g. `SyncPlan`) would follow the same store pattern; add `syncPlanPath` to `src/util/paths.ts` first.
- Persisting plan history instead of deleting — replace `deleteCodePlan` with an archive move to a `.kotikit/history/` directory; the reader interface stays the same.

## Related

- [spec](./spec.md) — plans reference specs by scope and screen slug; `ScreenSpec` is the primary input to both generators
- [codegen](./codegen.md) — code plan steps map to codegen operations in the implement flow
- [util](./util.md) — `codePlanPath`, `designPlanPath`, `componentPlanPath`, and `designNodeMapPath` live here
- [mcp](./mcp.md) — `kotikit_plan_code`, `kotikit_implement_code_start`, `kotikit_component_plan_create`, `kotikit_plan_design`, `kotikit_design_apply_step`, and the design review/comment/memory tools are the tool wrappers
