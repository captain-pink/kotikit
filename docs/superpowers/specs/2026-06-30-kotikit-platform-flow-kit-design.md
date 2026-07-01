# Kotikit Platform Flow Kit Design

Date: 2026-06-30

## Status

Draft design spec for the next kotikit migration slice.

This spec expands the migration direction from `KOTIKIT_MIGRATION.md` into a
concrete product and architecture target. It includes the separate research
agent's findings on plugin packaging, Figma MCP, MCPB/Bun binaries, schema
strategy, and flow-pack trust.

All implementation, review, and research agents operating from this spec must
follow `docs/coding_guidelines.md` throughout their work: use Bun, apply TDD for
behavior changes, keep core modules agent-neutral, and make atomic Conventional
Commits.

## Problem

Kotikit has useful capabilities, but the current shape is still too tool-heavy
and too developer-shaped for the designer product we want.

Current friction:

- The user must understand setup steps such as clone repo, install Bun,
  scaffold assistant config, add a Figma token, and restart the assistant.
- The MCP surface exposes many low-level tools, so agents must keep the work
  line in conversation.
- Workflow state is controlled by a hand-written router instead of a durable
  graph runtime.
- Briefing, design-system grounding, draft creation, review, and memory are
  split across separate tool chains.
- Design-to-code was removed, but the remaining design core still needs a
  smaller, more reliable center.
- The local design-system cache is valuable and token-efficient, but it should
  become one adapter inside a clearer flow system instead of driving the whole
  product shape.

## Product Goal

Kotikit should be a designer-first flow kit.

Designers should be able to install kotikit, start a built-in flow, answer
plain-language questions, and get a safe Figma draft or review result without
learning internal tool names, JSON schemas, graph state, or Figma API details.

Teams should later be able to create custom flows by composing approved
kotikit building blocks. Custom flows should feel like lego pieces, but those
pieces must be typed, versioned, capability-gated workflow nodes, not arbitrary
shell commands, raw Figma operations, or unrestricted MCP calls.

## Non-Goals

- Do not restore design-to-code in the core.
- Do not make arbitrary JSON execute arbitrary workflow behavior.
- Do not replace the local design-system sync/search layer yet. It remains the
  primary token-efficient design-system cache.
- Do not make Figma `search_design_system` the only grounding path. It is a
  useful secondary or validation adapter.
- Do not build a standalone desktop app before plugin and MCP packaging are
  proven.
- Do not require public extension signatures in the first migration. Use
  allowlists and hash pins first.

## Research Findings

### Plugin Packaging

One shared kotikit MCP server can power both Codex and Claude Code, but one
literal plugin package should not try to serve both.

Facts:

- Codex plugins package skills, MCP servers, and app integrations through a
  Codex plugin manifest.
- Claude Code plugins use their own plugin manifest and can bundle MCP server
  config.
- The underlying MCP server can stay agent-neutral.

Decision:

- Build one shared `kotikit-mcp` server artifact.
- Ship thin wrappers:
  - `plugins/codex/`
  - `plugins/claude/`
- Keep current scaffold support as a compatibility/development installer.

### MCPB And Bun Binaries

Compiled Bun binaries are technically plausible for local MCP distribution, but
they should not be the first production installer.

Facts:

- Bun can build standalone executables and cross-compile.
- macOS and Windows distribution still has signing, permissions, antivirus,
  architecture, and path-handling risk.

Decision:

- Phase 1 distribution uses source/npm/Bun based plugin installation.
- Compiled Bun binaries and MCPB bundles move to a later packaging slice after
  CI proves macOS and Windows MCP startup, SQLite writes, `.kotikit` writes,
  and adapter configuration.

### Figma Auth

Figma remote MCP OAuth can remove Figma PAT setup from the default draft
creation happy path, but not from every current kotikit capability.

Facts:

- Remote Figma MCP can authenticate without a personal access token.
- Current local design-system sync, comments, and some review paths use
  PAT-backed Figma REST calls.
- The user explicitly wants local design-system sync/search retained because it
  is token efficient.

Decision:

- Default onboarding should not require a PAT just to create a Figma draft.
- PAT setup remains an advanced/local-cache path for design-system sync,
  comment sync, and review capabilities until equivalent remote-MCP-backed
  cache population exists.

