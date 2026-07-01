# kotikit MCP Tools

Tools exposed by the kotikit MCP server, organized by the current
designer-first graph facade plus support utilities.

Token costs are approximate response sizes measured against a small fixture
project. Re-measure with `bun run measure` after payload changes. See
[TOKENS.md](./TOKENS.md) for context-budget notes.

Design-to-code tools are not part of the core MCP surface. The older manual
workflow, brainstorm/spec, component-plan, design-plan, design-apply,
review/comment, and memory choreography tools have been removed from public
registration. Use graph flows and artifacts instead.

## Graph Artifacts And UX Quality Contracts

The graph facade keeps designer work resumable by storing durable artifacts
instead of asking the assistant to remember every previous detail. The main UX
quality contracts are:

- `StateMatrix`: planned filled, loading, empty, no-results, error, and
  permission states before visual composition.
- `CommentEvidenceMap`: REST-backed Figma comment evidence mapped to known
  pages, regions, components, or generated nodes where possible.
- `DraftComponentLifecycle`: draft components created for design-system gaps,
  with required linked instances in the final screen.

Context durability checks keep long-lived graph state compact. Raw Figma,
comment, and research payloads should move into artifacts after these contracts
exist. If a flow blocks, designer recovery output should explain the problem,
why it matters, and the recommended next action.

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
Input: `{ flowId: string; input?: { userIntent?: string; figmaTarget?: object; review?: object; designSystem?: object; project?: { root: string; name?: string } } }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`

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

Purpose: Bind a safe Figma draft target object into an active graph run.
Input: `{ runId: string; target: object }`
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
Output: compact component refs.

### kotikit_record_figma_apply

Purpose: Record official Figma MCP apply metadata into the active graph run.
Input: `{ runId: string; scope: string; stepIndex: number; outcome: "ok" | "warned" | "failed"; figmaFileKey?; figmaPageId?; figmaSectionName?; figmaNodeId?; figmaNodeName?; partId?; draftComponentId?; componentName?; dsKey?; variableBindings?; layoutFrames?; repeatedItems?; textTransforms? }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`

### kotikit_review_figma_target

Purpose: Fetch bounded REST-backed evidence for an exact Figma target, then
start the built-in improve-existing-design graph flow.
Input: `{ figmaUrl?: string; fileKey?: string; nodeId?: string; scope?: string; screen?: string; surfaceType?: string; audience?: string; primaryUserGoal?: string; reviewGoal?: string; strictness?: "quick" | "standard" | "deep"; notes?: string; maxRegions?: number }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`
Requires `FIGMA_TOKEN` or `config.figma.token` with file-read access.

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
Output: `{ initialized: boolean; isGitRepo: boolean; missing: string[] }`

### kotikit_config_init

Purpose: Initialize or reinitialize `.kotikit/config.json` with design-first
defaults.
Input: `{ autoCommit?: boolean; coAuthor?: { name: string; email: string }; figmaFiles?: { key: string; name: string }[]; flowPacks?: object }`
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
