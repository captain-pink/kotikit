# Planning

## What it does

The planning module manages regenerable legacy design plans that guide an agent
through Figma design application. Missing design-system components now move
through graph `draftComponentPlan` state and artifacts instead of the old
standalone component-plan JSON files. Disposable design plans are written next
to their spec files inside `.kotikit/specs/<scope>/` and can be regenerated if
needed.

Design-to-code plans are not part of the core planning module.

## Public surface

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

**Review evidence and preferences** (`src/planning/design-review.ts`, `src/db/design-review-db.ts`)
- `collectDesignReviewEvidence(input)` — fetches bounded depth-1 Figma target evidence, limits returned child regions, records a versioned cache row, and returns a temporary screenshot URL when available
- Comment review now uses graph `CommentEvidenceMap` artifacts built from Figma REST comment snapshots plus graph apply metadata; unmatched comments remain unmapped instead of being guessed
- `design-review.db` — local review ledger for comment sessions, standalone design-quality reviews, shallow evidence cache rows, micro-adjustments, reply/comment outbox rows, preference candidates, and active design preferences

## How it works

Design plans are disposable work queues generated from the spec they reference.
Graph flows expose the current planning state as artifacts, then the agent
executes Figma work through the official Figma MCP path and records results
through graph apply metadata.

The design plan's steps use a discriminated union on `kind`. Each step kind carries exactly the fields the corresponding Figma operation needs: `define-state-frame` carries dimensions; `apply-auto-layout` carries direction, padding, and spacing; `define-layout-zone` creates a semantic auto-layout container; `place-component` carries the component name, DS key, variant overrides, semantic role, and target zone; `bind-variable` carries the variable name and the CSS property to bind it to. The agent reads the apply packet, executes the work through the official Figma MCP integration, and records the result through graph apply metadata.

Every design plan must include a bound `FigmaDraftTarget`. Graph target nodes validate the designer-provided page URL before draft planning begins. `generateDesignPlan` copies that target into the disposable plan so the agent can verify the official Figma write target, switch to the exact draft page, and create or reuse a Section named `kotikit / <scope> / <screen> / <date>`. All generated frames are parented to that Section, and graph apply metadata rejects nodes reported from a different file, page, or Section. This gives Professional-plan teams a branch-free safety boundary for production files.

Missing reusable parts should not block the first visible screen. When local
design-system search cannot resolve a needed part, the create-screen path keeps
that structure as screen-draft work, composes the screen with auto layout, and
asks about draft-component extraction only after the design is visible. Literal
values still require explicit designer approval. Kotikit does not create new
variables in this flow.

Design layout is intentionally generic. `generateDesignPlan` does not know about MUI, shadcn, Ant, or a copied local kit. It reads `spec.components[]`, resolves each component to a broad role such as `primary-action`, `search-input`, `filter-control`, `data-display`, `binary-control`, or `destructive-action`, and maps the role to a stable zone such as `header-actions`, `controls`, `content`, `content-toggles`, or `content-actions`. The official Figma apply path then creates those zones with Figma auto-layout and appends imported component instances into the assigned zone. This prevents common failures where unrelated controls, tables, buttons, and switches are all placed into a single stack, while keeping design-system-specific names and variants outside the core planner.

The apply packet tells the assistant to inspect parent sizing through the
official Figma integration before placing zone frames, then report the created
node IDs back through graph apply metadata. This is still a layout
scaffold, not a visual QA engine: later review/gate passes should check
overlap, clipping, minimum target size, and responsive state quality.

Apply results are recorded through graph apply metadata and artifacts. The
metadata stores file, page, Section, component, draft-origin, variable, layout,
repeated-structure, and generated node details so review and comment flows can
prove they are operating inside the approved draft area. Graph comment flows
combine that apply metadata with Figma REST `client_meta.node_id` values to
build `CommentEvidenceMap` artifacts. Comments without node IDs, or comments
whose node IDs are outside the known metadata, are returned as unmapped rather
than inferred from text.

Review results and refinements live in `.kotikit/design-review.db`. Graph review
nodes record micro-adjustments instead of expanding specs or prompts with
verbose change history. Standalone design-quality reviews gather screenshot-led,
shallow, bounded Figma evidence instead of loading a whole file tree. Figma
comments are prepared and posted only after user approval. Repeated feedback can
become a design memory candidate; promoted preferences are returned by graph
memory nodes so future design passes can apply project taste before the same
comment appears again.

## When to extend it

- Adding a new design step kind (e.g. `"export-asset"`) — add a new variant to `DesignPlanStepSchema` as a discriminated union member with its own Zod schema, then update the official Figma apply guidance and graph apply metadata schema. Keep file/page/Section validation transport-level; individual step handlers should not decide whether a Figma page is safe.
- Adding a new generic layout role or zone — update `layout-contract.ts`, add planner tests with minimized specs, extend `DesignPlanSchema` enums, and keep the apply guidance semantic rather than design-system-specific.
- Adding component creation execution — extend the graph
  `draftComponentPlan` artifact only if the existing reusable/inline split
  cannot describe the new action, then update the official Figma apply flow and
  keep human review as the completion gate.
- Persisting plan history instead of replacing plans — add an archive move to a `.kotikit/history/` directory; the reader interface stays the same.

## Related

- [spec](./spec.md) — plans reference specs by scope and screen slug; `ScreenSpec` is the primary input to both generators
- [util](./util.md) — `designPlanPath` and `designApplyLogPath` live here
- [mcp](./mcp.md) — graph facade tools expose planning, review, and memory
  outputs as artifacts instead of public choreography wrappers