### Figma `search_design_system` And `use_figma`

The Figma remote MCP tools are useful but should be treated as adapters behind
kotikit invariants, not as the new source of truth.

Decision:

- Use `use_figma` or official Figma write tools for draft writes only behind
  kotikit's draft target, Section ownership, and apply metadata invariants.
- Use `search_design_system` for secondary validation, fallback discovery, or
  cache seeding experiments.
- Keep local SQLite search as the primary design-system grounding path in the
  first graph migration.

### Schema Strategy

Use Zod v4 as the schema source of truth and generate JSON Schema for external
flow manifests.

Decision:

- Upgrade from Zod v3 to Zod v4 during the graph foundation slice.
- Use Zod v4 schemas for graph state, node params, node outputs, persisted
  artifacts, and MCP boundary validation.
- Generate JSON Schema files for designer/team-facing flow manifests.
- Add tests that exported schemas do not use Zod constructs that JSON Schema
  cannot represent cleanly.
- Do not add TypeBox unless Zod v4 JSON Schema generation proves insufficient.

### Flow-Pack Trust

Use explicit allowlists plus hash/version pins now. Add signatures later when
public extension distribution exists.

Decision:

- Built-in flows are trusted by kotikit release.
- Project flows are disabled until explicitly enabled in project config.
- Extension flow packs require source, version or ref, hash, and declared
  capabilities in an allowlist.
- Active runs persist manifest hash, node versions, and graph hash.
- No custom flow can bypass hard-coded safety invariants.

## Core Design Principle

Designer flows are graphs. Figma, filesystem, SQLite, MCP, plugins, and agent
setup are adapters.

JSON flow manifests describe choreography. TypeScript/Zod node definitions
own behavior, schemas, side effects, capability declarations, and safety
invariants.

## Target Architecture

```text
Designer
  -> Codex plugin / Claude Code plugin / MCP config / future MCPB bundle
  -> small kotikit MCP facade
  -> MCP tools, resources, prompts, completions
  -> LangGraph workflow runtime
  -> flow catalog: built-in, project, extension
  -> flow compiler and typed node registry
  -> Zod v4 graph state and artifact schemas
  -> checkpoint/run store
  -> domain engines
  -> adapters:
       local design-system cache/search
       Figma remote MCP write/search
       Figma REST/PAT sync and comments
       local storage
       local design memory
       optional variable bridge
```

## Package Layout

Target source layout:

```text
src/core/
  graph/
    compiler.ts
    flow-definition-schema.ts
    graph-hash.ts
    interrupts.ts
    node-registry.ts
    runtime.ts
    state.ts
  runs/
    run-store.ts
    checkpoint-store.ts
    artifact-store.ts
  schemas/
    artifact.ts
    flow-definition.ts
    graph-state.ts
    json-schema-export.ts
  domain/
    brief.ts
    screen-model.ts
    flow-model.ts
    fit-report.ts
    draft-plan.ts
    review.ts
  nodes/
    brief/
    design-system/
    draft/
    figma/
    review/
    memory/
  adapters/
    design-system/
      local-index.ts
      figma-remote-search.ts
    figma/
      target.ts
      apply-packet.ts
      remote-mcp.ts
      rest.ts
    storage/
    memory/
  flows/
    built-in/
      first-run.flow.json
      create-screen.flow.json
      create-product-flow.flow.json
      improve-existing-design.flow.json
      review-comments.flow.json
      sync-design-system.flow.json
      resolve-missing-components.flow.json
src/mcp/
  facade/
    tools.ts
    resources.ts
    prompts.ts
    completions.ts
  server.ts
plugins/
  codex/
  claude/
schemas/
  kotikit-flow.schema.json
  kotikit-artifact.schema.json
```

Existing modules are migrated, not blindly deleted:

- `src/sync/*` remains the local design-system cache engine and moves behind
  `src/core/adapters/design-system/local-index.ts` over time.
- `src/planning/*` remains the draft-plan and review domain engine until graph
  nodes replace public tool choreography.
- `src/spec/*` is migrated into brief/screen/flow domain models.
- `src/workflow/*` is removed only after graph-backed facade tools cover its
  supported flows.
- MCP tool files become either facade tools, compatibility wrappers, or deleted
  stale public surfaces.

