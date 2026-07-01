# Kotikit Migration Findings

Date: 2026-06-30

Detailed follow-up documents:

- [Kotikit Platform Flow Kit Design](docs/superpowers/specs/2026-06-30-kotikit-platform-flow-kit-design.md)
- [Kotikit Platform Flow Kit Implementation Plan](docs/superpowers/plans/2026-06-30-kotikit-platform-flow-kit.md)
- [Kotikit UX Quality Contracts Spec](docs/superpowers/specs/2026-07-01-kotikit-ux-quality-contracts.md)
- [Kotikit UX Quality Contracts Implementation Plan](docs/superpowers/plans/2026-07-01-kotikit-ux-quality-contracts.md)

This document captures a proposed complete refactor of kotikit around a smaller
designer-first core and a LangGraphJS workflow engine.

## Planned Update: UX Quality Contracts

The first migrated Figma draft exposed three graph-contract gaps that must be
closed before Kotikit is considered reliable for day-to-day designer use:

- comment review needs a durable `CommentEvidenceMap/v1` built from Figma REST
  comment snapshots plus graph apply metadata, because Figma comments are
  spatial threaded objects and the Plugin API cannot read comments;
- loading, empty, no-results, error, and permission output needs a
  `StateMatrix/v1` and state representation gate so table/list states become
  page or region states instead of loose preview cards;
- draft components need `DraftComponentLifecycle/v1` so every created draft
  component is placed in a reserved area and used as an instance in the final
  screen, or the graph fails with an orphan/overlap finding.

Reliability remains a top priority for this slice. The plan now also requires
context durability checks so graph runs resume from persisted state and
artifacts after assistant restarts, Figma apply waits, comment evidence mapping,
and approval interrupts without relying on conversation history. Raw Figma,
comment, and research payloads must be compacted into bounded contracts or
artifact refs before long-lived graph state continues.

The execution plan requires every implementation agent to follow
`docs/coding_guidelines.md`, work test-first with Bun, avoid hardcoded
screen-specific logic, prefer generic pattern-pack data, and remove stale code
only after equivalent graph-backed behavior is covered by tests. Blocking
states must expose designer-friendly recovery actions instead of raw stack
traces or graph internals.

Implementation on branch `feature/kotikit-ux-quality-contracts` adds typed
contracts and graph nodes for `StateMatrix`, `CommentEvidenceMap`, and
`DraftComponentLifecycle`. It also adds context durability and designer
recovery helpers so long-running flows can resume from compact state while
blocked states explain the problem, why it matters, and the recommended next
action in plain language.

## Implementation Update: Design-To-Code Removed From Core

Completed on branch `feature/kotikit-migration`.

The first migration slice removes design-to-code from the active kotikit core.
The runtime now exposes a design-first MCP surface only:

- removed codegen, React adapter, gate runner, scaffold, registry, audit, and
  code-plan modules;
- removed design-to-code MCP tool registration;
- removed code project settings from `.kotikit/config.json`;
- removed registry writes from design-system sync;
- removed code gate checks from config status and doctor;
- narrowed `kotikit_get_system_prompt` to the brainstorm prompt;
- updated the bundled `kotikit-auto` skill and docs to say implementation work
  is outside kotikit core for now.

Design-to-code can return later only as an isolated extension after Figma draft
creation is reliable.

## Implementation Update: Local Design-System Grounding Adapter

Completed on branch `feature/kotikit-migration`.

The migration now preserves local design-system search as the primary grounding
adapter instead of routing draft decisions through remote Figma search first:

- added a compact `src/core/adapters/design-system/local-index.ts` wrapper
  around the existing SQLite component and icon indexes;
- added SVG-on-demand icon search so default icon results stay token-cheap;
- added local variable/context helpers for future variable binding and setup
  checks;
- added an injectable `figma-remote-search` boundary that defaults to
  `not-configured`, so remote search remains optional fallback behavior;
- added graph nodes for local search, optional remote fallback, fit reports,
  missing-component decisions, and compact fit-report artifacts;
- moved `kotikit_ds_search`, `kotikit_ds_get_component`, and
  `kotikit_icons_search` onto the shared adapter while preserving their
  compatibility behavior.

Fit reports now make exact matches, substitutes, missing components, variable
gaps, and repeated-pattern coverage explicit. Missing meaningful UI parts are
not silently approved as hardcoded layers; they become component gaps for the
draft-component preflight.

## Implementation Update: UI Contract, Draft, Figma, And QA Nodes

Completed on branch `feature/kotikit-migration`.

The migration now has deterministic graph nodes for the core draft path:

- UI composition contracts require every meaningful UI part to resolve to an
  existing component, kotikit-created draft component, or explicit primitive
  exception;
- table/list repeated patterns require a component family or draft components
  for container, header row, data row, and cell coverage before screen
  composition continues;
- layout contracts require auto-layout/grid structural frames;
- variable binding plans pause when any required color, typography, radius,
  spacing, stroke, shadow, or effect token would need an unapproved literal;
- missing component planning creates and validates `Kotikit Draft Components`
  before screen composition, and composition only accepts created draft
  component keys;
- draft nodes compile high-fidelity draft plans and build official Figma MCP
  apply packets only after safe draft target and brief rules pass, and persist
  packet artifacts with component, draft-origin, variable/style, layout,
  repeated-structure, and text-transform metadata;
- Figma nodes validate file, page, kotikit Section, component refs, draft
  origins, variable/style bindings, layout settings, repeated structures, and
  text transforms before accepting apply metadata;
- the small MCP facade is wired to the graph runtime in real server sessions,
  `kotikit_start` can seed a safe Figma draft target, `kotikit_bind_figma_target`
  can patch a target into an active run, and `kotikit_record_figma_apply`
  patches graph runs with component part, draft-component origin,
  variable/style, layout, repeated-item, and text transform metadata before
  `kotikit_continue`;
- QA nodes block vertical or mirrored text, flipped transforms, negative
  dimensions, clipped text, missing component refs, detached instances, layout
  overlap, and hardcoded component imitations, and fail closed when apply
  metadata has not been recorded.

Legacy target/plan/design/apply MCP tools remain as deprecated compatibility
surfaces while the graph facade becomes the primary path. The legacy screen
reader now prefers graph apply-packet artifacts when present. Remaining legacy
target, plan, and apply tool removal stays with the facade cleanup and stale-code
removal tasks because the old compatibility handlers are intentionally thin
bridges while the graph facade owns runtime execution.

