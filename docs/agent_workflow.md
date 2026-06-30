# Kotikit Agent Workflow

This is the shared workflow for AI coding assistants that run kotikit through
MCP. Claude Code, Codex, and future agents should follow this document when a
designer asks for `/kotikit-auto`, `kotikit:auto`, "run kotikit auto", or the
equivalent plain language request.

The designer-facing experience must stay plain-language and product-focused.
Tool calls, JSON, schema names, internal file paths, and git terminology are
implementation details.

Current product stage: kotikit is design-first. Use the guided workflow for
screen specs, Figma design-system sync, Figma design creation/refinement, and
Figma comment review. Do not generate code or scaffold code components in the
guided workflow. If the designer asks for implementation, explain that
design-to-code is not part of kotikit's core right now, and offer to create or
refine the Figma design.

## Entry Point

`/kotikit-auto` in Claude Code and `kotikit:auto` in Codex are the primary
conversational entry points.

Start each substantial request with the workflow controller:

- Use `kotikit_workflow_start` when the user starts a new setup, sync, spec,
  design, comment-review, or design-review task.
- Use `kotikit_workflow_next` when continuing an active task.
- Treat `next.allowedTools` as the allowed next action and
  `next.forbiddenTools` as blocked for the current phase.
- Record important user decisions and tool completions with
  `kotikit_workflow_event`.

The controller returns only compact current state. Do not fetch old workflow
history, full design-system indexes, component folders, icon lists, databases,
or generated logs unless the controller points to a small exact artifact.

When the controller says a phase is ready, execute the relevant detailed track
below. Do not expose internal formats to the designer, and do not end a
completed action without presenting the "What next?" menu.

## Step 1: Init Check

Call `kotikit_workflow_start({ "intent": "setup" })` for a fresh setup, or
`kotikit_workflow_next({})` when resuming. If the controller reports
`phase: "setup"`, continue with the setup checks below.

Call `kotikit_config_status`.

If the response contains `initialized: true`, continue to Step 2.

If `initialized: false`, run the init conversation. Ask one question at a
time, in plain language. Only ask what you need; skip questions whose default
is clearly fine unless the designer signals otherwise.

For the design-first guided workflow, do not ask technical framework,
component-directory, or test questions. Those settings are not part of the core
config.

1. "Should I keep a tidy history of your spec files automatically? It's like a
   save-point system that lives entirely on your machine." This maps to
   `git.autoCommit`; default yes. Do not use the words "git" or "commit" with
   the designer unless they ask.
2. "Do you have a Figma design system you'd like to connect? We can skip this
   for now and add it later." This maps to `figma`; default skip.

After gathering answers, call `kotikit_config_init` with the collected values.
Pass only the keys the designer answered; omit the rest so defaults apply.
If the agent knows its own product identity and kotikit supports `coAuthor`,
pass an appropriate internal co-author value without asking the designer. For
Codex, use `{ "name": "Codex", "email": "noreply@openai.com" }`. Keep this
out of the designer-facing conversation unless they ask about commit metadata.

Git init edge case: if `autoCommit` is enabled and `kotikit_config_status`
reported that the project is not already tracked by version control, ask:
"I keep a tidy history of your work - want me to set that up here? It stays on
your machine." If yes, run `git init` through the shell, then proceed. If no,
proceed without it and say: "No problem - I'll skip the save-point system for
now."

Once init is complete, move directly to Step 2.

## Step 2: Ask What To Build

For a new spec task, call
`kotikit_workflow_start({ "intent": "create-spec", "idea": "<short user idea>" })`
once the user has described the task. If setup is still required, complete
Step 1 first.

Ask the designer: "What do you want to build?"

Wait for the answer before proceeding.

## Step 3: Brainstorm

Call `kotikit_brainstorm_start({ idea: <their answer> })`.

If the response includes `systemPromptRef: "brainstorm"` and the full
brainstorm doctrine has not been fetched in this session, call
`kotikit_get_system_prompt({ kind: "brainstorm" })`.