## Flow Catalog

Flow manifests are loaded from three sources:

1. Built-in flows shipped with kotikit.
2. Project flows under `.kotikit/flows/*.flow.json`, disabled until enabled.
3. Extension flow packs, disabled until allowlisted with hash/version pins.

Every resolved flow has:

- `schemaVersion`
- `id`
- `version`
- `title`
- `description`
- `stateSchema`
- `requiredCapabilities`
- `nodes`
- `edges`
- `start`
- `end`
- `safetyProfile`

Example shape:

```json
{
  "schemaVersion": 1,
  "id": "create-screen",
  "version": "1.0.0",
  "title": "Create Screen Draft",
  "stateSchema": "KotikitGraphState/v1",
  "requiredCapabilities": ["designSystem.search.local", "figma.write.remote"],
  "start": "capture-minimal-intent",
  "nodes": [
    {
      "id": "capture-minimal-intent",
      "uses": "brief.captureMinimalIntent",
      "params": { "lane": "quick-high-fidelity" }
    },
    {
      "id": "infer-screen-blueprint",
      "uses": "brief.inferScreenBlueprint",
      "params": {}
    },
    {
      "id": "ensure-design-system-fit",
      "uses": "designSystem.buildFitReport",
      "params": { "preferredSource": "local-index" }
    },
    {
      "id": "ensure-figma-target",
      "uses": "figma.ensureDraftTarget",
      "interrupt": "ask-user"
    },
    {
      "id": "compile-high-fidelity-draft",
      "uses": "draft.compileHighFidelityDraft"
    },
    {
      "id": "wait-for-apply",
      "uses": "figma.waitForApplyMetadata",
      "interrupt": "external-action"
    },
    {
      "id": "post-draft-qa",
      "uses": "qa.postDraftQa"
    }
  ],
  "edges": [
    ["capture-minimal-intent", "infer-screen-blueprint"],
    ["infer-screen-blueprint", "ensure-design-system-fit"],
    ["ensure-design-system-fit", "ensure-figma-target"],
    ["ensure-figma-target", "compile-high-fidelity-draft"],
    ["compile-high-fidelity-draft", "wait-for-apply"],
    ["wait-for-apply", "post-draft-qa"]
  ],
  "end": ["post-draft-qa"]
}
```

## Node Registry

Every executable node is code-owned and versioned:

```ts
type NodeDefinition = {
  key: string;
  version: string;
  kind: "deterministic" | "llm" | "interrupt" | "external-action" | "subgraph";
  paramsSchema: z.ZodType;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  stateReads: string[];
  stateWrites: string[];
  sideEffects:
    | "none"
    | "filesystem"
    | "sqlite"
    | "figma-read"
    | "figma-write"
    | "comments-write";
  requiredCapabilities: string[];
  run: NodeRunner;
};
```

Required registry behavior:

- Unknown node keys fail validation before graph execution.
- Node params are validated before compile.
- Node versions are included in `graphHash`.
- Side effects require explicit capabilities.
- Manifest-declared capabilities cannot exceed project/extension allowlists.
- Nodes are coarse workflow capabilities, not raw Figma API calls.

## Runtime Compilation

The runtime uses late compile, early validate:

1. Load built-in, project, and extension manifests.
2. Parse manifests with Zod v4.
3. Validate structure: start, end, edges, duplicate ids, unreachable nodes,
   cycles where disallowed, and missing node references.
4. Resolve `uses` keys against the node registry.
5. Validate node params against each node's params schema.
6. Validate required capabilities against trust policy.
7. Compute `graphHash` from manifest content, flow id/version, state schema
   version, node keys, node versions, and safety profile.
8. Compile a LangGraph graph.
9. Persist run metadata before executing the first node.
10. Resume active runs only against the original compatible `graphHash`.

## Graph State

The persisted graph state is Zod-owned and versioned.