## Implementation Update: Review And Memory Graph Nodes

Completed on branch `feature/kotikit-migration`.

The migration now has graph-backed review and memory primitives:

- `review.collectEvidence` builds bounded Figma-target or comment evidence in
  graph state;
- `review.compareToDesignSystem` compares exact target regions to the local
  design-system index and emits fit reports plus review findings;
- `review.groupFindings` groups findings by theme and severity;
- `review.createRevisionPlan` saves a revision-plan artifact that preserves
  component instance keys, draft-component origins, variable/style bindings,
  and layout metadata instead of replacing reviewed UI with hardcoded layers;
- `review.askApproval` pauses before approved revisions and can also pause
  before comment posting or memory promotion, with comment-only flows able to
  skip revision-apply approval;
- `review.applyApprovedRevisions` records safe Figma draft/update metadata for
  QA only after explicit approval;
- `review.saveSession` can persist graph review sessions into the existing
  local design-review SQLite database and emit review-session artifacts;
- `review.prepareApprovedComments` consumes the explicit comment-posting
  approval and prepares pending Figma comments in the existing review DB;
- `memory.detectPreferenceCandidate`, `memory.askPromotionApproval`, and
  `memory.promotePreference` use the existing local design-review database for
  candidate detection and promotion, with explicit approval before writing
  active project memory.

The built-in `improve-existing-design` flow now routes approved revisions
directly into apply metadata and the UI quality gate instead of detouring
through screen composition nodes. Seeded design-system context is preserved
when local cache lookup has no results, so pre-collected exact matches do not
turn into false missing-component findings. The built-in `review-comments` flow
now uses separate comment posting approval, memory detection, memory approval,
and promotion nodes after comment evidence is gathered. `kotikit_start` can
seed pre-collected review evidence, comment snapshots, and design-system
context into graph state, so legacy review/comment fetch tools now return
graph-facade input payloads for new graph runs. Comment snapshots exclude
resolved comments unless `includeResolved` is requested. Legacy comment/review
report tools prefer matching graph artifacts before falling back to SQLite
reports.

## Implementation Update: Public Choreography Surface Removed

Completed on branch `feature/kotikit-migration`.

The migration now removes the stale public choreography layer and leaves the
MCP server with one graph facade plus setup, sync, local search, prompt, and
bridge support tools:

- removed the manual `src/workflow/*` router and tests;
- removed old public workflow, brainstorm/spec/flow, component-plan,
  plan-design, design-screen, design-apply, design review/comment, and design
  memory tool handlers and their stale tests;
- removed unused migration leftovers for old component-plan files,
  brainstorm-session storage, empty barrel files, and graph-review compatibility
  artifact helpers;
- updated `docs/tools.md`, module docs, scaffolded skills, MCP instructions,
  and token measurement so live guidance points to `kotikit_start`,
  `kotikit_answer`, `kotikit_continue`, `kotikit_get_artifact`, and the small
  facade;
- kept local design-system sync/search and REST-backed review evidence as
  token-efficient support adapters;
- fixed `kotikit_review_figma_target` to collect bounded Figma REST evidence
  before starting `improve-existing-design`, while the graph no longer requires
  a safe draft target before evidence collection;
- made approved review revision application pause for a safe draft target
  instead of crashing when evidence review started from an existing Figma
  target.

`bun run check:unused` now reports only broader exported-symbol/type hygiene
that is outside this stale public surface slice; it no longer reports removed
choreography files as unused.

## Implementation Update: Flow-Pack Trust Policy

Completed on branch `feature/kotikit-migration`.

The migration now has config-backed trust policy for custom flows:

- project flow packs are disabled by default;
- enabled project flows must stay inside `flowPacks.allowedProjectCapabilities`;
- extension flows require an enabled allowlist entry with source,
  `versionOrRef`, hash, and explicit capabilities;
- extension manifests fail closed on hash mismatch or capability drift;
- graph runtime compilation uses manifest-declared capabilities only, so
  custom flows cannot omit a node capability and have the runtime self-allow it;
- normal MCP sessions load the config-backed flow catalog, so trusted project
  and extension flows are visible through the facade and untrusted flows remain
  hidden;
- active graph runs persist both `manifestHash` and `graphHash`, so resumed
  runs can detect changed manifests or node versions.

This keeps built-in flows easy to use while making project and extension flow
packs opt-in, auditable, and safe for non-technical designers.

## Implementation Update: Assistant Plugin Wrappers

Completed on branch `feature/kotikit-migration`.

The migration now has thin plugin wrappers for assistant setup:

- `plugins/codex/kotikit` packages the Codex plugin manifest, `.mcp.json`, and
  a designer-facing `kotikit` skill;
- `plugins/claude/kotikit` packages the Claude plugin manifest, `.mcp.json`,
  and the same designer-facing launch guidance;
- both wrappers launch the shared agent-neutral `kotikit-mcp` server instead of
  forking assistant-specific runtime code;
- the existing `bun run scaffold:agents` source installer remains available for
  local development, source checkouts, and manual MCP setup;
- plugin setup assumes `kotikit-mcp` is available on `PATH` through an installed
  or linked kotikit package;
- getting-started docs now make plugin installation the preferred path when an
  assistant supports local plugins, while Figma PAT setup is scoped to local
  design-system sync and REST-backed design/comment review instead of draft
  creation.

This keeps setup simpler for non-technical designers while preserving the
developer-friendly source scaffold during the migration.

## Implementation Update: User And Developer Docs Rewritten

Completed on branch `feature/kotikit-migration`.

The live docs now describe kotikit as a graph-backed designer flow kit instead
of a manual choreography toolchain:

- README, architecture, workflows, tools, getting-started, Figma,
  troubleshooting, development, module docs, plugin docs, and bundled skills
  now point designers to the small graph facade and built-in flows;
- quick high-fidelity screen creation from existing design-system components is
  documented as a first-class path, while guided screen/product-flow/review
  flows remain available when more context or approval is needed;
- plugin setup is documented as the preferred assistant path when available,
  with the source scaffold kept for local development and manual MCP setup;
- Figma personal access tokens are scoped to local design-system sync/search
  and REST-backed design/comment review, not required for the draft-creation
  happy path through the official Figma assistant integration;
