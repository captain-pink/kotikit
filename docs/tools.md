# kotikit MCP Tools

Tools exposed by the kotikit MCP server, organized by designer workflow.

Token costs are approximate response sizes measured against a small fixture
project. Re-measure with `bun run measure` after payload changes. See
[TOKENS.md](./TOKENS.md) for context-budget notes.

Design-to-code tools are not part of the core MCP surface. There are no public
tools for code planning, code implementation, component scaffolding, generated
code registry search, code gates, or code/design audits.

---

## Graph Flow Facade

### kotikit_flow_list

Purpose: List compact built-in and loaded flow summaries.
Input: `{}`
Output: `{ flows: { id; version; title; requiredCapabilities; safetyProfile }[] }`
Example: "Show available kotikit flows."

### kotikit_start

Purpose: Start a graph-backed designer flow.
Input: `{ flowId: string; input?: { userIntent?: string; figmaTarget?: FigmaDraftTarget; project?: { root: string; name?: string } } }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`
Example: "Start create-screen for a members table."

### kotikit_bind_figma_target

Purpose: Bind a safe Figma draft target object into an active graph run before
draft-component or screen writes.
Input: `{ runId: string; target: FigmaDraftTarget }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`
Example: Called after resolving a draft page target.
Notes: The target must include a draft page name and kotikit-owned Section.

### kotikit_answer

Purpose: Resume a run paused for a designer decision.
Input: `{ runId: string; answer: string }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`
Example: "Answer with create-draft-components."

### kotikit_continue

Purpose: Continue a run after an external action such as Figma apply metadata
recording.
Input: `{ runId: string }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`
Example: "Continue the draft run."

### kotikit_record_figma_apply

Purpose: Record official Figma MCP apply metadata into the active graph run.
Input: `{ runId: string; scope: string; stepIndex: number; outcome: "ok" | "warned" | "failed"; figmaFileKey; figmaPageId; figmaSectionName; figmaNodeId?; figmaNodeName?; partId?; draftComponentId?; componentName?; dsKey?; variableBindings?; layoutFrames?; repeatedItems?; textTransforms? }`
Output: `{ runId; status; pendingQuestion?; artifacts; errors }`
Example: Called after official Figma MCP writes nodes to the draft page.
Notes: Graph draft verification expects part ids, component keys or draft
component origins, variable/style bindings, auto-layout/grid metadata, repeated
item structure, and text transform metadata to match the apply packet.

### kotikit_get_artifact

Purpose: Read one compact graph artifact by id.
Input: `{ artifactId: string }`
Output: `{ artifact }`
Example: "Fetch the figma-apply-packet artifact."

---

## Setup

### kotikit_config_status

Purpose: Check whether kotikit is initialized in this project and surface
configuration gaps.
Input: `{}`
Output: `{ initialized: boolean; isGitRepo: boolean; missing: string[] }`
Example: "Check if kotikit is set up here."
See also: `kotikit_config_init`, `kotikit_config_get`, `kotikit_doctor`.

### kotikit_config_init

Purpose: Initialize or reinitialize `.kotikit/config.json` with design-first
defaults.
Input: `{ autoCommit?: boolean; coAuthor?: { name: string; email: string }; figmaFiles?: { key: string; name: string }[] }`
Output: `{ configPath: string; notes: string[] }`
Example: "Set kotikit up for this workspace."
See also: `kotikit_config_status`, `kotikit_config_get`.

### kotikit_config_get

Purpose: Read the current kotikit config without exposing raw secret values.
Input: `{}`
Output: `KotikitConfig` with `figma.token` masked when it resolves from env.
Example: "Show me my kotikit config."
See also: `kotikit_config_status`, `kotikit_config_init`.

### kotikit_doctor

Purpose: Diagnose local setup across config, git, schema version, Figma token
resolution, design-system artifacts, stale sync checkpoints, and bridge state.
Input: `{}`
Output: `{ ok: boolean; root: string; checks: { id, label, status, message, hint?, details? }[]; nextSteps: string[] }`
Example: "Run kotikit doctor for this project."
See also: `kotikit_config_status`, `kotikit_sync_ds`.

---

## Workflow

These tools keep long-running design work resumable without rereading old
conversation history. They return compact `next` guidance with allowed tools,
blocked tools, and refs.

### kotikit_workflow_start