```ts
type KotikitGraphState = {
  schemaVersion: "KotikitGraphState/v1";
  runId: string;
  flowId: string;
  flowVersion: string;
  graphHash: string;
  status:
    | "running"
    | "waiting-for-user"
    | "waiting-for-figma"
    | "blocked"
    | "done";
  project: ProjectRef;
  userIntent?: string;
  brief?: DesignBrief;
  screen?: ScreenModel;
  flowModel?: FlowModel;
  designSystem?: DesignSystemContext;
  fitReport?: ComponentFitReport;
  figmaTarget?: FigmaTarget;
  uiComposition?: UICompositionContract;
  layoutContract?: LayoutContract;
  variableBindingPlan?: VariableBindingPlan;
  draftComponentPlan?: DraftComponentPlan;
  draftPlan?: DraftPlan;
  applyReport?: ApplyReport;
  uiQualityGate?: UIQualityGateReport;
  review?: ReviewSession;
  pendingQuestion?: UserQuestion;
  pendingApproval?: ApprovalRequest;
  artifacts: ArtifactRef[];
  errors: WorkflowError[];
};
```

## Artifact Model

Artifacts are first-class. They are stored locally and exposed through MCP
resources.

Initial artifact types:

- `design-brief`
- `screen-model`
- `flow-model`
- `design-system-fit-report`
- `figma-target`
- `ui-composition-contract`
- `layout-contract`
- `variable-binding-plan`
- `draft-component-plan`
- `draft-plan`
- `figma-apply-packet`
- `figma-apply-report`
- `ui-quality-gate-report`
- `review-session`
- `revision-plan`
- `design-memory-candidate`

Artifact requirements:

- Stable id.
- Run id.
- Type.
- Schema version.
- Created/updated timestamps.
- Source node key/version.
- JSON payload validated by Zod.
- Optional filesystem path for large bodies.

## UI Quality Contract

Kotikit must compile polished Figma UI from a strict composition contract. It
must not "draw a page" by loosely placing text, rectangles, and guessed layers.

The draft path is valid only when these artifacts exist:

- `UICompositionContract` - every intended UI part maps to an existing
  design-system component key, a kotikit draft component, or an approved
  primitive.
- `LayoutContract` - auto-layout or grid hierarchy, sizing behavior, spacing,
  table/list/grid structure, and responsive expectations.
- `VariableBindingPlan` - variable/style bindings for colors, text styles,
  spacing, radius, strokes, shadows, and approved fallback literals.
- `DraftComponentPlan` - missing components to create in the active draft page
  before composing screens.
- `UIQualityGateReport` - post-apply validation for structure, component usage,
  variables, layout, and text integrity.

Hard UI rules:

- **Component-first:** every meaningful UI element must use an existing
  design-system component key or a kotikit-created draft component instance.
  Approved primitives are allowed only for layout containers, backgrounds,
  dividers, simple decorative shapes, or explicitly approved exceptions.
- **No partial imitation:** if a component pattern is selected, kotikit must use
  component instances and component properties consistently. It must not mix one
  component instance with loose hardcoded text/rectangle copies of the same
  pattern.
- **Missing component preflight:** if no matching component exists, kotikit
  creates the required draft component in a `Kotikit Draft Components` section
  on the current draft page, validates it, then uses instances of that draft
  component in the screen or flow.
- **Auto-layout mandatory:** generated frames, sections, cards, rows, tables,
  lists, forms, toolbars, tabs, filters, sidebars, and repeated items must use
  auto layout or grid layout. Manual absolute positioning is allowed only for
  top-level screen placement and explicitly approved exceptions.
- **Variables/styles mandatory:** colors, typography, spacing, radius, strokes,
  shadows, and effects come from synced variables/styles when available.
  Literal values require a recorded approval or a draft variable.
- **Text integrity gate:** generated text nodes must have normal horizontal
  reading direction, rotation `0`, no negative/flipped transform, sane
  dimensions, no clipped words, and no vertical or mirrored text.
- **Table/list contract:** tables and dense lists must be built from an
  existing table/list component family when available. Otherwise kotikit creates
  draft components for the table container, header row, data row, cell, and
  relevant states before composing the screen.
- **State and QA coverage:** high-fidelity screens must include relevant
  default, empty, loading, error, permission, and edge states when the screen
  type implies them. The post-draft QA gate blocks completion on overlap,
  detached instances, hardcoded component imitations, missing variables, broken
  text orientation, or mismatched Figma target metadata.

These rules are enforced by graph nodes, not only prompt instructions. A flow
can move quickly, but it cannot skip component resolution, layout contract,
variable binding, draft-component preflight, or post-write QA when the output is
a high-fidelity Figma draft.