- local design-system search remains documented as the primary
  token-efficient grounding source;
- live documentation tests now fail if removed public choreography tools or old
  workflow-controller language reappear in user-facing docs.

## Implementation Update: Graph Smoke Coverage

Completed on branch `feature/kotikit-migration`.

The migration now has offline end-to-end smoke coverage for the built-in graph
flows:

- `create-screen` quick lane resolves missing components into draft components,
  builds composition/layout/variable contracts, emits an apply packet, accepts
  fake Figma apply metadata, verifies draft invariants, and saves QA;
- `create-screen` guided lane pauses for brief approval, saves a design-brief
  artifact, then continues through the same draft artifact chain;
- `create-product-flow` maps actor, goal, scenario, screens, and transitions,
  then marks the draft pass as incremental;
- `improve-existing-design` starts from bounded Figma evidence, preserves
  component keys and variable bindings in the revision plan, and pauses before
  applying revisions;
- `review-comments` turns fake Figma comments into a revision plan, pauses
  before posting comments, and pauses again before memory promotion.

The smoke tests use a deterministic local design-system SQLite fixture and fake
Figma target/comment/apply metadata. They do not call Figma or the network. The
new suite also exposed and fixed graph-flow gaps: guided screen approval was
missing, product-flow drafting was not marked incremental, flow-model
design-system queries could fall back to raw punctuated intent, and seeded
review finding variable bindings were not preserved.

## Implementation Update: Final Verification

Completed on branch `feature/kotikit-migration`.

Final migration verification passed for the active implementation surface:

- `bun test` passed 725 tests across 90 files;
- `bun run typecheck` passed;
- `bun run check` passed;
- `bun run measure` passed and the token table was updated for the current
  `kotikit_start` create-screen payload;
- `git diff --check` passed;
- public MCP tools were inspected and contain the graph facade plus setup,
  sync, local search, prompt, plugin-variable, and bridge support tools;
- live-doc stale-path scan shows source checkout/scaffold references only in
  compatibility, setup, or development context, and old public choreography
  tool names only in migration-plan history.

`bun run check:unused` still exits non-zero for broader exported-symbol and
exported-type hygiene that predates the final readiness pass. It reports no
unused migration-owned files; that cleanup remains intentionally separate from
the platform flow kit migration.

## Sources Reviewed During Initial Migration Analysis

Local repo:

- `README.md`
- `docs/coding_guidelines.md`
- `docs/architecture.md`
- `docs/workflows.md`
- `docs/tools.md`
- `docs/agent_workflow.md` (removed in the public choreography cleanup)
- `NEXT_STEPS.md`
- Core implementation areas under `src/mcp`, `src/workflow`, `src/spec`,
  `src/planning`, `src/sync`, `src/db`, `src/figma`, `src/mcp/bridge`, and the
  removed design-to-code modules
- Former workflow implementation: `src/workflow/workflow-schema.ts`,
  `src/workflow/workflow-next.ts`, `src/workflow/workflow-store.ts`,
  `src/workflow/workflow-snapshot.ts`, and `src/mcp/tools/workflow.ts`
  (removed after graph facade coverage landed)

LangGraphJS primary sources:

- GitHub: https://github.com/langchain-ai/langgraphjs
- Docs overview: https://docs.langchain.com/oss/javascript/langgraph/overview
- Quickstart: https://docs.langchain.com/oss/javascript/langgraph/quickstart
- Thinking in LangGraph:
  https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph
- Persistence:
  https://docs.langchain.com/oss/javascript/langgraph/persistence
- Testing: https://docs.langchain.com/oss/javascript/langgraph/test
- Human-in-the-loop and interrupts:
  https://docs.langchain.com/oss/javascript/langgraph/interrupts
- Subgraphs: https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs

## Current Kotikit Capability Map

The current README describes kotikit as a local-first, design-first MCP toolkit
for Claude Code, Codex, and other MCP clients. It can currently:

- Guide screen and flow specification.
- Store local specs under `.kotikit/specs`.
- Sync Figma design-system data into SQLite-backed local indexes.
- Search synced components and icons.
- Bind safe Figma draft pages.
- Generate official Figma MCP apply packets.
- Record Figma apply metadata for later review/comment mapping.
- Import variables through a local plugin bridge when Figma REST variables are
  unavailable.
- Review Figma comments and exact design targets.
- Store repeated feedback as local design memory.
- Scaffold assistant setup for Claude Code and Codex.

The same README also states that the project is an unstable research prototype
and may be reimagined or rewritten. That warning matches the implementation:
kotikit has a lot of useful parts, but the line of work is spread across many
tools, state files, stores, and instructions.

## What Is Wrong Structurally

The main problem is not that kotikit has no useful pieces. The problem is that
too much of the system is treated as core.

### 1. The Workflow Is A Hand-Written Router

`src/workflow/workflow-next.ts` is a manual phase router. It returns the next
allowed tools, forbidden tools, text instructions, and refs. This is useful, but
it does not make the workflow itself explicit enough.

Current consequences:

- Flow state is only partly modeled as durable state.
- Recovery depends on reconstructing meaning from scattered files.
- Human approvals are represented as booleans and events rather than first
  class pauses.
- Adding a new designer flow means editing a central decision function.
- The assistant still has to interpret broad instructions and keep the work
  line in conversation.

This explains the "doesn't hold the work line well" issue. The system has
workflow hints, but not a real workflow runtime.

### 2. The MCP Surface Was Too Large

The MCP server registers many product, setup, sync, review, bridge, planning,
and code tools. In `src/mcp/tools`, the implementation includes setup,
workflow, brainstorm, specs, flows, design-system search, sync, Figma target,
design plan, design screen apply packets, design apply audit logs, review
comments, design review, memory, plugin variables, bridge control, registry,
audit, scaffold, code planning, and React code implementation.

Before the first migration slice, that broad surface caused three problems:

- Agents must choose from too many tools.
- Some tools are phases while others are capabilities.
- Experimental implementation work lives beside the designer workflow even
  though the docs say design-to-code is disabled.

The first slice removed the implementation/scaffold/audit surface from the core.
The remaining migration should continue reducing guided work toward a smaller
graph facade.

### 3. Design Flow And Tool Flow Are Mixed Together

For a designer, the flows should be:

- Define what to design.
- Ground it in the design system.
- Create or refine the Figma draft.
- Review feedback.
- Iterate.

