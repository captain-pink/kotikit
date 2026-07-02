---
name: kotikit-auto
description: Run the kotikit auto workflow with MCP tools. Use when the user says kotikit:auto, run kotikit auto, build a screen with kotikit, sync my Figma design system, create a Figma design, review Figma comments, or work on kotikit screen and flow specs.
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
  flow id. Use `create-screen` for screen drafting, `create-product-flow` for
  multi-screen flows, `sync-design-system` for local sync,
  `improve-existing-design` for a Figma target, and `review-comments` for
  comment review.
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
3. When running in Codex, include
   `coAuthor: { name: "Codex", email: "noreply@openai.com" }` unless the user
   explicitly asks for different commit metadata.

## Create Or Refine Design

1. Ask what the designer wants to create or improve if they have not already
   said it.
2. Call `kotikit_flow_list` if you need to choose a flow.
3. Call `kotikit_start` with the chosen flow and `userIntent`.
4. When the run pauses, ask the pending question in plain language and resume
   with `kotikit_answer`.
5. If the pending question id is `bind-review-draft-target`, ask for the exact
   draft page URL, bind it with `kotikit_bind_figma_target`, then answer
   `target-bound` with `kotikit_answer`.
6. If the run needs any other Figma target, ask for the exact draft page URL and
   bind it with `kotikit_bind_figma_target`.
7. If the run produces a `design-system-reuse-plan` artifact, read it before
   drafting. Reuse exact design-system components, validate substitutes, wrap
   or compose close candidates, and create draft components only for true gaps.
8. If the run produces an apply-packet artifact, read it with
   `kotikit_get_artifact`, apply only the active Figma transaction through
   official Figma MCP tools, then call `kotikit_record_figma_apply` with the
   `runId`, `transactionId`, node id, bounds, component refs, component
   source, variable refs, required icon refs, and auto-layout metadata.
9. Call `kotikit_continue` after external Figma work is recorded. Repeat until
   kotikit reports no active Figma transaction.
10. If the run produces a `design-system-usage-report`, use it in the final
   answer to summarize reused design-system components, draft components, icon
   refs, and primitive exceptions.

When applying a kotikit draft in Figma:

- Use the apply packet's active transaction.
- Create exactly one draft component, screen state, or region state per Figma
  write.
- Place it at the bounds from the canvas plan.
- Use auto layout, imported design-system component instances, and
  variables/styles.
- Record `transactionId`, node id, bounds, component refs, component source,
  variable refs, required icon refs, and auto-layout metadata with
  `kotikit_record_figma_apply`.
- Continue the run and repeat until kotikit reports no active Figma
  transaction.
- Do not create every state on the canvas in one operation.

## Design-System Sync

1. Start `sync-design-system` with `kotikit_start`, or use `kotikit_sync_ds`
   directly when the user explicitly asks only for sync.
2. If no design-system file is configured, ask for the Figma file URL or key and
   call `kotikit_config_init` with `figmaFiles`.
3. Summarize sync results in plain language.
4. If REST variables are unavailable, offer the local plugin variable fallback:
   call `kotikit_bridge_start`, give the returned URL, and guide the designer
   through the Figma plugin variable export.

## Review

For existing design review, call `kotikit_review_figma_target` with an exact
Figma URL or start `improve-existing-design` with `kotikit_start`.

For comment review, start `review-comments` with `kotikit_start` and seed the
available comment context if another tool already collected it.

Never post comments, apply revisions, accept literal variable fallbacks, or
promote memory without explicit designer approval.
