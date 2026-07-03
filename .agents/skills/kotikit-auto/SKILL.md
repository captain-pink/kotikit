---
name: kotikit-auto
description: Run the kotikit auto workflow with MCP tools. Use when the user says kotikit:auto, run kotikit auto, build a screen with kotikit, sync my Figma design system, create a Figma design, or work on kotikit screen specs.
---

# Kotikit Auto

Use this self-contained skill to operate kotikit through its MCP tools in
Claude Code or Codex. It must work after being copied into a target workspace,
so do not try to read workflow docs from the target project.

This skill assumes the kotikit MCP server is configured for the current target
workspace. If no `kotikit_*` tools are available, stop and tell the user that
kotikit MCP is not connected in this session. For source checkouts, ask them to
run the local scaffold from the kotikit repo:

```bash
bun run scaffold:agents -- --target /path/to/their-workspace --agents claude
```

Use `--agents codex` for Codex-only workspaces or `--agents both` when both
assistants should be configured. Plugin installs can use the bundled
`plugins/codex/kotikit` or `plugins/claude/kotikit` wrapper when `kotikit-mcp`
is available on `PATH`.

## Required Behavior

- Use the graph facade first: `kotikit_flow_list`, `kotikit_start`,
  `kotikit_answer`, `kotikit_continue`, `kotikit_get_artifact`, and
  `kotikit_list_artifacts`.
- Start every substantial design request with `kotikit_start` and a built-in
  flow id. The tiny kotikit core exposes `create-screen` for screen drafting
  and `review-screen` for post-screen Figma comment feedback. Use direct
  support tools such as `kotikit_sync_ds` only when the user explicitly asks
  for setup or design-system sync.
- Keep the designer-facing conversation plain-language and product-focused.
- Do not expose JSON, tool names, schemas, internal paths, or git terminology
  unless the user explicitly asks.
- Translate tool results into concise user-facing status.
- Show tool errors as the tool's friendly text.
- Never load whole design-system directories, manifests, icon lists, or
  databases into context.
- Do not generate code or scaffold code components. Design-to-code is not part
  of the kotikit core. If asked, offer to create or refine the Figma design.

## Setup

1. Call `kotikit_doctor`.
2. If kotikit is not initialized, call `kotikit_config_status`, ask only the
   missing setup questions, then call `kotikit_config_init`.

## Create Or Refine Design

1. Ask what the designer wants to create or improve if they have not already
   said it.
2. Call `kotikit_flow_list` if you need to choose a flow.
3. Call `kotikit_start` with the chosen flow and `userIntent`.
4. When the run pauses, ask the pending question in plain language and resume
   with `kotikit_answer`.
5. If the run needs a Figma target, ask for the exact draft page URL and
   call `kotikit_bind_figma_target` with `pageUrl`. Do not hand-build target
   JSON unless kotikit explicitly asks for a canonical target object.
6. If the run produces a `design-approach` artifact, read it before drafting.
   Use it as the lightweight brainstorm result: follow the recommended
   workflow, state strategy, layout strategy, design-system strategy, icon
   strategy, assumptions, and risks. Do not recite the artifact to the designer
   unless they ask.
7. If the run produces a `design-system-reuse-plan` artifact, read it before
   drafting. Reuse exact design-system components, validate substitutes, and
   compose close candidates directly in the screen. Do not create draft
   components before the main screen or flow exists.
8. If the run produces an apply-packet artifact, read it with
   `kotikit_get_artifact`, apply only the active Figma transaction through
   official Figma MCP tools, read its `evidenceChecklist`, scan the applied root node, then call
   `kotikit_record_figma_apply` with the `runId`, `transactionId`, node id,
   Figma node type, bounds, component refs or componentKey, component source,
   variable refs, required icon refs, auto-layout metadata, and
   `evidenceSnapshot`.
9. Call `kotikit_continue` after external Figma work is recorded. Repeat until
   kotikit reports no active Figma transaction.
10. If the run produces a `design-system-usage-report`, use it in the final
   answer to summarize reused design-system components, screen-draft parts,
   draft components, icon refs, and primitive exceptions. After the design is
   visible, ask whether the designer wants reusable missing parts extracted as
   draft components on the same draft page.

When applying a kotikit draft in Figma:

- Use the apply packet's active transaction.
- Create exactly one screen state or region state per Figma write.
- Place it at the bounds from the canvas plan.
- Use auto layout, imported design-system component instances, and
  variables/styles.
- Treat every `evidenceChecklist.existingComponents[]` item as a visible UI
  requirement. The matching Figma node must be a visible `INSTANCE` whose
  component key is the listed local design-system key.
- After the write, scan the applied root node and include compact evidence for
  visible component instances, local DS component/icon keys, layout mode,
  bounds, visibility, opacity, and layout metrics.
- Shape scanner output as `FigmaEvidenceSnapshot/v1` with compact arrays named
  `parts`, `componentInstances`, `layoutFrames`, and `icons`, plus
  `summary.directVisibleChildCount` and `summary.autoLayoutContainerCount`.
- Take a screenshot of the applied root frame after placing or changing visible
  design-system components. Inspect it for overlap, clipped or mirrored text,
  broken component internals, and layout drift.
- Record `transactionId`, node id, Figma node type, bounds, component refs or
  componentKey, component source, variable refs, required icon refs,
  auto-layout metadata, `screenshotReviewed: true`, any
  `screenshotFindings`, and `evidenceSnapshot` with `kotikit_record_figma_apply`.
- Continue the run and repeat until kotikit reports no active Figma
  transaction.
- Do not create every state on the canvas in one operation.
- Do not create draft components before composing the actual screen or flow.
- Do not add visible or low-opacity proof nodes. If evidence fails, repair the
  same active transaction by using the planned DS component as the real UI.
- Do not hand-build text or rectangles for a part that the apply packet marked
  as `existing-component`; import and place the design-system instance first,
  then compose surrounding screen-draft structure around it.
- Newly created local components do not count as existing design-system reuse.
  Existing DS reuse means a visible instance whose main component key came from
  the pre-run local design-system search result.
- Do not finish or summarize manual Figma work while kotikit is blocked or
  waiting for an active transaction. Follow the recovery action or report the
  blocker plainly.

## Review Figma Comments

Use this path after a generated design exists and the designer asks to review
Figma comments or make changes from feedback.

1. Use `kotikit_feedback_snapshot` with the Figma URL or file key. If a
   `review-screen` run is already active, pass its `runId`.
2. Start `review-screen` with the snapshot as `feedback` when there is no active
   review run.
3. Read `comment-evidence-map` and `revision-plan` artifacts when they appear.
4. Explain proposed changes in design language.
5. Ask before applying revisions.
6. If approved, apply changes through official Figma MCP in small increments and
   record metadata with `kotikit_record_figma_apply`.

Do not post comments, resolve comment threads, or promote feedback into memory
from the tiny core.

## Design-System Sync

1. Use `kotikit_sync_ds` when the user explicitly asks for sync.
2. If no design-system file is configured, ask for the Figma file URL or key and
   call `kotikit_config_init` with `figmaFiles`.
3. Summarize sync results in plain language.
4. If REST variables are unavailable, offer the local plugin variable fallback:
   call `kotikit_bridge_start`, give the returned URL, and guide the designer
   through the Figma plugin variable export.

Never apply revisions, accept literal variable fallbacks, or extract reusable
draft components without explicit designer approval.
