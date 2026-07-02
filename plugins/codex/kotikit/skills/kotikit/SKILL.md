---
name: kotikit
description: Use kotikit when designers want to create Figma UI with local design-system grounding.
---

# Kotikit

Use this designer-first skill when the user asks for `kotikit:auto`, a new Figma screen, a high-fidelity draft from existing design-system components, or a design-system sync.

## Start

1. Check setup with `kotikit_config_status`.
2. If kotikit is not initialized, guide the user through `kotikit_config_init` in plain language.
3. For screen creation, start `kotikit:auto` and use the built-in `create-screen` flow.
4. For Figma comment feedback after a draft exists, use the built-in
   `review-screen` flow.
5. For design-system sync, use the direct sync tool only when the user explicitly asks.

## Product Rules

- Keep the conversation plain-language and designer-facing.
- Create the Figma design; do not redirect the user into implementation work.
- Prefer existing design-system components, variables, styles, and icons.
- Compose the visible screen and real states before asking whether missing parts should be extracted as draft components.
- Apply Figma drafts through incremental Figma transactions: create exactly one
  screen state or region state per write, place it at the
  canvas plan bounds, record `transactionId`, node id, bounds, component refs,
  variable refs, and auto-layout metadata, then continue the run.
- Keep human approval points clear: literal variable fallbacks and post-design draft component extraction.
- For comment feedback, read a compact snapshot, let `review-screen` create the
  evidence map and revision plan, then ask before applying changes.
- Do not post comments, resolve comment threads, or promote design memory from
  the tiny core.
- Do not expose internal JSON, graph node ids, tool schemas, or local paths unless the user explicitly asks.

## Useful Tools

- `kotikit_config_status`
- `kotikit_config_init`
- `kotikit_flow_list`
- `kotikit_start`
- `kotikit_answer`
- `kotikit_continue`
- `kotikit_get_artifact`
- `kotikit_feedback_snapshot`
