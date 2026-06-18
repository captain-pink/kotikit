# kotikit MCP Tools

37 tools exposed by the kotikit MCP server, organized by what they do.
Each tool name is what the agent calls; the "Example" line shows how to trigger it from your conversation.

Token costs are approximate response sizes measured against a small fixture project (3 DS components, 1 screen). Re-measure for your project with `bun run measure`. See [docs/TOKENS.md](./TOKENS.md) for optimization strategies.

Tools marked **⚠** return more than ~1000 tokens by default — call them deliberately.

---

## Setup

### kotikit_config_status

Purpose: Check whether kotikit is initialized in this project and whether required gate tools are installed.
Input: `{}`
Output: `{ initialized: boolean; isGitRepo: boolean; missing: string[]; gates?: { ok: boolean; missing: { hint: string }[] } }`
Token cost: ~72.
Example: "Check if kotikit is set up here."
See also: `kotikit_config_init`, `kotikit_config_get`.

---

### kotikit_config_init

Purpose: Initialize or reinitialize the kotikit config file with project settings and optional Figma connection.
Input: `{ framework?: "react"; codeComponentsDir?: string; tests?: boolean; autoCommit?: boolean; coAuthor?: { name: string; email: string }; figmaFiles?: { key: string; name: string }[] }`
Output: `{ configPath: string; notes: string[] }`
Token cost: ~150.
Example: "Set kotikit up for this project — I'm using React and my components live in `src/components`."
See also: `kotikit_config_status`, `kotikit_config_get`.

---

### kotikit_config_get

Purpose: Read the current kotikit config without exposing raw secret values.
Input: `{}`
Output: Full `KotikitConfig` object with `figma.token` replaced by `"<resolved from env>"`.
Token cost: ~133.
Example: "Show me my kotikit config."
See also: `kotikit_config_status`, `kotikit_config_init`.

---

### kotikit_doctor

Purpose: Diagnose local kotikit setup across config, git, Figma token resolution, design-system artifacts, stale sync checkpoints, code gates, and bridge state.
Input: `{}`
Output: `{ ok: boolean; root: string; checks: { id, label, status, message, hint? }[]; nextSteps: string[] }`
Token cost: ~300.
Example: "Run kotikit doctor for this project."
See also: `kotikit_config_status`, `kotikit_sync_ds`.

---

## Specs

### kotikit_brainstorm_start

Purpose: Start a brainstorm session for a screen or flow, returning a coverage checklist and opening questions tailored to the idea.
Input: `{ idea: string }`
Output: `{ classification: "singleScreen" | "multiScreen"; coverageChecklist: DimensionKey[]; systemPromptRef: "brainstorm"; systemPrompt: string; firstQuestions: string[]; qualityBar: string }`
Token cost: ~261.
Example: "I want to build a checkout flow — help me think through it."
See also: `kotikit_brainstorm_assess`, `kotikit_get_system_prompt`.

---

### kotikit_brainstorm_assess

Purpose: Check whether all required design dimensions are covered and return open gaps or a ready-to-save draft when complete.
Input: `{ scope: string; coverage: Record<DimensionKey, "covered" | "open">; notes?: string }`
Output: `{ status: "keepGoing"; openDimensions: DimensionKey[]; suggestedQuestions: string[] }` or `{ status: "readyToSave"; draftTemplate: SingleDraft | FlowDraft }`
Token cost: ~300–400.
Example: _(called internally during brainstorm to track coverage progress)_
See also: `kotikit_brainstorm_start`, `kotikit_spec_create`, `kotikit_flow_create`.

---

### kotikit_spec_create

Purpose: Create a new screen spec (single or multi-screen flow) from a brainstorm draft and optionally auto-commit it.
Input: `{ draft: FlowDraft | SingleDraft; scope?: string }`
Output: `{ paths: string[] }`
Token cost: ~200.
Example: "Save the spec we just discussed."
See also: `kotikit_flow_create`, `kotikit_spec_get`, `kotikit_spec_list`.