Today those flows are implemented as separate tool chains with assistant-facing
rules. The designer intent is not represented as a single flow model. For
example, creating a Figma draft currently spans workflow tools, spec tools,
target tools, design planning tools, component decision tools, official Figma
tools, and apply-step recording.

This is too much coordination to leave to an agent transcript.

### 4. Planning Is Too Low-Level For The Desired Product

`src/planning/design-planner.ts` produces deterministic steps such as
`define-state-frame`, `apply-auto-layout`, `define-layout-zone`, and
`place-component`. This is useful as an internal apply representation, but it
is not enough to model a designer's work.

The next core should model higher-level artifacts first:

- Design brief.
- Screen model.
- Flow model.
- Design-system fit report.
- Draft execution plan.
- Review findings.
- Revision plan.

Low-level Figma steps should be a compiled artifact, not the primary product
language.

### 5. Code Generation Was Polluting The Design Core

The original source kept substantial codegen, scaffold, registry, gate, and
React adapter code in the same package even though the README said guided
design-to-code was disabled. That made the project larger and made the core
concept harder to stabilize.

This has now been removed from the core migration path. Design-to-code can
return later as a separate extension once the design graph is stable.

### 6. Design-System Sync Is Too Much Custom Infrastructure

The current local design-system mirror is valuable because it protects token
budget and avoids loading huge Figma files into context. But it is also one of
the largest and most fragile areas: Figma API shapes, library publishing rules,
variables API plan limits, icon classification, checkpoints, normalization, and
SQLite indexes.

The next core should keep custom sync behind an adapter boundary while treating
the local cache as the default source of truth for token-efficient grounding.
Design-system access should use this order:

1. Local cache/index for component, icon, and variable grounding.
2. Optional native Figma assistant/design-system search only when the local
   cache is missing, stale, or insufficient.
3. Narrow manual component references for small projects or emergency recovery.

## Core UX/UI Designer Flows

Kotikit should start from a few repeatable UX/UI designer flows instead of a
catalog of tools.

### Flow 1: Idea To Design Brief

Goal: turn a rough product request into a clear, testable design brief.

Designer experience:

- "I need a members admin page."
- Kotikit asks targeted product/design questions.
- Kotikit captures user types, jobs, entry points, states, data needs,
  interactions, accessibility expectations, responsive behavior, and edge cases.
- Kotikit summarizes the brief for approval.

Artifacts:

- `DesignBrief`
- `ScreenModel` or `FlowModel`
- `OpenQuestions`

This replaces the current split between brainstorm sessions, screen specs, flow
manifests, and agent instructions. The old formats can be migrated, but the new
core should have one brief model.

### Flow 2: Design-System Grounding

Goal: find the closest available design-system primitives before inventing any
draft UI.

Designer experience:

- Kotikit checks whether a design system is connected.
- Kotikit searches for likely components, variables, and icons.
- Kotikit reports fit: exact match, acceptable substitute, missing piece, or
  variable gap.
- Designer decides only on meaningful gaps.

Artifacts:

- `DesignSystemInventoryRef`
- `ComponentFitReport`
- `TokenFitReport`
- `MissingComponentDecision`

This flow must be fast and searchable. It should not dump a design system into
the assistant context.

### Flow 3: Figma Draft Creation And Refinement

Goal: create an inspectable Figma draft from an approved brief and grounded
design-system choices.

Designer experience:

- Kotikit asks for or reuses a safe Figma draft target.
- Kotikit creates the draft inside a bounded section.
- Kotikit covers the important states, not just the happy path.
- Kotikit records node metadata for review and future revisions.

Artifacts:

- `FigmaTarget`
- `DraftPlan`
- `FigmaApplyPacket`
- `NodeMap`
- `ApplyReport`

Safety invariants:

- Exact target URL required.
- Target must be a draft page or draft section.
- Generated nodes stay in a kotikit-owned section.
- Applies are recorded with file, page, section, and node metadata.

### Flow 4: Comment And Design Review Loop

Goal: turn Figma feedback into actionable revisions and durable preferences.

Designer experience:

- Kotikit reviews comments or an exact Figma target.
- Kotikit groups feedback by theme and severity.
- Kotikit proposes a revision plan.
- Kotikit never posts comments or resolves threads without approval.
- Repeated feedback can become local project memory.

Artifacts:

- `ReviewSession`
- `Finding`
- `RevisionPlan`
- `ApprovedReplyOutbox`
- `DesignPreference`

The current comment review, design review, adjustment record, reply, candidate,
promotion, dismiss, update, and search tools should become one graph-backed
review flow.

### Flow 5: Multi-Screen Flow And Prototype Wiring

Goal: support the common designer task of shaping a full user flow, not just one
screen.

Designer experience:

- Kotikit asks what screens exist and how users move between them.
- Kotikit keeps shared state and cross-screen decisions explicit.
- Kotikit creates draft screens in a coherent section.
- When Figma supports it, kotikit wires prototype connections from the flow
  model.

Artifacts:

- `FlowModel`
- `ScreenModel[]`
- `Transition[]`
- `PrototypePlan`

This can be second-wave work after single-screen draft creation is stable, but
the new core should support it from the data-model level.

## What LangGraphJS Is

LangGraphJS is a TypeScript/JavaScript framework for building stateful agent
and workflow systems. The official docs describe graph workflows made of nodes
and edges, typed state, routing, persistence, human interrupts, streaming, and
durable execution. The GitHub README frames it as useful for controllable,
long-running agents with persistence and human-in-the-loop behavior, and notes
that it can be used without LangChain.

Important features for kotikit:

- `StateGraph` models workflow state and transitions explicitly.
- Nodes can be deterministic functions, LLM calls, or tool/action wrappers.
- Conditional edges can route between phases.
- Checkpoint stores persist graph state after steps.
- Interrupts pause for human input and resume from the same state.
- Time travel/checkpoint history can support debugging and rollback.
- Tests can invoke graph nodes and compiled graphs without a live Figma file.

This is a strong fit because kotikit is not primarily a chat app. It is a
durable local workflow with human approvals, external side effects, and a need
to resume cleanly after interruptions.

## Deep Investigation: Kotikit As A Flow Kit

The user-facing product should be a kit, not one fixed workflow. Kotikit should
ship a stable app/runtime plus a set of prebuilt designer flows. Advanced users
should be able to assemble their own flows from approved building blocks.

