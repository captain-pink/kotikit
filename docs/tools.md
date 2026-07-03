# kotikit MCP Tools

Tools exposed by the kotikit MCP server, organized by the current
designer-first graph facade plus support utilities.

Token costs are approximate response sizes measured against a small fixture
project. Re-measure with `bun run measure` after payload changes. See
[TOKENS.md](./TOKENS.md) for context-budget notes.

Design-to-code tools are not part of the core MCP surface. The older manual
workflow, brainstorm/spec, component-plan, design-plan, design-apply,
comment posting, and memory choreography tools have been removed from public
registration. Use graph flows and artifacts instead. Lightweight Figma comment
feedback remains through `review-screen` and compact artifacts.

## Safe Local Auto-Approvals

Every registered MCP tool carries explicit safety annotations. Source scaffold
for Codex and Claude Code auto-approves only exact safe local read-only tools:

- `kotikit_flow_list`
- `kotikit_flow_validate`
- `kotikit_get_artifact`
- `kotikit_list_artifacts`
- `kotikit_search_design_system`
- `kotikit_ds_search`
- `kotikit_ds_get_component`
- `kotikit_icons_search`
- `kotikit_get_system_prompt`
- `kotikit_config_status`

The scaffold does not use wildcard approval rules. Tools that write files,
start or stop the bridge, return bridge tokens, call Figma, resolve secrets,
or mutate graph runs still require user approval.

## Graph Artifacts And UX Quality Contracts

The graph facade keeps designer work resumable by storing durable artifacts
instead of asking the assistant to remember every previous detail. The main UX
quality contracts are:

- `DesignApproach`: compact micro-brainstorm artifact with goal, likely
  workflow, recommended approach, alternatives considered, state strategy,
  layout strategy, design-system strategy, icon strategy, assumptions, risks,
  and whether the run can proceed without another designer question.
- `StateMatrix`: planned filled, loading, empty, no-results, error, and
  permission states before visual composition.
- `CanvasPlan`: deterministic screen-state zones, plus optional post-screen
  draft-component zones, used to keep generated Figma frames same-sized and
  non-overlapping.
- `FigmaTransactionPlan`: ordered incremental Figma transaction queue for one
  screen state, region state, or approved post-screen draft component at a
  time.
- `FigmaNodeLedger`: compact record of created Figma nodes, bounds, component
  refs, variable refs, auto layout, state representation, and transaction ids.
- `DesignSystemReusePlan`: visible pre-apply plan showing exact reuse,
  substitutes to validate, close candidates to compose, and true gaps that
  should stay as screen-draft work until the designer approves extraction.
- `DesignSystemUsageReport`: final proof summary of reused design-system
  components, screen-draft parts, optional linked draft components, icon refs,
  and primitive exceptions.
- `CommentEvidenceMap`: compact mapping from Figma REST comments to node-ledger
  entries after a draft is visible.
- `RevisionPlan`: proposed post-screen changes from Figma comments or plain chat
  feedback, paused for designer approval before any Figma edits.

Context durability checks keep long-lived graph state compact. Raw Figma and
research payloads should move into artifacts after these contracts exist. If a
flow blocks, designer recovery output should explain the problem, why it
matters, and the recommended next action. Repeated validator failures are
persisted on the run with expected/found/action diagnostics so the next agent
can recover without guessing.

## Graph Flow Facade

### kotikit_flow_list

Purpose: List compact built-in and loaded flow summaries.
Input: `{}`
Output: `{ flows: { id; version; title; requiredCapabilities; safetyProfile }[] }`

### kotikit_flow_validate

Purpose: Validate a built-in, project, or extension flow manifest before
execution.
Input: `{ flowId?: string; flow?: object }`
Output: `{ valid: boolean; flow }`

### kotikit_start

Purpose: Start a graph-backed designer flow.
Input: `{ flowId: string; input?: { userIntent?: string; screenBlueprint?: object; flowBlueprint?: object; canvasIntent?: object; existingDesignInventory?: object; figmaTarget?: object; designSystem?: object; feedback?: object; project?: { root: string; name?: string } } }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`

For detailed PRDs, assistants should pass `screenBlueprint` or `flowBlueprint`
instead of relying on plain-language inference. Kotikit preserves blueprint
titles, product domains, screen names, UI parts, regions, repeated patterns,
and canvas intent. Without a blueprint, fallback inference is intentionally
limited to short simple prompts.

Graph execution uses kotikit's local design-system cache as the source of
truth for reusable components, icons, and variables. Do not rely on open-ended
Figma design-system search during a run; if local design-system data is
missing, sync or update the local cache before requesting production-quality
output.

### refine-existing

Purpose: Refine existing Figma frames or pages from explicit target context.
Use this flow when the designer wants kotikit to modify selected frames or an
existing page instead of drafting a new section. Pass `canvasIntent` with
`mode: "refine-existing-targets"` and target frame refs. For pages with several
screens or designs not created by kotikit, pass `existingDesignInventory` with
compact frame metadata from the selected page or Figma scan. When multiple
targets are ambiguous, kotikit asks one clarification instead of guessing.

### kotikit_answer

Purpose: Resume a run paused for a designer decision.
Input: `{ runId: string; answer: string }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`

### kotikit_continue

Purpose: Continue a run after an external action such as Figma apply metadata
recording.
Input: `{ runId: string }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`

### kotikit_bind_figma_target