---

### kotikit_spec_get

Purpose: Read a single screen spec or a flow manifest by scope and optional screen slug.
Input: `{ scope: string; screen?: string }`
Output: Full `ScreenSpec` object (title, description, requirements, states, acceptanceCriteria, metadata).
Token cost: ~268.
Example: "Show me the login screen spec."
See also: `kotikit_spec_list`, `kotikit_spec_update`.

---

### kotikit_spec_list

Purpose: List all known specs and flows without reading their full bodies.
Input: `{}`
Output: Plain-text list of scope entries: `{ title, kind, status, screens[] }[]`.
Token cost: ~35.
Example: "What specs do I have so far?"
See also: `kotikit_spec_get`, `kotikit_spec_create`.

---

### kotikit_spec_update

Purpose: Patch mutable fields of an existing screen spec; immutable fields (`id`, `type`) are rejected.
Input: `{ scope: string; screen?: string; patch: Partial<ScreenSpec> }`
Output: Confirmation string with updated title and commit message.
Token cost: ~150.
Example: "Update the profile screen spec — the empty state should say 'Nothing here yet'."
See also: `kotikit_spec_get`, `kotikit_spec_list`.

---

### kotikit_flow_create

Purpose: Create a complete multi-screen flow — writes the flow manifest and all screen specs in one atomic commit.
Input: `{ draft: FlowDraft }`
Output: `{ manifestPath: string; screenCount: number }`
Token cost: ~250.
Example: "Save the onboarding flow with all three screens."
See also: `kotikit_spec_create`, `kotikit_spec_get`, `kotikit_brainstorm_assess`.

---

## Design system sync

### kotikit_sync_ds

Purpose: Pull the latest design system from Figma into the local search index and registry.
Input: `{}`
Output: `{ files: { fileKey, componentCount, iconCount }[]; conflicts: string[]; normalizationDiagnostics: NormalizationDiagnostics[] }` plus a human-readable summary.
Token cost: ~200 response (large side-effect: writes all DS JSON to disk).
Example: "Sync my design system from Figma."
See also: `kotikit_ds_search`, `kotikit_ds_get_component`, `kotikit_icons_search`.

---

### kotikit_ds_search

Purpose: Search the local design system mirror for components by name using FTS5 match expressions.
Input: `{ query: string; limit?: number }`
Output: `{ results: { name: string; key: string; path: string; fileKey: string }[] }`
Token cost: ~65.
Example: "Find components matching 'button' in my design system."
See also: `kotikit_ds_get_component`, `kotikit_sync_ds`.

---

### kotikit_ds_get_component

Purpose: Read the full `ComponentJson` for a single DS component by its relative path.
Input: `{ path: string }`
Output: Full `ComponentJson` (name, key, optional componentSetKey, variants, properties, slots, description, updatedAt). The `key` is the importable component key; `componentSetKey` is logical set metadata when available.
Token cost: ~158.
Example: "Get the full JSON for the Button component."
See also: `kotikit_ds_search`, `kotikit_implement_code_start`.

---

### kotikit_icons_search

Purpose: Search the icon index by name; SVG payloads are omitted by default to keep results small.
Input: `{ query: string; limit?: number; includeSvg?: boolean }`
Output: `{ results: { name: string; key: string; signal: string; fileKey: string; svg?: string }[] }`
Token cost: ~36.
Example: "Find icons matching 'arrow right' in my design system."
See also: `kotikit_ds_search`, `kotikit_sync_ds`.

---

## Code track

### kotikit_plan_code

Purpose: Generate and save the ephemeral per-screen code plan (component name, step list, DS refs) for a spec.
Input: `{ scope: string; screen?: string }`
Output: `{ planPath: string; plan: { componentName, steps, dsComponentRefs, testPath } }`
Token cost: ~593.
Example: "Generate a code plan for the login screen."
See also: `kotikit_implement_code_start`, `kotikit_spec_get`.

