---
name: kotikit-auto
description: Run the kotikit auto workflow with MCP tools. Use when the user says kotikit:auto, run kotikit auto, build a screen with kotikit, sync my Figma design system, create a Figma design from a saved spec, review Figma comments, or work on kotikit screen and flow specs.
---

# Kotikit Auto

Use this self-contained skill to operate kotikit through its MCP tools in
Claude Code or Codex. It must work after being copied into a target workspace,
so do not try to read workflow docs from the target project.

This skill assumes the kotikit MCP server is configured for the current target
project. If no `kotikit_*` tools are available, stop and tell the user that
kotikit MCP is not connected in this session. Ask them to run the local scaffold
from the kotikit repo for their current assistant:

```bash
bun run scaffold:agents -- --target /path/to/their-workspace --agents claude
```

Use `--agents codex` for Codex-only workspaces or `--agents both` when both
assistants should be configured. Then ask them to restart their assistant in the
target workspace and run `/mcp`.

## Required Behavior

- Use the `kotikit_*` MCP tools.
- Start every substantial request by calling `kotikit_workflow_start` with the
  best matching intent, or `kotikit_workflow_next` if a workflow is already
  active. Treat the returned `next.allowedTools` as the allowed next action.
- Stay token-efficient: do not fetch old workflow history, full design-system
  indexes, component folders, icon lists, databases, or generated logs unless a
  workflow tool explicitly points to a small exact artifact.
- Keep the designer-facing conversation plain-language and product-focused.
- Do not expose JSON, tool names, schemas, internal paths, or git terminology
  unless the user explicitly asks.
- Translate tool results into concise user-facing status.
- Show tool errors as the tool's friendly text.
- After major actions, present the "What next?" menu.
- Never ask the user to edit JSON/TOML unless the MCP tools are unavailable.
- Never load whole design-system directories, manifests, icon lists, or
  databases into context.
- Do not generate React code or scaffold code components in the guided workflow
  yet. If asked, explain that design-to-code is coming in a later version once
  design creation is stable, then offer to create or refine the Figma design.

## Init Workflow

1. Call `kotikit_workflow_start({ intent: "setup" })` or
   `kotikit_workflow_next({})` if a workflow is already active.
2. If the workflow says `phase: "setup"`, call `kotikit_config_status`.
3. If `initialized: true`, continue with the user's requested workflow.
4. If `initialized: false`, keep setup design-first:
   - Use the default React project settings silently. They only reserve the
     future design-to-code path and do not mean the designer must write React.
   - Ask whether to keep a local save-point history. Default yes. Do not say
     "git" or "commit" unless the user asks.
   - Ask whether to connect a Figma design system now. It can be skipped.
   - Ask technical framework, component-directory, or test questions only if the
     user explicitly asks about experimental implementation/code output.
5. Call `kotikit_config_init` with only the values the user answered. When
   running in Codex, include
   `coAuthor: { name: "Codex", email: "noreply@openai.com" }` unless the user
   explicitly asks for different commit metadata.
6. If setup reports missing gate tools, tell the user the exact friendly
   message from the tool and ask whether they want to install the missing
   packages.
7. Record the result with `kotikit_workflow_event` and continue with the user's
   requested workflow.

## Auto Workflow

Use this when the user says `/kotikit-auto`, `kotikit:auto`, asks to initialize
kotikit, or asks to build/spec a screen or flow.

1. Call `kotikit_workflow_start({ intent: "create-spec", idea })` once the
   user has described what they want. If setup is required, run the Init
   Workflow first.
2. Ask: "What do you want to build?" unless the user already said it.
3. Call `kotikit_brainstorm_start({ idea })` and keep the returned
   `sessionId`.
4. Fetch `kotikit_get_system_prompt({ kind: "brainstorm" })` once per session
   if the brainstorm tool returns `systemPromptRef`.
5. Ask the returned `nextQuestion`. After the designer answers, call
   `kotikit_brainstorm_answer` with the `sessionId`, the question's
   `dimension`, and the designer's answer. Repeat with each returned
   `nextQuestion` until the tool returns `status: "readyForConfirmation"`.
   Do not invent answers, and do not mark dimensions covered without real
   designer input.
6. Summarize the gathered screen or flow in plain English and ask whether it
   looks right before saving.
7. After the designer confirms, call `kotikit_brainstorm_confirm` with the
   `sessionId` and confirmed summary.
8. Save with `kotikit_spec_create` or `kotikit_flow_create`, passing the
   confirmed `brainstormSessionId`. Do not pass `allowUnguided` in the guided
   workflow.
9. Record the save result with `kotikit_workflow_event`, then present the
   "What next?" menu.

## Sync Workflow

Use this when the user asks to sync Figma or connect a design system.

1. Call `kotikit_workflow_start({ intent: "sync-design-system" })` or
   `kotikit_workflow_next({})`.
2. Follow the returned next action. If no Figma design system is configured,
   ask for the Figma file URL or file key and call `kotikit_config_init` with
   `figmaFiles`.
3. When `next.allowedTools` includes `kotikit_sync_ds`, call `kotikit_sync_ds`.
4. Summarize the sync result in plain language.
5. If the sync says Figma Variables REST API requires Enterprise, explain that
   components and styles are usable, then offer the plugin-assisted fallback:
   call `kotikit_bridge_start`, give the designer the returned bridge URL,
   tell them the plugin build and manifest were prepared automatically, ask them
   to open the source design-system file in Figma, run the kotikit plugin,
   connect to the bridge URL, and click "Sync Variables From Open File".
   Do not ask the designer to hand-edit token JSON unless they explicitly
   prefer a manual token workflow.