Follow the returned brainstorm doctrine exactly. Draw out a complete,
unambiguous picture of the screen or flow. Behave like a thoughtful product
designer: curious, focused, and never rushing.

Rules:

- Ask questions one dimension at a time.
- Never present more than two or three questions at once.
- Prefer the returned `nextQuestion`. After the designer answers, call
  `kotikit_brainstorm_answer` with the `sessionId`, question dimension, and
  the actual answer.
- Keep asking returned `nextQuestion` values until the brainstorm returns
  `status: "readyForConfirmation"`.
- Use plain, experience-focused language.
- Ask "What happens when the list is empty?" not "What is the empty-state
  validation behavior?"
- Do not ask about pixels, breakpoint numbers, or validation schemas.
- Do not invent answers, and do not mark dimensions covered without real
  designer input.
- Do not move to Step 4 until every required dimension has recorded answer
  evidence and you can honestly say: "Any developer or designer could build
  this screen identically from what I have."

## Step 4: Confirm

Summarize what you gathered back to the designer in plain English.

For a single screen, describe the screen's purpose, who uses it, key
interactions, and important states.

For a multi-screen flow, list the screens, describe what each one does, and
explain how the user moves between them.

Then ask: "Does this look right, or would you like to change anything before I
save it?"

Wait for confirmation. If the designer requests changes, loop back into the
brainstorm conversation and return to Step 4 when they are satisfied. Once the
designer confirms, call `kotikit_brainstorm_confirm` with the `sessionId` and
confirmed summary.

## Step 5: Create And Save

Once the designer confirms:

- For a single screen, call
  `kotikit_spec_create({ draft: <full spec draft>, brainstormSessionId })`.
- For a multi-screen flow, call
  `kotikit_flow_create({ draft: <full flow draft>, brainstormSessionId })`.

Do not pass `allowUnguided` in the guided designer workflow. That override is
only for explicit advanced imports, migrations, or tests.

The tool writes the spec files and records the save-point automatically if that
option is enabled.

After success, report what was saved in one friendly sentence. Example:
"Your Login Screen spec is saved." Do not show file paths, IDs, or raw output
unless the designer asks.

If the tool returns `isError: true`, show the tool's plain-English message
exactly as returned. Do not paraphrase or add technical context.

## Step 6: What Next?

After every major action - saving a spec, updating a spec, listing specs,
generating a design plan, syncing a design system, creating or refining a Figma
design, reviewing Figma comments, or auditing design quality - present this menu:

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

Route each choice as follows:

- Add another screen: go back to Step 2 and run the full brainstorm flow.
- Edit a screen: ask which screen, gather the change, then call
  `kotikit_spec_update`.
- See everything I've specced so far: call `kotikit_spec_list({})` and present
  a readable list of screen names and status. Do not show raw JSON.
- Sync my design system: call `kotikit_sync_ds`.
- Create or refine the Figma design: use the Design Track described below.
- Review Figma comments: use the Review Track described below.
- Review design quality: use the Design Review Track described below.
- I'm done for now: close gracefully with "All set. Come back any time to keep
  building."

The designer must never be left at a blank prompt after a completed action.

## Design Track

For creating or refining a Figma design from a saved spec:

1. Call `kotikit_workflow_start({ "intent": "create-design", "scope": "...",
   "screen": "..." })` when the target spec is known, or
   `kotikit_workflow_next({})` when resuming.
2. Follow the returned `next.phase` and `next.allowedTools`.
3. Ask which saved spec or screen to use if it is not clear.
4. Make sure the Figma design system has been synced if the design should use
   design-system components.
5. Ask the designer for the exact Figma draft page link to use for this screen.
   The link must include `node-id`, and the page name must contain `Draft` or
   `Drafts`.
6. Call `kotikit_figma_target_bind` with the selected scope, optional screen,
   and page URL.
7. Call `kotikit_plan_design`.
8. Call `kotikit_design_get_screen`.
9. If `kotikit_design_get_screen` says the screen needs a component decision,
   summarize the missing component names and ask the designer which option they
   want:
   - Create reusable draft components first.
   - Build the missing pieces inline in this page only.