Purpose: Start or restart a workflow for setup, design-system sync, spec
creation, Figma draft creation, comment review, or design-quality review.
Input: `{ intent: "setup" | "sync-design-system" | "create-spec" | "create-design" | "review-comments" | "design-review"; scope?: string; screen?: string | null; idea?: string; figmaUrl?: string }`
Output: `{ session; snapshot; next }`
Example: "Start kotikit auto for a Members admin page."

### kotikit_workflow_status

Purpose: Read the current workflow state and next recommended action.
Input: `{ workflowId?: string }`
Output: `{ session; snapshot; next }`
Example: "Where did kotikit leave off?"

### kotikit_workflow_next

Purpose: Return the next allowed action for the current workflow.
Input: `{ workflowId?: string }`
Output: `{ session; snapshot; next }`
Example: "Continue the current kotikit task."

### kotikit_workflow_event

Purpose: Record one compact workflow event or user decision.
Input: `{ workflowId?: string; event: string; summary: string }`
Output: `{ session; snapshot; next }`
Example: "Record that the designer approved posting comments to Figma."

---

## Specs And Briefing

### kotikit_brainstorm_start

Purpose: Start a guided product/design brainstorm for a screen or flow.
Input: `{ idea: string; scope?: string }`
Output: `{ sessionId; scope; status; classification; coverageChecklist; openDimensions; nextQuestion; systemPromptRef; systemPrompt; firstQuestions; qualityBar }`
Example: "I want to build a checkout flow; help me think through it."

### kotikit_brainstorm_answer

Purpose: Record the designer's actual answer for one brainstorm dimension.
Input: `{ sessionId: string; dimension: DimensionKey; answer: string }`
Output: `{ status; sessionId; answeredDimensions; openDimensions; nextQuestion? }`
Example: Called after each designer answer.

### kotikit_brainstorm_confirm

Purpose: Mark a fully answered brainstorm as confirmed before saving a spec or
flow.
Input: `{ sessionId: string; summary: string }`
Output: `{ status: "completed"; sessionId: string; scope: string; classification }`
Example: Called after the designer approves the plain-language summary.

### kotikit_brainstorm_assess

Purpose: Legacy coverage helper for older agent flows. Prefer
`kotikit_brainstorm_answer` and `kotikit_brainstorm_confirm`.
Input: `{ scope: string; coverage: Record<DimensionKey, "covered" | "open">; notes?: string }`
Output: Status plus suggested questions or a draft template.

### kotikit_spec_create

Purpose: Save a screen spec from a confirmed brainstorm draft.
Input: `{ draft: FlowDraft | SingleDraft; scope?: string; brainstormSessionId?: string; allowUnguided?: boolean }`
Output: `{ paths: string[] }`
Example: "Save the spec we just discussed."
Notes: Guided workflows should pass a completed `brainstormSessionId`.

### kotikit_spec_get

Purpose: Read one screen spec or flow manifest by scope and optional screen.
Input: `{ scope: string; screen?: string }`
Output: Full `ScreenSpec` or flow manifest.
Example: "Show me the login screen spec."

### kotikit_spec_list

Purpose: List known specs and flows without reading full bodies.
Input: `{}`
Output: Compact scope entries with title, kind, status, and screens.
Example: "What specs do I have so far?"

### kotikit_spec_update

Purpose: Patch mutable fields of an existing screen spec.
Input: `{ scope: string; screen?: string; patch: Partial<ScreenSpec> }`
Output: Confirmation text with updated title and commit message.
Example: "Update the empty state copy."

### kotikit_flow_create

Purpose: Save a complete multi-screen flow and all child screen specs.
Input: `{ draft: FlowDraft; brainstormSessionId?: string; allowUnguided?: boolean }`
Output: `{ manifestPath: string; screenCount: number }`
Example: "Save the onboarding flow with all three screens."

---

## Design System

### kotikit_sync_ds

Purpose: Pull configured Figma libraries into local searchable design-system
indexes.
Input: `{}`
Output: `{ files; conflicts; variableCollisions; skipped; normalizationDiagnostics }`
Example: "Sync my design system from Figma."

### kotikit_sync_plugin_variables

Purpose: Import variables exported by the local kotikit Figma plugin into
`design-system/variables.json`.
Input: `{ payload: PluginVariablesPayload }`
Output: `{ imported; totalEntries; collisions; variablesPath; source? }`
Example: Called by the plugin after "Sync Variables From Open File."