## MCP Facade

The guided designer workflow should expose a small facade:

- `kotikit_flow_list`
- `kotikit_flow_validate`
- `kotikit_start`
- `kotikit_continue`
- `kotikit_answer`
- `kotikit_get_artifact`
- `kotikit_list_artifacts`
- `kotikit_search_design_system`
- `kotikit_record_figma_apply`
- `kotikit_review_figma_target`
- `kotikit_doctor`

MCP resources:

- `kotikit://runs/{runId}`
- `kotikit://runs/{runId}/state`
- `kotikit://artifacts/{artifactId}`
- `kotikit://flows/{flowId}`
- `kotikit://design-system/components/{componentId}`
- `kotikit://design-memory/{preferenceId}`

MCP prompts:

- `kotikit.first_run`
- `kotikit.quick_screen_draft`
- `kotikit.create_screen`
- `kotikit.create_product_flow`
- `kotikit.improve_existing_design`
- `kotikit.review_comments`
- `kotikit.create_brief`
- `kotikit.create_figma_draft`
- `kotikit.review_figma_design`
- `kotikit.sync_design_system`

MCP completions:

- Flow ids.
- Run ids.
- Artifact ids.
- Known spec or screen names.
- Design-system component refs.

Compatibility wrappers:

- Old public tools can remain temporarily as wrappers around graph facade calls
  during migration.
- Wrappers should be marked deprecated in docs and MCP descriptions.
- The end state is the small facade plus explicit extension tools.

## Designer Flow UX

Built-in flows should be goal-shaped, but they must not force designers through
one rigid process. Kotikit should adapt to the user's intent, available inputs,
and risk level.

Each user-facing flow supports lanes:

- **Quick lane** - ask only safety-critical or truly blocking questions. Use
  reasonable defaults, local design-system cache, existing artifacts, and
  reversible draft assumptions.
- **Guided lane** - ask product/design questions one at a time when the request
  is ambiguous, novel, or high impact.
- **Deep lane** - add journey, state matrix, responsive, accessibility, and
  edge-case coverage when the user asks for a full product flow or complete
  exploration.
- **Repair lane** - start from an existing Figma target, comments, or a review
  finding and produce revisions instead of a new draft.

Every flow can skip subgraphs when the required artifact already exists. For
example, a designer who has an approved brief can start directly at draft
creation, and a designer who asks for a fast high-fidelity screen from existing
components can bypass long discovery and use a compact assumptions artifact
instead of a blocking brief approval.

Hard approvals remain mandatory only for safety-sensitive moments:

- binding or changing a Figma target;
- literal token/value fallback;
- missing component strategy;
- posting comments;
- promoting design memory;
- enabling project or extension flow packs.

This gives non-technical users a clear product while preserving expert speed.

## Built-In Designer Flows

### Flow 1: First Run / Setup

Goal: make the designer's first action conversational.

Happy path:

1. Designer installs a Codex plugin, Claude Code plugin, or MCP config.
2. Designer invokes kotikit.
3. Kotikit runs doctor.
4. Kotikit detects whether local cache is configured.
5. Kotikit explains the minimum next step in plain language.
6. Draft creation can proceed with Figma remote MCP OAuth.
7. PAT setup is offered only when the user wants local sync/search or REST
   comment review.

### Flow 2: Create Screen Draft

Goal: create or refine one high-fidelity screen from intent, existing
artifacts, and the local design-system cache.

Lanes:

- **Quick high-fidelity** - for requests like "make a billing settings screen
  from our design system." Requires only enough intent to infer the screen,
  local design-system grounding, and a safe Figma target. It records assumptions
  but does not block on a full brief approval unless ambiguity is high.
- **Guided screen** - asks product/design questions when the request lacks
  users, jobs, data, states, or interaction constraints.
- **Deep screen** - adds state matrix, responsive behavior, accessibility, and
  edge-case coverage before draft creation.

Quick graph shape:

```text
capture_minimal_intent
  -> infer_screen_blueprint
  -> search_local_design_system
  -> classify_fit
  -> resolve_missing_components
  -> build_ui_composition_contract
  -> build_layout_contract
  -> build_variable_binding_plan
  -> ensure_figma_target
  -> compile_high_fidelity_draft
  -> create_missing_draft_components
  -> wait_for_figma_apply
  -> verify_draft_invariants
  -> run_ui_quality_gate
  -> post_draft_qa
```