---

### kotikit_implement_code_start ⚠

Purpose: Gather the full context bundle an agent needs to write React code for one screen — spec, plan, DS refs, gate environment, and test scaffold.
Input: `{ scope: string; screen?: string; expand?: boolean }`
Output (default `expand: false`): `{ componentName, targetPath, testPath, systemPromptRef: "react", screenContext, spec, flow?, config, registryHits, componentRefs: { name, path, key }[], testScaffold, plan }`
Output (`expand: true`): Same but with `dsComponents: Record<string, ComponentJson>` instead of `componentRefs`.
Token cost: ~1405 (default) / ~1686 (expand: true) ⚠.
Example: "Start implementing the login screen."
See also: `kotikit_implement_code_save`, `kotikit_implement_code_gate`, `kotikit_get_system_prompt`, `kotikit_ds_get_component`.

---

### kotikit_implement_code_save

Purpose: Write generated component files, run quality gates (tsc, eslint, prettier, vitest), commit on success, and upsert the registry.
Input: `{ scope: string; screen?: string; files: { path: string; content: string }[] }`
Output (gates pass): `{ report: GateRunReport; commit: CommitResult; paths: string[] }`
Output (gates fail): `isError: true` with gate report and file paths for the next iteration.
Token cost: ~200–500 depending on gate failure detail.
Example: "Save the login screen component I just wrote."
See also: `kotikit_implement_code_start`, `kotikit_implement_code_gate`.

---

### kotikit_implement_code_gate

Purpose: Re-run quality gates on already-written generated files without re-saving content.
Input: `{ scope: string; screen?: string; only?: ("tsc" | "eslint" | "prettier" | "vitest")[] }`
Output: `{ report: GateRunReport }` or `isError: true` with formatted gate report.
Token cost: ~150.
Example: "Re-run the type check on the login screen."
See also: `kotikit_implement_code_save`.

---

### kotikit_scaffold_start ⚠

Purpose: Gather scaffolding context for DS components — returns component skeletons, DS JSON, and target paths, paginated.
Input: `{ names?: string[]; pageSize?: number; cursor?: string; compact?: boolean; expand?: boolean }`
Output: `{ components: { name, kebabName, targetPath, storyPath?, dsJson, scaffoldShape }[]; nextCursor?: string; hasMore: boolean; totalRemaining: number; systemPromptRef: "react"; hasStorybook: boolean; skipped: { name, reason }[]; testFramework: string }`
Token cost: ~1366 (default compact, pageSize 3) / ~1506 (expand: true) ⚠.
Example: "Scaffold my Button, Card, and Input components."
See also: `kotikit_scaffold_save`, `kotikit_get_system_prompt`, `kotikit_registry_search`.

---

### kotikit_scaffold_save

Purpose: Write refined scaffold files for a batch of DS components, run gates once across the batch, commit, and mark each component `synced` in the registry.
Input: `{ files: { path: string; content: string }[] }`
Output (gates pass): `{ report: GateRunReport; commit: CommitResult; paths: string[] }`
Output (gates fail): `isError: true` with gate report.
Token cost: ~250.
Example: "Save the scaffolded Button and Card components."
See also: `kotikit_scaffold_start`, `kotikit_registry_search`.

---

### kotikit_registry_search

Purpose: Search the kotikit component registry by name prefix, sync status, and/or kind.
Input: `{ query?: string; status?: "code-only" | "design-only" | "synced"; kind?: "screen" | "component"; limit?: number }`
Output: `{ results: { name, kind, status, dsPath, codePath, createdAt, updatedAt }[] }`
Token cost: ~172.
Example: "Which components are design-only?"
See also: `kotikit_scaffold_start`, `kotikit_audit`.

---

## Design track (Figma plugin)

### kotikit_plan_design