That does not mean arbitrary JSON should execute arbitrary workflow behavior.
The right model is:

> JSON defines choreography. TypeScript defines capabilities, safety, schemas,
> and side effects.

### Why Dynamic Flow Construction Makes Sense

Dynamic construction directly addresses the remaining structural problem in the
old workflow controller. Today `workflow-next.ts` is a static router over
snapshots. Adding a new designer flow means editing a central decision function,
adding new phases, and teaching agents new tool choreography. A flow manifest
model would let kotikit load a different workflow shape without widening the
core MCP surface.

This supports three product modes:

- **Prebuilt flows** — kotikit ships canonical flows such as brief, draft,
  review, and prototype wiring.
- **Project flows** — a team stores local flow definitions in its target
  workspace for its own process, such as stricter design review or a company
  onboarding pattern.
- **Extension flows** — future packages can contribute new flow definitions and
  node packs without changing the core app.

This is the lego model, but the lego pieces should be typed workflow
capabilities, not raw Figma or shell operations.

### Options Considered

#### Option A: Static Coded Graphs Only

Pros:

- Easiest first LangGraph migration.
- Strongest TypeScript guarantees.
- Simplest tests and checkpoint migration.

Cons:

- Every new flow requires code changes.
- Kotikit remains a fixed workflow product rather than a kit.
- The public MCP facade can shrink, but the core still becomes a growing set of
  hard-coded graphs.

Use this for the first proof of runtime only. Do not stop here.

#### Option B: Fully JSON-Defined Runtime

Pros:

- Maximum apparent flexibility.
- Non-developers could theoretically author complete flows.

Cons:

- Recreates a workflow interpreter inside kotikit.
- Weakens TypeScript and Zod boundary guarantees.
- Makes checkpoint compatibility and graph migrations harder.
- Creates safety risk around Figma writes, comment posting, variable fallback,
  and future extension side effects.
- Encourages low-level flow definitions that are as tangled as the current
  router.

Do not choose this. It is flexible in the wrong layer.

#### Option C: Flow Manifests Over A Typed Node Registry

This is the recommended direction.

JSON manifests define which registered nodes/subgraphs are used and how they
connect. The node registry owns executable behavior. Each registered node has a
stable key, version, input/output schema, state read/write contract,
side-effect class, interrupt contract, and test fixture.

The runtime compiles a manifest into a LangGraph `StateGraph` at flow start,
locks the manifest hash into the run, and resumes only against compatible graph
versions.

This preserves extensibility without letting custom flows bypass core safety.

### Flow Definition Shape

Example sketch:

```json
{
  "schemaVersion": 1,
  "id": "draft-creation",
  "version": "1.0.0",
  "title": "Figma Draft Creation",
  "stateSchema": "KotikitDesignState/v1",
  "start": "load-approved-brief",
  "nodes": [
    {
      "id": "load-approved-brief",
      "uses": "brief.loadApproved",
      "params": {}
    },
    {
      "id": "ensure-draft-target",
      "uses": "figma.ensureDraftTarget",
      "interrupt": "ask-user"
    },
    {
      "id": "build-fit-report",
      "uses": "designSystem.buildFitReport"
    },
    {
      "id": "build-apply-packet",
      "uses": "draft.buildFigmaApplyPacket"
    },
    {
      "id": "wait-for-apply",
      "uses": "figma.waitForApplyMetadata",
      "interrupt": "external-action"
    }
  ],
  "edges": [
    ["load-approved-brief", "ensure-draft-target"],
    ["ensure-draft-target", "build-fit-report"],
    ["build-fit-report", "build-apply-packet"],
    ["build-apply-packet", "wait-for-apply"]
  ],
  "end": ["wait-for-apply"],
  "capabilities": ["figma.read", "figma.apply", "designSystem.search"]
}
```

The manifest should stay small. It references nodes by key and configures
allowed parameters. It does not contain JavaScript, shell commands, arbitrary
tool names, or raw side-effect instructions.

### Node Registry Contract

Every node in the registry should be code-owned and versioned:

```ts
type NodeDefinition = {
  key: string;
  version: string;
  kind: "deterministic" | "llm" | "interrupt" | "external-action" | "subgraph";
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  stateReads: string[];
  stateWrites: string[];
  sideEffects: "none" | "filesystem" | "figma-read" | "figma-write" | "comments-write";
  requiredCapabilities: string[];
  run: NodeRunner;
};
```

Node keys should be semantic and coarse enough to remain stable:

- `brief.classifyIntent`
- `brief.askNextQuestion`
- `brief.summarizeForApproval`
- `brief.saveApproved`
- `designSystem.searchCandidates`
- `designSystem.buildFitReport`
- `figma.ensureDraftTarget`
- `draft.compilePlan`
- `draft.buildFigmaApplyPacket`
- `figma.recordApplyMetadata`
- `review.collectEvidence`
- `review.groupFindings`
- `review.prepareComments`
- `memory.promotePreference`

Do not expose raw Figma operations as lego pieces. The lego units should match
designer workflow capabilities, not API calls.

### Subgraphs As Larger Lego Pieces

LangGraph subgraphs are a good fit for reusable blocks that are larger than a
single node:

- `brief.approvalSubgraph`
- `designSystem.groundingSubgraph`
- `draft.safeFigmaTargetSubgraph`
- `review.commentApprovalSubgraph`
- `memory.promotionSubgraph`

Flow manifests can compose subgraphs first and individual nodes second. This
keeps custom flows understandable and avoids hundreds of tiny low-level steps.

### Runtime Compilation Model

The graph runtime should use late compile, early validate:

1. Load built-in, project, and extension flow manifests.
2. Validate each manifest with `FlowDefinitionSchema`.
3. Resolve every `uses` key against the node registry.
4. Validate node params against each node's params schema.
5. Check graph structure: start exists, edges reference known nodes, required
   capabilities are allowed, terminal nodes exist, unreachable nodes are either
   rejected or explicitly marked.
6. Compute a `graphHash` from manifest id/version, manifest content,
   state-schema version, and node key/version pairs.
7. Build and compile the LangGraph graph with the configured checkpoint store.
8. Persist every run with `flowId`, `flowVersion`, `graphHash`, node versions,
   thread id, artifacts, and approval records.