Guided graph shape:

```text
classify_intent
  -> ask_missing_question
  -> record_answer
  -> check_completeness
  -> summarize_for_approval
  -> save_brief_artifact
  -> search_local_design_system
  -> classify_fit
  -> resolve_missing_components
  -> build_ui_composition_contract
  -> build_layout_contract
  -> build_variable_binding_plan
  -> ensure_figma_target
  -> compile_high_fidelity_draft
  -> create_missing_draft_components
  -> wait_for_figma_apply
  -> verify_draft_invariants
  -> run_ui_quality_gate
  -> post_draft_qa
```

Interrupts:

- Quick lane asks only for Figma target, design-system source when missing, or
  a missing-component/literal-token decision.
- Guided/deep lanes ask one design/product question at a time.
- Final brief approval is required only for guided/deep lanes or when quick
  lane confidence is low.
- Missing component approval happens before screen composition, because draft
  components must be created first and then instantiated.

### Flow 3: Create Product Flow

Goal: shape a multi-screen UX flow and create coherent Figma drafts.

Use for onboarding, checkout, invite flows, settings flows, admin workflows, or
any task where navigation and user progression matter.

Graph shape:

```text
capture_goal_actor_scenario
  -> map_user_flow
  -> identify_screens_and_states
  -> ground_shared_design_system
  -> resolve_shared_missing_components
  -> create_shared_draft_components
  -> draft_screens_incrementally
  -> run_flow_level_ui_quality_gate
  -> optional_prototype_plan
  -> flow_level_qa
```

Interrupts:

- Ask only for missing actor, goal, scenario, or screen decisions.
- Prototype wiring is optional and capability-gated.

### Flow 4: Improve Existing Figma Design

Goal: take an existing Figma target and make it better without starting from
scratch.

Use for "review this screen and improve it", "make this more usable", "bring
this closer to our design system", or "polish this draft".

Graph shape:

```text
load_figma_target
  -> gather_bounded_evidence
  -> compare_to_design_system
  -> run_design_quality_review
  -> create_revision_plan
  -> rebuild_ui_contract_for_revisions
  -> ask_revision_approval
  -> apply_approved_revisions
  -> run_ui_quality_gate
  -> post_revision_qa
```

Interrupts:

- Ask before applying revisions.
- Ask before literal token fallback or missing-component creation.

### Flow 5: Review Comments And Iterate

Goal: turn Figma comments or review notes into grouped decisions, revisions,
approved replies, and optional design memory.

Graph shape:

```text
load_target_or_node_map
  -> gather_comments_or_target_evidence
  -> group_findings
  -> create_revision_plan
  -> ask_reply_or_memory_approval
  -> record_preferences
  -> done
```

Hard invariants:

- Comment posting requires explicit recorded approval.
- Memory promotion requires explicit recorded approval.
- Review evidence is bounded and summarized before reaching the assistant.

### Flow 6: Sync / Refresh Design System

Goal: keep kotikit's token-efficient local design-system cache healthy.

Primary adapter:

- Local SQLite component/icon/variable search from `design-system/`.

Secondary adapters:

- Figma remote MCP `search_design_system` for validation, cache gap checks, or
  fallback discovery.
- Manual narrow references for small projects.

Graph shape:

```text
check_local_cache
  -> configure_figma_sources_if_needed
  -> sync_or_refresh_cache
  -> index_health_check
  -> search_smoke_test
  -> report_component_token_icon_gaps
```

PAT setup belongs here and in REST-backed comment/review paths. It should not
block the draft-creation happy path when Figma remote MCP is available.

### Flow 7: Resolve Missing Components

Goal: make missing design-system pieces explicit instead of silently inventing
them during draft creation.

Use when draft creation finds a component gap, when a designer asks "what is
missing from this design system?", or when a team wants draft component
candidates.

Graph shape:

```text
load_fit_report
  -> search_substitutes
  -> classify_gap
  -> propose_inline_or_draft_component_strategy
  -> ask_strategy_approval
  -> create_draft_components_if_needed
  -> validate_draft_components
  -> save_missing_component_decision
```

## Internal Reusable Subgraphs