Purpose: Generate and save the per-screen design plan (ordered step list for the Figma plugin) from a spec.
Input: `{ scope: string; screen?: string }`
Output: `{ planPath: string; plan: { pageName, steps: DesignStep[] }; commit: CommitResult }`
Token cost: ~981.
Example: "Generate a design plan for the checkout screen."
See also: `kotikit_design_get_screen`, `kotikit_spec_get`.

---

### kotikit_design_get_screen ⚠

Purpose: Fetch the design plan, spec, optional flow manifest, and DS component bundle for one screen — the full context the Figma plugin needs.
Input: `{ scope: string; screen?: string }`
Output: `{ plan: DesignPlan; spec: ScreenSpec; flow?: FlowManifest; dsComponents: Record<string, ComponentJson>; skipped: { name, reason }[] }`
Token cost: ~1513 ⚠.
Example: "Get the design context for the profile screen."
See also: `kotikit_plan_design`, `kotikit_design_apply_step`.

---

### kotikit_design_apply_step

Purpose: Record that the Figma plugin applied a design plan step. Appends to an audit log and, when Figma node metadata is provided, updates the screen's `design.node-map.json` for later comment mapping.
Input: `{ scope: string; screen?: string; stepIndex: number; outcome: "ok" | "warned" | "failed"; note?: string; stepKind?: DesignStepKind; state?: string; componentName?: string; dsKey?: string; figmaFileKey?: string; figmaPageId?: string; figmaPageName?: string; figmaNodeId?: string; figmaNodeKind?: "page" | "frame" | "instance" | "node"; figmaNodeName?: string }`
Output: `{ line: string }` — the raw JSON line written to the log.
Token cost: ~60.
Example: _(called by the Figma plugin, not directly by the designer)_
See also: `kotikit_design_get_screen`, `kotikit_plan_design`.

---

### kotikit_design_review_comments

Purpose: Fetch Figma comments through the REST API and map them to applied design-plan nodes using the local `design.node-map.json` when available.
Input: `{ scope?: string; screen?: string; fileKey?: string; includeResolved?: boolean; limit?: number }`
Output: `{ sessionId, fileKey, scope?, screen?, hasNodeMap, totalFetched, skippedResolved, mapped, unmapped, truncated }`
Token cost: depends on comment count; defaults to 25 mapped and 25 unmapped comments returned.
Example: "Read Figma review comments for the Members screen."
See also: `kotikit_design_apply_step`, `kotikit_plan_design`.

---

### kotikit_design_adjustment_record

Purpose: Record a compact design adjustment made during a review pass and optionally attach evidence for a reusable design preference.
Input: `{ sessionId?: string; scope?: string; screen?: string; fileKey?: string; commentId?: string; nodeId?: string; category: "spacing" | "density" | "typography" | "hierarchy" | "color" | "component" | "interaction" | "copy" | "responsive" | "layout" | "other"; summary: string; preferenceKey?: string; preferenceSummary?: string }`
Output: `{ adjustment }`
Token cost: ~100.
Example: "Record that I made the Members table denser for comment c1."
See also: `kotikit_design_review_report`, `kotikit_design_memory_candidates`.

---

### kotikit_design_review_report

Purpose: Return a compact report for a review session: comment statuses, adjustments, and pending replies.
Input: `{ sessionId?: string; scope?: string; screen?: string; limit?: number }`
Output: `{ session, summary, comments, adjustments, pendingReplies }`
Token cost: depends on `limit`; defaults to 25 rows per section.
Example: "Show the latest design review report for Members."
See also: `kotikit_design_review_comments`, `kotikit_design_adjustment_record`.

---

### kotikit_design_comment_reply_prepare

Purpose: Prepare pending Figma replies for fixed comments without posting them.
Input: `{ sessionId?: string; fileKey?: string; commentIds?: string[]; message?: string }`
Output: `{ replies }`
Token cost: ~120 plus reply count.
Example: "Prepare replies for all fixed comments in this review pass."
See also: `kotikit_design_comment_reply_post`.