Existing runs should never silently switch to a different graph. If a project
edits a flow manifest, new runs can use the new version, but active runs must
resume against the original `graphHash` or require an explicit migration.

### Hard-Coded Safety Invariants

Some rules must not be configurable by JSON:

- Figma writes require a verified draft target.
- Generated nodes must stay in a kotikit-owned Section.
- Apply metadata must match file, page, and Section.
- Comment posting requires an explicit recorded approval.
- Memory promotion requires approval.
- Literal variable/token fallback requires approval.
- No flow manifest can invoke arbitrary shell commands or arbitrary MCP tools.
- No flow manifest can enable design-to-code in core.
- Side effects require declared capabilities and code-owned node definitions.
- Flow manifests from untrusted locations should be disabled unless explicitly
  allowed by the project.

This keeps custom flows powerful but fail-closed.

### Flow Package Layout

Recommended layout:

```text
src/core/
  graph/
    compiler.ts
    runtime.ts
    checkpoints.ts
    node-registry.ts
    flow-definition-schema.ts
  nodes/
    brief/
    design-system/
    draft/
    figma/
    review/
    memory/
  flows/
    built-in/
      brief.flow.json
      draft.flow.json
      review.flow.json
      prototype.flow.json
.kotikit/
  flows/
    project-review.flow.json
    project-dashboard.flow.json
```

Later extension packages can expose:

```text
kotikit-flow-pack/
  flows/*.flow.json
  nodes/*.ts
  package.json
```

But extension loading should come after built-in and project flows are stable.

### MCP Facade For The Kit Model

The MCP facade should remain small:

- `kotikit_flow_list`
- `kotikit_flow_validate`
- `kotikit_start` with `{ flowId, input }`
- `kotikit_continue`
- `kotikit_answer`
- `kotikit_get_artifact`
- `kotikit_search_design_system`
- `kotikit_record_figma_apply`
- `kotikit_review_figma_target`
- `kotikit_doctor`

During transition, the old `kotikit_workflow_*` tools can stay as compatibility
wrappers around the new runtime. The end state should be one facade for all
prebuilt and custom flows.

## Recommended Direction

Rebuild kotikit around a small LangGraph-powered workflow core, with MCP as a
thin transport.

The design principle should be:

> Designer flows are graphs. Figma, filesystem, SQLite, and MCP are adapters.

### New Core Architecture

```text
Assistant / MCP client
  -> small kotikit MCP facade
  -> flow catalog: built-in + project + extension manifests
  -> LangGraph workflow runtime
  -> flow compiler and typed node registry
  -> typed workflow state and checkpoints
  -> pure domain engines
  -> adapters: Figma, design-system search, local storage, git save-points
```

Recommended packages/modules:

```text
src/core/
  graph/
    compiler.ts
    runtime.ts
    state.ts
    node-registry.ts
    flow-definition-schema.ts
    interrupts.ts
    checkpoints.ts
  flows/
    built-in/
      brief.flow.json
      design-system.flow.json
      draft.flow.json
      review.flow.json
      flow.flow.json
  nodes/
    brief/
    design-system/
    draft/
    figma/
    review/
    memory/
  domain/
    brief.ts
    screen-model.ts
    flow-model.ts
    fit-report.ts
    draft-plan.ts
    review.ts
  adapters/
    figma.ts
    design-system.ts
    storage.ts
    memory.ts
    save-points.ts
src/mcp/
  facade.ts
  tools.ts
```

The existing pure engines that still earn their place can move under
`src/core/domain`, `src/core/nodes`, or `src/core/adapters`. The MCP handlers
should mostly call `listFlows`, `validateFlow`, `startFlow`, `resumeFlow`,
`answerInterrupt`, `getArtifact`, or `recordExternalAction`.

### Core Graph State

Use one shared graph state shape with flow-specific fields:

```ts
type KotikitGraphState = {
  workflowId: string;
  flowId: string;
  flowVersion: string;
  graphHash: string;
  flow: "brief" | "design-system" | "draft" | "review" | "prototype";
  status: "running" | "waiting-for-user" | "waiting-for-figma" | "blocked" | "done";
  project: ProjectRef;
  userIntent?: string;
  brief?: DesignBrief;
  screen?: ScreenModel;
  flowModel?: FlowModel;
  designSystem?: DesignSystemContext;
  fitReport?: ComponentFitReport;
  target?: FigmaTarget;
  draftPlan?: DraftPlan;
  applyReport?: ApplyReport;
  review?: ReviewSession;
  pendingQuestion?: UserQuestion;
  pendingApproval?: ApprovalRequest;
  artifacts: ArtifactRef[];
  errors: WorkflowError[];
};
```

The exact implementation should use Zod schemas at persistence and MCP
boundaries. Internally, the graph can use LangGraph state annotations. Every
persisted run should include the flow id, flow version, graph hash, and node
versions so checkpoint resume is explicit and debuggable.

### Minimal MCP Facade

The current many-tool surface should collapse into a smaller set:

- `kotikit_start`
- `kotikit_continue`
- `kotikit_answer`
- `kotikit_flow_list`
- `kotikit_flow_validate`
- `kotikit_get_artifact`
- `kotikit_list_artifacts`
- `kotikit_search_design_system`
- `kotikit_record_figma_apply`
- `kotikit_review_figma_target`
- `kotikit_doctor`

Optional extension tools can remain, but the guided designer workflow should
not expose them as the main interface.

### Built-In Flow Manifest Sketches

These are the first prebuilt flows kotikit should ship. They can begin as
coded test graphs while the runtime is introduced, then move into
`*.flow.json` manifests once the node registry and compiler are stable.

#### Brief Graph

```text
classify_intent
  -> ask_missing_brief_question
  -> record_answer
  -> check_brief_completeness
  -> summarize_for_approval
  -> save_brief
```

Interrupts:

- Ask one product/design question.
- Ask for approval of the summarized brief.

#### Design-System Graph

```text
check_design_system_source
  -> choose_search_adapter
  -> search_components
  -> search_tokens
  -> classify_fit
  -> ask_missing_component_decision
  -> save_fit_report
```

Interrupts:

- Ask for source connection only if no design-system source exists.
- Ask for missing component policy only when the fit report requires it.

#### Draft Graph