### kotikit_ds_search

Purpose: Search the local design-system mirror for components by name.
Input: `{ query: string; limit?: number }`
Output: `{ results: { name; key; path; fileKey }[] }`
Example: "Find components matching button."

### kotikit_ds_get_component

Purpose: Read the full component JSON for one design-system component.
Input: `{ path: string }`
Output: Full `ComponentJson`.
Example: "Get the full JSON for the Button component."

### kotikit_icons_search

Purpose: Search the icon index by name; SVG payloads are omitted by default.
Input: `{ query: string; limit?: number; includeSvg?: boolean }`
Output: `{ results: { name; key; signal; fileKey; svg? }[] }`
Example: "Find arrow right icons."

---

## Figma Draft Creation

### kotikit_figma_target_bind

Purpose: Bind a spec, screen, or flow to one exact safe Figma draft page.
Input: `{ scope: string; screen?: string; pageUrl: string }`
Output: `{ target; paths; commit }`
Example: "Use this Figma Draft page for the Members screen."
Notes: The URL must target a Figma page node, and the page name must contain
`Draft` or `Drafts`.

### kotikit_component_plan_create

Purpose: Record how missing screen components should be handled before draft
creation continues.
Input: `{ scope: string; screen?: string; components?: string[]; mode: "create-draft-components" | "inline-draft"; allowLiteralFallback?: boolean }`
Output: `{ planPath; specPath; plan; commit }`
Example: "The Members screen is missing a status toggle. Plan draft components first."

### kotikit_plan_design

Purpose: Generate and save the per-screen design plan from a spec and bound
Figma draft target.
Input: `{ scope: string; screen?: string }`
Output: `{ planPath; plan; commit }`
Example: "Generate a design plan for the checkout screen."

### kotikit_design_get_screen

Purpose: Fetch the official Figma MCP apply packet for one screen.
Input: `{ scope: string; screen?: string }`
Output: `{ applyMode; applyInstructions; plan; spec; flow?; target; dsComponents; skipped }`
Example: "Get the design context for the profile screen."
Notes: Deprecated compatibility surface. Graph runs should read the
`figma-apply-packet` artifact with `kotikit_get_artifact`; this tool prefers
matching graph apply-packet artifacts before falling back to legacy design
plans.

### kotikit_design_apply_step

Purpose: Record that the official Figma MCP path created or updated one design
plan step.
Input: `{ scope: string; screen?: string; stepIndex: number; outcome: "ok" | "warned" | "failed"; note?: string; ...figmaMetadata }`
Output: `{ line: string }`
Example: Called after Figma writes, not directly by the designer.
Notes: Deprecated compatibility logger. Prefer `kotikit_record_figma_apply`
with `runId` for graph runs so apply metadata is patched into graph state before
`kotikit_continue`.

---

## Comments, Review, And Memory

### kotikit_design_review_comments

Purpose: Fetch Figma comments and map them to applied design-plan nodes when a
node map exists.
Input: `{ scope?: string; screen?: string; fileKey?: string; includeResolved?: boolean; limit?: number }`
Output: `{ sessionId; fileKey; scope?; screen?; hasNodeMap; totalFetched; skippedResolved; mapped; unmapped; truncated }`
Example: "Read Figma review comments for the Members screen."

### kotikit_design_adjustment_record

Purpose: Record a compact design adjustment made during review.
Input: `{ sessionId?: string; scope?: string; screen?: string; fileKey?: string; commentId?: string; nodeId?: string; category: string; summary: string; preferenceKey?: string; preferenceSummary?: string }`
Output: `{ adjustment }`
Example: "Record that I made the Members table denser."

### kotikit_design_review_report

Purpose: Return a compact report for a comment-review session.
Input: `{ sessionId?: string; scope?: string; screen?: string; limit?: number }`
Output: `{ session; summary; comments; adjustments; pendingReplies }`
Example: "Show the latest design review report."

### kotikit_design_comment_reply_prepare

Purpose: Prepare pending Figma replies for fixed comments without posting.
Input: `{ sessionId?: string; fileKey?: string; commentIds?: string[]; message?: string }`
Output: `{ replies }`
Example: "Prepare replies for fixed comments."

### kotikit_design_comment_reply_post

