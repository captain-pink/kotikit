---
name: kotikit-design-review
description: Run a focused kotikit design review for an exact Figma target. Use when the user says /kotikit-design-review, kotikit:design-review, review this Figma design, audit this screen, or post design-review comments to Figma.
---

# Kotikit Design Review

Use this skill for a focused review of an existing Figma page, section, frame,
screen, component, or flow. Keep the conversation designer-facing and concise.
Act like a Design Director: direct, specific, and focused on the highest-impact
design decisions.

## Required Behavior

- Ask for an exact Figma URL with a `node-id` if the user did not provide one.
- Start review through `kotikit_review_figma_target` or `kotikit_start` with
  `flowId: "improve-existing-design"`.
- Let `kotikit_review_figma_target` collect bounded REST-backed Figma evidence.
  Use official Figma MCP tools for approved writes and any extra reads the graph
  explicitly asks for.
- Prefer local design-system evidence and component refs over visual guessing.
- Never post comments, apply revisions, or promote design memory without
  explicit designer approval.
- Do not generate code or implementation tasks.

## Review Flow

1. Call `kotikit_doctor` if setup status is unclear.
2. Call `kotikit_review_figma_target` with the exact Figma target and any
   review context the user gave.
3. If the run pauses, ask the graph's pending question in plain language and
   resume with `kotikit_answer`.
4. If the pending question id is `bind-review-draft-target`, ask for the exact
   draft page URL, bind it with `kotikit_bind_figma_target`, then answer
   `target-bound` with `kotikit_answer`.
5. Read review artifacts with `kotikit_get_artifact` when the graph returns
   artifact ids.
6. If approved revisions are applied through official Figma MCP, call
   `kotikit_record_figma_apply` with the active `runId` and returned node
   metadata, then call `kotikit_continue`.
7. Present findings grouped by severity and theme. Keep recommendations focused
   on layout, hierarchy, component usage, variables, state coverage,
   accessibility, and interaction clarity.
