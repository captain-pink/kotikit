# Kotikit Migration Findings

Date: 2026-06-30

This document captures a proposed complete refactor of kotikit around a smaller
designer-first core and a LangGraphJS workflow engine.

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

## Sources Reviewed

Local repo:

- `README.md`
- `docs/coding_guidelines.md`
- `docs/architecture.md`
- `docs/workflows.md`
- `docs/tools.md`
- `docs/agent_workflow.md`
- `NEXT_STEPS.md`
- Core implementation areas under `src/mcp`, `src/workflow`, `src/spec`,
  `src/planning`, `src/sync`, `src/db`, `src/figma`, `src/mcp/bridge`, and the
  removed design-to-code modules
- Current workflow implementation: `src/workflow/workflow-schema.ts`,
  `src/workflow/workflow-next.ts`, `src/workflow/workflow-store.ts`,
  `src/workflow/workflow-snapshot.ts`, and `src/mcp/tools/workflow.ts`

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

The next core should not assume custom sync is always the source of truth.
Design-system access should be an adapter with this order:

1. Native Figma assistant/design-system search when available.
2. Local cache/index when native search is unavailable or too expensive.
3. Narrow manual component references for small projects.

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
  -> group_findings
  -> create_revision_plan
  -> ask_reply_or_memory_approval
  -> record_preferences
  -> done
```

Interrupts:

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
- Apply metadata and node map recording.
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
- Existing draft target and node map remain usable.
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
- Should local design-system sync remain a default first-run step, or should the
  new adapter prefer native Figma design-system search when the assistant
  exposes it?
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
