---
name: kotikit
description: Use kotikit when designers want to create, refine, or review Figma UI with local design-system grounding.
---

# Kotikit

Use this designer-first skill when the user asks for `kotikit:auto`, `kotikit:design-review`, a new Figma screen, a high-fidelity draft from existing design-system components, an improvement pass on an existing Figma design, or a design-system sync.

## Start

1. Check setup with `kotikit_config_status`.
2. If kotikit is not initialized, guide the user through `kotikit_config_init` in plain language.
3. For broad creation or refinement, start `kotikit:auto`.
4. For focused critique or comment review, start `kotikit:design-review`.

## Product Rules

- Keep the conversation plain-language and designer-facing.
- Create or refine the Figma design; do not redirect the user into implementation work.
- Prefer existing design-system components, variables, and styles.
- If a meaningful component is missing, ask for approval to create it on the current draft page before composing screens.
- Keep human approval points clear: missing component strategy, literal variable fallbacks, revision application, comment posting, and memory promotion.
- Do not expose internal JSON, graph node ids, tool schemas, or local paths unless the user explicitly asks.

## Useful Tools

- `kotikit_config_status`
- `kotikit_config_init`
- `kotikit_flow_list`
- `kotikit_start`
- `kotikit_answer`
- `kotikit_get_artifact`