Purpose: Bind a safe Figma draft target into an active graph run.
Input: `{ runId: string; pageUrl?: string; target?: object }`
Use `pageUrl` for the normal path. Kotikit resolves the exact draft page URL
into the canonical target and Section name. `target` remains available for
advanced callers and accepts either canonical fields (`fileKey`, `pageId`,
`pageName`, `pageUrl`, `section.name`) or Figma apply-style aliases
(`figmaFileKey`, `figmaPageId`, `figmaSectionName`).
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`

### kotikit_get_artifact

Purpose: Read one compact graph artifact by id.
Input: `{ artifactId: string }`
Output: `{ artifact }`

### kotikit_list_artifacts

Purpose: List artifacts for one run, or all artifacts when supported.
Input: `{ runId?: string }`
Output: `{ artifacts: Artifact[] }`

### kotikit_search_design_system

Purpose: Search the local design-system mirror with the token-efficient index.
Input: `{ query: string; limit?: number }`

### kotikit_feedback_snapshot

Purpose: Read compact Figma comments for a draft file and optionally attach
them to a `review-screen` run.
Input: `{ figmaUrl?: string; fileKey?: string; runId?: string; includeResolved?: boolean; limit?: number }`
Output: `{ snapshot; run? }`

This tool is read-only for Figma, but it resolves a local Figma token and calls
Figma, so scaffolded agents should still ask before running it.

### kotikit_record_figma_apply

Purpose: Record official Figma MCP apply metadata into the active graph run.
Input: `{ runId: string; scope: string; stepIndex: number; outcome: "ok" | "warned" | "failed"; transactionId: string; figmaFileKey?; figmaPageId?; figmaSectionName?; figmaNodeId?; figmaNodeKind?; figmaNodeName?; bounds?; componentRefs?; componentKey?; componentSource?; variableRefs?; iconRefs?; iconKey?; iconPlaceholder?; representation?; autoLayout?; screenshotReviewed?; screenshotFindings?; nodes?; partId?; draftComponentId?; componentName?; dsKey?; variableBindings?; layoutFrames?; repeatedItems?; textTransforms?; evidenceSnapshot? }`
Output: `{ runId; status; activeFigmaTransaction?; figmaTransactionProgress?; pendingQuestion?; artifacts; errors }`

Use this after applying the active incremental Figma transaction. Do not record
a later transaction before the graph consumes the current metadata. Use
`componentSource: "existing-component"` for imported design-system instances,
`componentSource: "screen-draft"` for composed missing structure that may be
extracted later, `componentSource: "draft-component"` for linked kotikit draft
components after designer-approved extraction, and record `iconRefs` when the
apply packet lists required icon affordances. For screen and region writes,
include a compact `evidenceSnapshot` gathered from the applied Figma root node:
visible component instances, local design-system component/icon keys,
auto-layout mode, bounds, visibility, opacity, and layout metrics. The compact
scanner should emit `FigmaEvidenceSnapshot/v1` arrays named `parts`,
`componentInstances`, `layoutFrames`, and `icons`, plus
`summary.directVisibleChildCount` and `summary.autoLayoutContainerCount`.
Every apply-packet `evidenceChecklist.existingComponents[]` item must be a
visible `INSTANCE` of that exact local design-system component key in the real
UI, not a hidden proof layer or hand-built substitute. Newly created local
components do not satisfy existing design-system reuse.
Take a screenshot after visible DS component placement, inspect it, record
`screenshotReviewed: true`, and include visible issues in
`screenshotFindings`. If evidence is invalid, the tool rejects it before
patching graph state so the same active transaction remains repairable.

### kotikit_doctor

Purpose: Diagnose local setup, design-system state, bridge status, and schema
versions.
Input: `{}`
Output: `{ ok: boolean; root: string; checks; nextSteps }`

## Setup

### kotikit_config_status

Purpose: Check whether kotikit is initialized in this project and surface
configuration gaps.
Input: `{}`
Output: `{ initialized: boolean; missing: string[] }`

### kotikit_config_init

Purpose: Initialize or reinitialize `.kotikit/config.json` with design-first
defaults.
Input: `{ figmaFiles?: { key: string; name: string }[]; flowPacks?: object }`
Output: `{ configPath: string; notes: string[] }`

### kotikit_config_get

Purpose: Read the current kotikit config without exposing raw secret values.
Input: `{}`
Output: `KotikitConfig` with secret values masked.

## Local Design-System Support

### kotikit_sync_ds

Purpose: Pull published Figma design-system data into the local search index.
Input: `{ dryRun?: boolean; files?: { key: string; name: string }[] }`
Output: sync summary, manifest updates, and conflict warnings.

### kotikit_ds_search

Purpose: Search the local component index directly.
Input: `{ query: string; limit?: number }`
Output: compact refs with component names, keys, file keys, and paths.

### kotikit_ds_get_component

Purpose: Read exactly one synced component JSON by path.
Input: `{ path: string }`
Output: component JSON.

### kotikit_icons_search

Purpose: Search the local icon index.
Input: `{ query: string; limit?: number; includeSvg?: boolean }`
Output: compact icon refs; SVG is returned only when requested.

### kotikit_sync_plugin_variables

Purpose: Import variables exported by the local Figma plugin when REST
variables are unavailable.
Input: `{ payload: object }`
Output: imported variable count and conflict details.

## Prompts And Bridge

### kotikit_get_system_prompt

Purpose: Fetch long prompt doctrine by reference.
Input: `{ kind: "brainstorm" }`
Output: prompt text.

### kotikit_bridge_start

Purpose: Start the local WebSocket bridge used by the kotikit Figma plugin for
variable export.
Input: `{ preferredPort?: number }`
Output: pasteable bridge URL and status.

### kotikit_bridge_stop

Purpose: Stop the in-process local plugin bridge.
Input: `{}`
Output: bridge status.

### kotikit_bridge_status

Purpose: Report active or stale local plugin bridge state.
Input: `{}`
Output: bridge status.