The user-facing flows above reuse smaller internal subgraphs. These are not the
main product menu:

- `briefing`
- `screen-blueprint`
- `journey-map`
- `design-system-grounding`
- `ui-composition-contract`
- `draft-component-preflight`
- `draft-creation`
- `ui-quality-gate`
- `post-draft-qa`
- `design-review`
- `comment-iteration`
- `memory-promotion`
- `safe-figma-target`

This keeps the public UX simple while preserving a composable graph runtime.

## Design-System Grounding Subgraph

Goal: ground draft decisions in the real design system without wasting tokens.

Graph shape:

```text
check_local_cache
  -> search_local_components
  -> search_local_tokens
  -> optional_remote_validation
  -> classify_fit
  -> ask_missing_component_decision
  -> create_draft_components_if_needed
  -> validate_component_keys
  -> save_fit_report
```

## Figma Draft Creation Subgraph

Goal: create or refine a bounded Figma draft from an approved brief, quick
screen blueprint, or product-flow screen model. It consumes a UI composition
contract, layout contract, variable binding plan, and draft component plan.

Graph shape:

```text
ensure_design_system_fit
  -> ensure_ui_composition_contract
  -> ensure_layout_contract
  -> ensure_variable_binding_plan
  -> create_missing_draft_components
  -> ensure_figma_target
  -> compile_draft_plan
  -> build_apply_packet
  -> wait_for_figma_apply
  -> record_apply_metadata
  -> verify_draft_invariants
  -> run_ui_quality_gate
  -> save_apply_report
```

Hard invariants:

- Figma writes require a verified draft target.
- Generated nodes stay in a kotikit-owned Section.
- Apply metadata must match file, page, and Section.
- Meaningful UI parts must be component instances or approved primitives.
- Missing components must be created and validated before screen composition.
- Component keys and instance metadata must be recorded for repeated UI parts.
- Auto layout or grid is required for generated structural UI.
- Literal token fallback requires approval.
- Missing component strategy requires approval.
- Text orientation, transforms, clipping, and layout overlap are checked after
  apply.

## Trust Model

Built-in flows:

- Trusted by the installed kotikit release.
- Can use built-in node registry capabilities.

Project flows:

- Stored under `.kotikit/flows`.
- Disabled until enabled in `.kotikit/config.json`.
- Cannot introduce new executable behavior.
- Can compose only allowed registered nodes/subgraphs.

Extension flow packs:

- Require explicit allowlist entries.
- Allowlist entry includes source, package id, version/ref, content hash, and
  declared capabilities.
- Extension nodes are disabled in the first implementation wave unless a later
  spec explicitly enables them.

Active runs:

- Persist flow id, flow version, manifest hash, graph hash, node versions,
  state schema version, and safety profile.
- Never silently switch graph versions.

## Packaging UX

### Phase 1 Packaging

- Keep `bun run scaffold:agents` for developers and compatibility.
- Add Codex plugin wrapper for installable Codex workflow.
- Add Claude Code plugin wrapper for installable Claude workflow.
- Shared server remains `kotikit-mcp`.
- Default setup does not require PAT for draft creation.

### Phase 2 Packaging

- Add npm/Bun package distribution.
- Add CI smoke tests for plugin startup.
- Add platform-specific compiled binaries only after source distribution works.

### Phase 3 Packaging

- Add MCPB bundles if binary distribution is reliable.
- Add signing/notarization and Windows smoke tests before recommending MCPB to
  non-technical designers.

## Migration Strategy

Migrate by replacing public choreography flow-by-flow.

Order:

1. Add Zod v4, schema export, graph foundation, and run store.
2. Add a minimal graph facade while old tools still work.
3. Replace brainstorm/spec creation with the brief graph.
4. Wrap local design-system search as the primary grounding adapter.
5. Replace draft creation with the draft graph.
6. Replace review/comment/memory choreography with the review graph.
7. Add plugin wrappers.
8. Update docs to the new designer UX.
9. Remove stale old router/tool code that has graph-backed replacements.

## Stale Code Policy

Remove code only after a graph-backed path covers the behavior and tests pass.

Expected removals by the end state:

- `src/workflow/*` manual router.
- Public old workflow tools.
- Public brainstorm/spec/flow choreography tools once brief graph replaces
  them.