```text
load_approved_brief
  -> ensure_design_system_fit
  -> ensure_figma_target
  -> compile_draft_plan
  -> build_apply_packet
  -> wait_for_figma_apply
  -> record_apply_metadata
  -> verify_draft_invariants
  -> done
```

Interrupts:

- Ask for Figma target.
- Wait for official Figma MCP apply result.
- Ask for approval if literal tokens or inline draft components are needed.

#### Review Graph

```text
load_target_or_node_map
  -> gather_comments_or_target_evidence
  -> compare_to_design_system_if_target_review
  -> group_findings
  -> create_revision_plan
  -> ask_revision_or_comment_approval
  -> detect_preference_candidate
  -> ask_memory_approval
  -> promote_preference
  -> done
```

Interrupts:

- Ask before applying revisions.
- Ask before posting comments.
- Ask before promoting repeated feedback to memory.

## What To Drop Or Move Out Of Core

Dropped from the core migration path in the first slice:

- React implementation tools.
- React scaffold tools.
- Code plans and gates.
- Registry/search for generated code.
- Code/design audit tools.

Still drop or simplify from the old workflow shape:

- Legacy `kotikit_brainstorm_assess`.
- Tool-level workflow gating as the source of truth.
- Separate component-plan flow as a public tool.
- Public plugin bridge controls except for a narrow variables extension.
- Broad auto-commit behavior in the graph core.

Move to extensions:

- Design-to-code.
- Local Figma plugin variable import.
- Advanced design-system sync hardening.
- CI/headless audit.
- Framework adapters.

Keep in the new core:

- Local-first storage.
- Agent-neutral MCP facade.
- Safe Figma target binding.
- Design brief/spec capture.
- Design-system search abstraction.
- Draft planning and apply packet generation.
- Apply metadata and compact comment evidence recording.
- Review/comment flow.
- Local design memory.

## Proposed Migration Phases

### Phase 0: Freeze The Product Line

Goal: stop adding features to the old shape while preserving useful tests.

Actions:

- Remove current codegen/scaffold/audit tools from the core.
- List every remaining public MCP tool as core, extension, deprecated, or remove.
- Pick the first three supported designer flows: brief, draft, review.
- Define the first `FlowDefinitionSchema` and `NodeDefinition` contract on
  paper before adding runtime code.
- Decide where built-in and project flow manifests live.
- Add a compatibility note to docs that the next core is workflow-graph based.

Exit criteria:

- One migration inventory file exists.
- No new old-style tools are added.
- Dynamic flow construction has an explicit safe subset: manifests compose
  registered nodes only.

### Phase 1: Add LangGraph Runtime Behind A New Facade

Goal: introduce LangGraphJS, the flow compiler boundary, and the typed node
registry without rewriting every capability at once.

Actions:

- Add the LangGraphJS package pinned to an exact version.
- Add a local checkpoint adapter, preferably SQLite-backed.
- Implement `src/core/graph` with typed state, `FlowDefinitionSchema`,
  `NodeDefinition`, a small node registry, and test fixtures.
- Compile a minimal in-memory or fixture-defined brief graph through the same
  compiler path that later JSON manifests will use.
- Persist `flowId`, `flowVersion`, `graphHash`, and node versions with every
  run.
- Add `kotikit_start`, `kotikit_continue`, and `kotikit_answer`.
- Keep existing tools working during the transition.

Exit criteria:

- A simple brief graph can pause, resume, save state, and complete in tests.
- A flow manifest with an unknown node key, duplicate node id, missing edge
  target, or forbidden capability is rejected before execution.
- No Figma dependency is needed for the first graph tests.

### Phase 2: Replace Brainstorm/Spec With Built-In Brief Flow

Goal: make product/design discovery graph-native and manifest-driven.

Actions:

- Implement the built-in `brief.flow.json` manifest.
- Move brief behavior into registered nodes/subgraphs.
- Migrate existing screen spec and flow manifest data into the new brief model.
- Keep read compatibility for `.kotikit/specs`.
- Replace `kotikit_brainstorm_*`, `kotikit_spec_*`, and `kotikit_flow_*` in the
  guided workflow with graph facade calls.

Exit criteria:

- The designer can create and approve a brief through the new facade.
- Old specs can still be read or migrated.
- The brief flow can be validated, listed, started, interrupted, resumed, and
  completed from the small MCP facade.

### Phase 3: Replace Draft Creation With Built-In Draft Flow

Goal: make Figma draft creation resumable, manifest-driven, and fail-closed.

Actions:

- Move target binding into graph state.
- Move design-system fit checks into graph branches.
- Compile `DraftPlan` to the existing official Figma MCP apply packet.
- Record apply metadata through one graph action.
- Implement `draft.flow.json` using registered subgraphs for target safety,
  design-system grounding, component decisions, and official Figma apply.
- Keep the official Figma MCP path; do not resurrect local plugin apply.

Exit criteria:

- Draft creation can resume after every major pause.
- Target safety checks are graph invariants, not assistant instructions.
- A custom draft flow cannot remove draft-target, Section, or apply-metadata
  validation.

### Phase 4: Replace Comment/Review/Memory With Built-In Review Flow

Goal: unify feedback handling.

Actions:

- Merge comment review, standalone design review, reply preparation, reply
  posting, and memory promotion into one review graph.
- Keep explicit approval interrupts for posting and memory.
- Implement `review.flow.json` using registered review and memory nodes.
- Preserve local design-review database data through migration.

Exit criteria:

- A review session is a single durable workflow.
- Posting and memory promotion are impossible without recorded approval.

### Phase 5: Enable Project Flow Manifests

Goal: let users assemble custom flows from approved kotikit building blocks.

Actions:

- Load `.kotikit/flows/*.flow.json` after built-in flows.
- Add `kotikit_flow_list` and `kotikit_flow_validate`.
- Add friendly validation reports for unknown nodes, forbidden capabilities,
  unsafe side effects, incompatible state schemas, and graph hash mismatches.
- Allow `kotikit_start({ flowId, input })` to start either built-in or project
  flows.
- Lock active runs to a `graphHash`; changed project manifests affect new runs
  only.

Exit criteria:

- A project can define a custom flow that reorders approved brief, grounding,
  draft, and review subgraphs.
- Invalid custom flows fail at validation time with no side effects.
- Built-in flows continue to work when project flows are malformed.

### Phase 6: Remove Old Public Tool Surface

Goal: make kotikit simple and hard to misuse.

Actions:

- Remove or hide deprecated public tools.
- Move extension code into separate packages or clearly isolated modules.
- Rewrite docs around designer flows instead of tools.
- Keep `docs/tools.md` as reference, not as the main product model.

Exit criteria:

- Guided workflow uses the small MCP facade.
- Existing tests cover graph resume, interrupts, safety invariants, and adapter
  failures.

### Phase 7: Extension Flow Packs

Goal: support third-party or team-owned flow packs without compromising core
safety.

Actions:

- Define an extension package manifest for flow definitions and optional node
  packs.
- Require explicit project allowlisting before loading extension nodes.
- Version node packs separately from flow manifests.
- Keep design-to-code, plugin variable import, advanced sync hardening, and
  CI/headless audit as extension candidates, not core defaults.

Exit criteria:

- Extension flows can add capability without changing the core app.
- Extension nodes cannot run unless their side effects and capabilities are
  explicitly allowed.

## Testing Strategy

Use test-first migration slices.

Minimum graph tests:

- Parses and validates a built-in flow manifest.
- Rejects a flow manifest with unknown node keys, duplicate node ids, missing
  edge targets, unreachable required nodes, forbidden capabilities, or unsafe
  side-effect requests.
- Compiles a valid manifest into a LangGraph graph.
- Computes a deterministic graph hash from manifest content, state schema, and
  node versions.
- Starts a brief workflow and emits the first question.
- Records an answer and emits the next missing question.
- Pauses at summary approval.
- Resumes from a checkpoint after process restart.
- Refuses to resume a run when the manifest hash or node versions no longer
  match and no migration exists.
- Blocks draft creation until a safe Figma target exists.
- Blocks draft creation until component gaps are resolved.
- Records Figma apply metadata only when file/page/section match the target.
- Prevents comment posting without approval.
- Promotes design memory only after approval.

Node registry tests:

- Every registered node has a key, version, input schema, output schema,
  side-effect class, and required capabilities.
- Node params from a flow manifest are validated before runtime.
- Nodes with side effects are idempotent or explicitly marked as external
  actions requiring resume metadata.
- Subgraphs expose the same contract as nodes so they can be composed safely.

Flow catalog tests:

- Built-in flows always validate.
- Malformed project flows are reported but do not disable built-in flows.
- Two flow manifests cannot claim the same `{ id, version }` unless one is an
  explicit override in a trusted project location.
- Flow listing returns only enabled flows and includes validation errors for
  disabled flows.

Adapter tests:

- Figma adapter returns friendly failures for missing token, invalid URL, wrong
  target kind, and non-draft page.
- Design-system adapter can use a native search result or local cache result
  behind the same interface.
- Storage adapter preserves checkpoint state and artifact refs.

Migration tests:

- Existing `.kotikit/specs` screen spec becomes a new `DesignBrief`.
- Existing flow manifest becomes a new `FlowModel`.
- Existing draft target remains usable, while legacy node-map assumptions move
  into graph apply metadata and `CommentEvidenceMap` artifacts.
- Existing review memory can be read by the review graph.

## Risks

- LangGraphJS is an active dependency. Pin exact versions and isolate graph
  runtime calls behind `src/core/graph`.
- A graph can become just as tangled as the current router if nodes are too
  broad. Keep nodes small and deterministic where possible.
- A graph can also become too granular. Prefer reusable designer-capability
  subgraphs over raw API-operation nodes.
- Dynamic manifests can create a false sense of safety. The compiler must
  reject unsafe flow definitions before any node executes.
- Custom flow changes can break active runs. Persist graph hashes and node
  versions; resume only against compatible definitions.
- Untrusted extension packs can reintroduce core complexity. Load extension
  nodes only through explicit project allowlists and capability declarations.
- Figma official assistant capabilities may change. Keep Figma writes behind an
  adapter and keep official MCP as the preferred apply path.
- Do not use LangGraph as permission to add multi-agent complexity. Kotikit
  needs durable workflows first, not autonomous agent swarms.
- Checkpoint migration must be boring and explicit. Do not silently mutate old
  `.kotikit` state without backups or schema markers.

## Decision Recommendation

Use LangGraphJS, but only as the workflow spine and execution runtime.

Do not rewrite kotikit as a general agent framework. Rewrite it as a flow kit:
a stable app/runtime with prebuilt designer flows and a safe way for projects
to assemble custom flows from registered building blocks.

The prebuilt flows should be:

1. Brief.
2. Design-system grounding.
3. Draft creation/refinement.
4. Review and revision.
5. Multi-screen flow/prototype wiring.

The dynamic layer should be manifest-driven, but not behavior-defined by JSON.
Manifests select and connect registered nodes/subgraphs. Code owns every node's
behavior, schemas, side effects, and safety contract.

The core should become smaller and more extensible than the current system:

- fewer public MCP tools;
- fewer public artifacts;
- one durable workflow state model;
- one flow manifest schema;
- one typed node registry;
- built-in flow manifests for the common designer jobs;
- project flow manifests for teams that want custom process;
- explicit human interrupts;
- adapter boundaries for Figma, design-system search, storage, memory, and
  save-points;
- no design-to-code in the core until design creation is stable.

The migration should start with the brief graph because it has the least Figma
surface area and directly fixes the most important issue: holding the design
work line from user intent to approved artifact. But even that first graph
should run through the future compiler/registry boundary so kotikit does not
need a second architecture rewrite when project-defined flows arrive.

## Open Questions

- Should old `.kotikit/specs` remain the storage format for one release, or
  should migration create a new `.kotikit/artifacts` model immediately?
- Should auto-commit/save-points stay enabled by default, or become an optional
  adapter outside the core graph?
- How should kotikit detect that the local design-system cache is stale enough
  to offer optional native Figma remote search or a fresh sync?
- Should the Figma plugin remain in this repo as an extension, or move to a
  separate package after variables import is stable?
- Should the new public facade keep backwards-compatible aliases for old tools,
  or make the breaking change explicit in one major migration?
- Should project flow manifests live under `.kotikit/flows`, `kotikit.flows/`,
  or both?
- Should custom flows be editable by hand only at first, or should kotikit ship
  a guided flow-builder later?
- What trust model should extension flow packs use: local allowlist only,
  package signatures, or repository-scoped approval?
- How much prompt customization should flow manifests allow before they become
  unsafe behavior definitions instead of choreography?