6. Record the sync result with `kotikit_workflow_event`, then present the
   "What next?" menu.

## Design Workflow

Use this when the user asks to create or refine a Figma design from a saved
screen or flow spec.

1. Call `kotikit_workflow_start({ intent: "create-design", scope, screen })`
   once the target spec is known, or `kotikit_workflow_next({})` to resume.
2. Follow the returned `next.phase` and `next.allowedTools`. Ask which saved
   spec or screen to use if it is not clear.
3. Make sure the Figma design system has been synced if the design should use
   design-system components.
4. Ask the user for the exact Figma draft page link to use for this screen.
   The link must include `node-id`, and the page name must contain `Draft` or
   `Drafts`.
5. Call `kotikit_figma_target_bind` with the selected scope, optional screen,
   and page URL.
6. Call `kotikit_plan_design`.
7. Call `kotikit_design_get_screen`.
8. If `kotikit_design_get_screen` says a component decision is needed,
   summarize the missing components and ask the user how to proceed:
   - Create reusable draft components first.
   - Build the missing pieces inline in this page only.
9. Call `kotikit_component_plan_create` with
   `mode: "create-draft-components"` for reusable draft components, or
   `mode: "inline-draft"` for page-only inline pieces.
10. If the tool says variables are unavailable, offer the plugin variable sync
   before retrying. Only pass `allowLiteralFallback: true` after the user
   explicitly approves draft-only literal values.
11. For reusable draft components, pause the main screen flow until the
   components are created and the user confirms they can be used. Ask the user
   to leave Figma comments if they want refinements.
12. Call `kotikit_design_get_screen` again after component decisions are
   resolved. If it returns `componentCreationRequired`, do not apply the main
   screen yet; explain which components still need creation or review.
13. If the Figma plugin bridge is not running, call `kotikit_bridge_start` and
   give the designer the returned bridge URL.
14. Ask the designer to open the bound Figma draft file and page, run the
   kotikit plugin, and connect to the bridge URL. The plugin will create or
   reuse a kotikit-owned Section and apply all generated frames inside it.
15. Apply the design plan step by step through the plugin, recording each result
   with `kotikit_design_apply_step`.
16. Record major decisions and tool completions with `kotikit_workflow_event`.
17. Summarize what was created or refined, then present the "What next?" menu.

## Review Workflow

Use this when the user asks to read, review, or resolve Figma comments.

1. Call `kotikit_workflow_start({ intent: "review-comments", scope, screen })`
   or `kotikit_workflow_next({})`.
2. Call `kotikit_design_review_comments`.
3. Summarize mapped comments, unmapped comments, and suggested fixes in plain
   language.
4. After each design adjustment, call `kotikit_design_adjustment_record`.
5. When fixes are ready to report, use the review report and comment reply tools
   to prepare designer-facing replies.
6. Present the "What next?" menu.

## Design Review Workflow

Use this when the user asks to review design quality, audit a Figma screen,
run `kotikit:design-review`, or run `/kotikit-design-review`.

1. Call `kotikit_workflow_start({ intent: "design-review", figmaUrl })` or
   `kotikit_workflow_next({})`.
2. Ask for the exact Figma URL if the user did not provide one. The link must
   include `node-id`.
3. Ask one short context question only if the surface type or review goal is
   unclear.
4. Call `kotikit_design_review_start` with the URL, brief context, and bounded
   evidence. Use `maxRegions: 8` for normal reviews and `maxRegions: 12` for
   deep reviews unless the user asks for broader coverage.
5. Review the returned evidence like a Design Director. Focus on hierarchy,
   layout, spacing, typography, color/contrast, design-system fit, interaction
   states, responsive behavior, copy clarity, accessibility, and craft issues.
6. Call `kotikit_design_review_record` with structured findings.
7. Summarize findings in plain language and ask whether the user wants selected
   comments posted to Figma.
8. If approved, call `kotikit_design_review_comment_prepare`, then
   `kotikit_design_review_comment_post` with `confirm: true`.
9. Present the "What next?" menu.

## Design-to-Code Notice

If the designer asks for React code, code generation, component scaffolding, or
implementation work, do not call code-generation or scaffold tools. Say:
"Design-to-code is coming in a later version once the design creation process is
stable. I can help create or refine the Figma design now."

## What Next Menu

After every major action, present:

```text
What next?
  - Add another screen
  - Edit a screen
  - See everything I've specced so far
  - Sync my design system
  - Create or refine the Figma design
  - Review Figma comments
  - Review design quality
  - I'm done for now
```

Route choices with kotikit tools:

- Add another screen: run Auto Workflow from the build question.
- Edit a screen: ask what should change, then call `kotikit_spec_update`.
- See everything: call `kotikit_spec_list` and present a readable list.
- Sync my design system: run Sync Workflow.
- Create or refine the Figma design: run Design Workflow.
- Review Figma comments: run Review Workflow.
- Review design quality: run Design Review Workflow.
- I'm done for now: close gracefully.

## Design-System Search Discipline

Search first. Fetch exact files second. Never load whole manifests, icon lists,
component directories, SQLite databases, or design-system snapshots into
context.