---

### kotikit_design_comment_reply_post

Purpose: Post pending prepared Figma replies. Requires a token with `file_comments:write`.
Input: `{ sessionId?: string; fileKey?: string; outboxIds?: string[]; limit?: number }`
Output: `{ posted, failed }`
Token cost: ~120 plus posted/failed count.
Example: "Post the prepared replies for fixed comments."
See also: `kotikit_design_comment_reply_prepare`.

---

### kotikit_design_memory_candidates

Purpose: List repeated design feedback patterns that may become project design preferences.
Input: `{ status?: "candidate" | "promoted" | "dismissed"; limit?: number }`
Output: `{ candidates }`
Token cost: depends on `limit`; defaults to 25.
Example: "Show design memory candidates from recent review fixes."
See also: `kotikit_design_memory_promote`, `kotikit_design_memory_dismiss`, `kotikit_design_memory_search`.

---

### kotikit_design_memory_promote

Purpose: Promote a repeated feedback candidate into an active project design preference.
Input: `{ candidateKey: string; scope?: string; rule?: string }`
Output: `{ preference }`
Token cost: ~100.
Example: "Promote `tables.density.compact_rows` for the Members scope."
See also: `kotikit_design_memory_candidates`, `kotikit_design_memory_update`.

---

### kotikit_design_memory_dismiss

Purpose: Dismiss a repeated feedback candidate that should not become a project design preference.
Input: `{ candidateKey: string }`
Output: `{ candidate }`
Token cost: ~100.
Example: "Dismiss the roomy sections preference candidate."
See also: `kotikit_design_memory_candidates`.

---

### kotikit_design_memory_update

Purpose: Edit, reactivate, or deactivate an existing project design preference.
Input: `{ preferenceKey: string; rule?: string; scope?: string | null; status?: "active" | "inactive" }`
Output: `{ preference }`
Token cost: ~100.
Example: "Deactivate the compact rows preference for now."
See also: `kotikit_design_memory_promote`, `kotikit_design_memory_search`.

---

### kotikit_design_memory_search

Purpose: Search active project design preferences for the current design task.
Input: `{ scope?: string; category?: "spacing" | "density" | "typography" | "hierarchy" | "color" | "component" | "interaction" | "copy" | "responsive" | "layout" | "other"; query?: string; limit?: number }`
Output: `{ preferences }`
Token cost: depends on `limit`; defaults to 25.
Example: "Find active density preferences for this screen."
See also: `kotikit_design_get_screen`.

---

## Audit + utility

### kotikit_audit

Purpose: Walk the registry and classify every component as `synced-ok`, `synced-mismatched`, `design-only`, or `code-only`, writing a report to `.kotikit/audit-report.json`.
Input: `{}`
Output: `{ reportPath: string; report: AuditReport }` where `AuditReport = { version: 1; ranAt: string; summary: { syncedOk, syncedMismatched, designOnly, codeOnly }; entries: AuditEntry[] }`.
Token cost: ~261.
Example: "Audit my design system — are code and design still in sync?"
See also: `kotikit_registry_search`, `kotikit_sync_ds`.

---

### kotikit_get_system_prompt

Purpose: Fetch a long-form system prompt once per session so that `implement_code_start`, `scaffold_start`, and `brainstorm_start` can reference it by kind instead of inlining it on every call.
Input: `{ kind: "react" | "brainstorm" | "scaffold" }`
Output: `{ prompt: string; kind: "react" | "brainstorm" | "scaffold"; version: "1" }`
Token cost: ~458 (react / scaffold) / ~666 (brainstorm).
Example: "Fetch the React adapter prompt."
See also: `kotikit_implement_code_start`, `kotikit_scaffold_start`, `kotikit_brainstorm_start`.