Purpose: Post prepared replies after explicit approval.
Input: `{ sessionId?: string; fileKey?: string; outboxIds?: string[]; limit?: number }`
Output: `{ posted; failed }`
Example: "Post the prepared replies."
Notes: Requires a token with `file_comments:write`.

### kotikit_design_review_start

Purpose: Start a standalone design-quality review for an exact Figma page,
section, frame, or component.
Input: `{ figmaUrl?: string; fileKey?: string; nodeId?: string; scope?: string; screen?: string; surfaceType?: string; audience?: string; primaryUserGoal?: string; reviewGoal?: string; strictness?: "quick" | "standard" | "deep"; notes?: string; maxRegions?: number }`
Output: `{ sessionId; target; evidence; next }`
Example: "Review this Figma section like a design director."

### kotikit_design_review_record

Purpose: Persist structured findings from a standalone design review.
Input: `{ sessionId: string; findings: FindingInput[] }`
Output: `{ findings }`
Example: "Record these review findings."

### kotikit_design_review_get

Purpose: Return a compact standalone design-review report.
Input: `{ sessionId?: string; fileKey?: string; limit?: number }`
Output: `{ session; summary; findings; pendingComments }`
Example: "Show the latest design-quality review report."

### kotikit_design_review_comment_prepare

Purpose: Prepare pending root Figma comments for commentable findings without
posting.
Input: `{ sessionId: string; findingIds?: string[]; limit?: number }`
Output: `{ comments }`
Example: "Prepare Figma comments for high-severity findings."

### kotikit_design_review_comment_post

Purpose: Post prepared standalone review comments after explicit approval.
Input: `{ sessionId?: string; fileKey?: string; outboxIds?: string[]; limit?: number; confirm: true }`
Output: `{ posted; failed }`
Example: "Post the approved review comments."

### kotikit_design_memory_candidates

Purpose: List repeated design feedback patterns that may become project
preferences.
Input: `{ status?: "candidate" | "promoted" | "dismissed"; limit?: number }`
Output: `{ candidates }`
Example: "Show design memory candidates."

### kotikit_design_memory_promote

Purpose: Promote a repeated feedback candidate into an active project design
preference.
Input: `{ candidateKey: string; scope?: string; rule?: string }`
Output: `{ preference }`
Example: "Promote the compact rows preference."

### kotikit_design_memory_dismiss

Purpose: Dismiss a feedback candidate.
Input: `{ candidateKey: string }`
Output: `{ candidate }`
Example: "Dismiss the roomy sections candidate."

### kotikit_design_memory_update

Purpose: Edit, reactivate, or deactivate an existing design preference.
Input: `{ preferenceKey: string; rule?: string; scope?: string | null; status?: "active" | "inactive" }`
Output: `{ preference }`
Example: "Deactivate the compact rows preference for now."

### kotikit_design_memory_search

Purpose: Search active project design preferences for the current design task.
Input: `{ scope?: string; category?: string; query?: string; limit?: number }`
Output: `{ preferences }`
Example: "Find active density preferences for this screen."

---

## Plugin Bridge

The bridge exists for narrow plugin-backed variable import. Normal design
application should use the official Figma MCP integration.

### kotikit_bridge_start

Purpose: Start the local kotikit plugin bridge and return the pasteable plugin
URL.
Input: `{ preferredPort?: number }`
Output: `{ running; staleConfig; projectRoot; projectName; port; url; startedAt }`
Example: "Start the kotikit Figma plugin bridge."

### kotikit_bridge_stop

Purpose: Stop the plugin bridge owned by the current MCP process and clear
bridge state.
Input: `{}`
Output: `{ stopped; clearedConfig }`
Example: "Stop the kotikit Figma plugin bridge."

### kotikit_bridge_status

Purpose: Report whether the current MCP process owns a running plugin bridge.
Input: `{}`
Output: `{ running; staleConfig; projectRoot; projectName; port?; url?; startedAt? }`
Example: "Is the Figma plugin bridge running?"

---

## Utility

### kotikit_get_system_prompt

Purpose: Fetch a long-form prompt once per session so other tools can reference
it by kind instead of inlining it.
Input: `{ kind: "brainstorm" }`
Output: `{ prompt: string; kind: "brainstorm"; version: "1" }`
Example: "Fetch the brainstorm prompt."
