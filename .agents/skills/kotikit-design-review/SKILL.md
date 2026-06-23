---
name: kotikit-design-review
description: Run a focused kotikit design review for any exact Figma page, section, frame, component, or kotikit-created screen. Use when the user says /kotikit-design-review, kotikit:design-review, review this Figma design, audit this screen, or post design-review comments to Figma.
---

# Kotikit Design Review

Use this self-contained skill to review Figma designs through kotikit MCP tools.
It must work after being copied into a target project, so do not read workflow
docs from the target project.

This is a design critique workflow, not a code-review workflow. Think like a
Design Director: judge clarity, hierarchy, system fit, interaction quality, and
craft. Be specific and actionable.

## Required Behavior

- Use only `kotikit_*` MCP tools for kotikit state.
- Start with `kotikit_workflow_start({ intent: "design-review", figmaUrl })`
  when the URL is known, or `kotikit_workflow_next({})` when continuing.
  Follow the returned `next.allowedTools`.
- Review exact Figma targets only: page, section, frame, component, or a
  kotikit-created screen.
- If no exact Figma URL is provided, ask for one with `node-id`.
- Ask one short context question if the surface type or review goal is unclear.
- Keep evidence bounded. Do not ask the assistant to load a whole Figma file or
  full design tree.
- Store findings with `kotikit_design_review_record`.
- Never post Figma comments without asking the user first.
- If the user approves posting, call `kotikit_design_review_comment_prepare`,
  then `kotikit_design_review_comment_post` with `confirm: true`.
- Keep posted comments focused. Prefer the top 5-12 actionable findings.

## Review Flow

1. Confirm kotikit MCP tools are available. If not, tell the user to run the
   local scaffold command from the kotikit repo and restart the assistant.
2. Ask for the exact Figma target link if the user did not provide one.
3. Ask for missing context only when needed:
   - surface type: app screen, dashboard, landing page, component, mobile flow,
     or general UI
   - review goal: polish, usability, design-system fit, accessibility, or
     production readiness
4. Call `kotikit_workflow_start({ intent: "design-review", figmaUrl })` once
   the Figma URL is available.
5. Call `kotikit_design_review_start` with the Figma URL, brief context, and a
   modest `maxRegions` value. Use `8` for normal reviews and `12` for deep
   reviews unless the user explicitly asks for broader coverage.
6. Review the returned evidence as a Design Director using the rubric below.
7. Call `kotikit_design_review_record` with structured findings.
8. Summarize findings by severity in plain language.
9. Ask whether to post selected comments to Figma.
10. If yes, record approval with `kotikit_workflow_event`, then prepare and
    post comments. If no, leave the structured report saved.

## Rubric

Review these dimensions, but do not force every category into the report:

- First impression: can the user understand the screen quickly?
- Visual hierarchy: title, primary action, grouping, scan order.
- Layout and alignment: grids, columns, repeated controls, edge rhythm.
- Spacing and density: consistent rhythm, sufficient breathing room, no drift.
- Typography: scale, weight, contrast, truncation, line length.
- Color and contrast: semantic use, accessible contrast, state clarity.
- Design-system fit: uses available components and token-like values.
- Interaction states: default, hover/focus, selected, loading, empty, error.
- Responsive behavior: mobile/desktop composition and control ergonomics.
- Content clarity: labels, microcopy, empty states, destructive actions.
- Craft issues: broken icons, clipped text, awkward grouping, AI-like filler.

## Finding Shape

Each recorded finding should include:

- `category`
- `severity`: `critical`, `high`, `medium`, or `polish`
- `confidence`: `observed`, `inferred`, or `needs-decision`
- `title`
- `observation`
- `rationale`
- `recommendation`
- optional `nodeId` or `region`
- `commentable`
- optional `suggestedComment`

Use `commentable: false` for broad strategy notes that would be noisy as Figma
comments.

## Comment Discipline

Post comments only after approval. Group duplicate issues into one
representative comment. Do not comment on every tiny imperfection when one
systemic note would be clearer.