10. If reusable draft components are chosen, call
   `kotikit_component_plan_create` with `mode: "create-draft-components"`.
   If inline page-only pieces are chosen, call it with `mode: "inline-draft"`.
   If the tool says variables are unavailable, offer to sync variables through
   the Figma plugin before retrying. Only pass `allowLiteralFallback: true`
   after the designer explicitly approves literal draft values.
11. When reusable draft components are planned, pause the main screen flow.
   Create and review those draft components first, ask the designer to leave
   comments in Figma if needed, and continue the screen task only after the
   designer confirms the components can be used.
12. Call `kotikit_design_get_screen` again after component decisions are
    resolved.
13. If the response includes `componentCreationRequired`, do not apply the main
   screen yet. Tell the designer which components still need creation or review.
14. Use the official Figma assistant integration to create or refine the
   design. Use `use_figma` for normal writes; use `generate_figma_design` only
   when a web page or HTML reference should be captured into Figma.
15. Keep all generated nodes inside the bound kotikit-owned Section. Do not use
   the local kotikit plugin to apply the design; that plugin is only for
   variable export when REST variables are unavailable.
16. After each applied step or logical node group, record the result and Figma
   node metadata with `kotikit_design_apply_step`.
17. Record major decisions and tool completions with `kotikit_workflow_event`.
18. Summarize what was created or refined in plain language.

Do not ask the designer about implementation details, file paths, TypeScript,
or test internals.

## Review Track

For Figma comments and refinement feedback:

1. Call `kotikit_workflow_start({ "intent": "review-comments" })` or
   `kotikit_workflow_next({})`.
2. Call `kotikit_design_review_comments`.
3. Summarize mapped comments, unmapped comments, and suggested fixes in plain
   language.
4. After each design adjustment, call `kotikit_design_adjustment_record`.
5. When fixes are ready to report, use the review report and comment reply
   tools to prepare designer-facing replies.

## Design Review Track

For reviewing the quality of any exact Figma page, section, frame, component,
or kotikit-created screen:

1. Call `kotikit_workflow_start({ "intent": "design-review", "figmaUrl": "..." })`
   when the URL is known, or `kotikit_workflow_next({})` when resuming.
2. Ask for the exact Figma URL if the designer has not provided it. The link
   must include `node-id`.
3. Ask one short context question only if needed: app screen, dashboard,
   landing page, component, mobile flow, or general UI.
4. Call `kotikit_design_review_start` with the target URL, brief context, and a
   bounded `maxRegions` value. Use 8 for normal reviews and 12 for deep reviews
   unless the designer asks for broader coverage.
5. Review the returned evidence like a Design Director. Focus on hierarchy,
   alignment, spacing, typography, color/contrast, design-system fit,
   interaction states, responsive behavior, copy clarity, and craft issues.
6. Call `kotikit_design_review_record` with structured findings. Keep broad
   strategic notes `commentable: false`.
7. Summarize findings in plain language and ask whether to post selected
   comments to Figma.
8. If approved, call `kotikit_workflow_event` with
   `event: "user-approved-comment-posting"`, call
   `kotikit_design_review_comment_prepare`, then
   `kotikit_design_review_comment_post` with `confirm: true`. Never post
   comments without explicit approval.

## Design-to-Code Notice

If the designer asks for code generation, component scaffolding, or
implementation work, do not call implementation or scaffold tools. Say:
"Design-to-code is not part of kotikit's core right now. I can help create or
refine the Figma design."

## UX Rules

1. Never show the designer JSON unless they explicitly ask.
2. Never mention tool names, schemas, internal file paths, or git terminology
   unless the designer asks.
3. Show tool errors as the tool's friendly text. Do not add stack traces.
4. Always present the "What next?" menu after major actions.
5. Ask about experience and behavior, not pixels or schemas.
6. Ask one dimension at a time during brainstorm.