- Public component-plan tool once missing-component decisions are graph
  interrupts.
- Public design-plan and design-screen apply-packet tools once draft graph
  exposes artifacts.
- Public review/comment/memory tool sprawl once review graph replaces it.
- Setup scaffold paths that are superseded by plugins, after compatibility
  docs declare the old path deprecated.

Expected retained or adapted code:

- `src/sync/*` local design-system sync/search.
- `src/db/*` SQLite helpers and design-review store, migrated where useful.
- `src/figma/*` safe target validation.
- `src/planning/*` draft-plan and review engines, migrated under core domain.
- Optional plugin variable bridge as an extension path.

## Testing Strategy

Tests must make the graph core reliable before Figma integration is involved.

Required test levels:

- Schema tests for Zod v4 parse failures and JSON Schema export.
- Compiler tests for invalid manifests, duplicate nodes, missing edges,
  unknown node keys, forbidden capabilities, unreachable nodes, and hash
  stability.
- Runtime tests for pause, resume, answer, checkpoint, artifact persistence,
  and graphHash mismatch behavior.
- Node tests for pure domain behavior.
- Adapter tests for local design-system search using fixtures.
- MCP facade tests for compact, friendly tool outputs.
- Compatibility wrapper tests while old tools still exist.
- Packaging tests for Codex/Claude plugin manifests.
- End-to-end smoke tests using fake Figma adapters before live Figma.

## Documentation Strategy

Docs should shift from tool catalog to designer flows.

Update:

- `README.md`
- `docs/getting-started.md`
- `docs/workflows.md`
- `docs/architecture.md`
- `docs/tools.md`
- `docs/figma.md`
- `docs/troubleshooting.md`
- `docs/development.md`
- `docs/modules/*`
- `.agents/skills/kotikit-auto/SKILL.md`
- `.agents/skills/kotikit-design-review/SKILL.md`

Docs should make clear:

- Design-to-code is out of core.
- Local design-system cache remains supported.
- Figma remote MCP OAuth is the default draft creation path.
- PAT is advanced setup for local sync/search and REST-backed review.
- Custom flow manifests are advanced and capability-gated.

## Risks

- LangGraphJS integration could pull in more abstraction than needed. Mitigate
  by starting with a minimal brief graph and fixture tests.
- Plugin packaging could become product-specific. Mitigate by keeping wrappers
  thin and the MCP server agent-neutral.
- Zod v4 JSON Schema export could fail for advanced schemas. Mitigate by
  banning constructs that JSON Schema cannot represent in exported schemas.
- Figma remote MCP behavior could change. Mitigate by keeping all Figma writes
  behind kotikit safety invariants and retaining local cache/search.
- UI quality gates could become too strict and slow quick flows. Mitigate by
  allowing approved primitives and explicit exceptions while keeping component,
  auto-layout, variable, and text-integrity rules mandatory for high-fidelity
  output.
- Stale wrappers could linger. Mitigate with a deprecation inventory and
  removal tasks tied to graph-backed replacements.

## Source Notes

Sources reviewed directly or through the research sub-agent:

- `KOTIKIT_MIGRATION.md`
- `README.md`
- `docs/architecture.md`
- `docs/tools.md`
- `docs/workflows.md`
- `docs/getting-started.md`
- `docs/coding_guidelines.md`
- Codex plugins: https://developers.openai.com/codex/plugins
- Codex plugin build docs: https://developers.openai.com/codex/plugins/build
- Codex MCP docs: https://developers.openai.com/codex/mcp
- Claude Code plugin docs: https://code.claude.com/docs/en/plugins-reference
- Claude plugin marketplace docs:
  https://code.claude.com/docs/en/plugin-marketplaces
- Figma MCP docs: https://developers.figma.com/docs/figma-mcp-server/
- Figma remote MCP install:
  https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
- Figma MCP tools:
  https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
- Figma MCP rate limits:
  https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/
- Figma FrameNode API:
  https://developers.figma.com/docs/plugins/api/FrameNode/
- Figma InstanceNode API:
  https://developers.figma.com/docs/plugins/api/InstanceNode/
- Bun executables: https://bun.sh/docs/bundler/executables
- Zod JSON Schema: https://zod.dev/json-schema
- MCP security:
  https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- MCP server tools:
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
