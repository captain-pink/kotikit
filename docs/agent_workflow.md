# Kotikit Agent Workflow

This is the shared workflow for AI coding assistants that run kotikit through
MCP. Claude Code, Codex, and future agents should follow this document when a
designer asks for `/kotikit-auto`, `kotikit:auto`, "run kotikit auto", or the
equivalent plain language request.

The designer-facing experience must stay plain-language and product-focused.
Tool calls, JSON, schema names, internal file paths, and git terminology are
implementation details.

## Entry Point

`/kotikit-auto` in Claude Code and `kotikit:auto` in Codex are the primary
conversational entry points. When a designer starts either one, execute the six
steps below in order. Do not skip steps, do not expose internal formats to the
designer, and do not end a completed action without presenting the "What next?"
menu.

## Step 1: Init Check

Call `kotikit_config_status`.

If the response contains `initialized: true`, continue to Step 2.

If `initialized: false`, run the init conversation. Ask one question at a
time, in plain language. Only ask what you need; skip questions whose default
is clearly fine unless the designer signals otherwise.

1. "What framework are you building in? I'll assume React unless you're using
   something else." This maps to `project.framework`; default `react`;
   currently the only supported value.
2. "Where do your components live? I'll default to `src/components` if that
   works." This maps to `project.codeComponentsDir`.
3. "Should I generate test files alongside your components?" This maps to
   `project.tests`; default yes.
4. "Should I keep a tidy history of your spec files automatically? It's like a
   save-point system that lives entirely on your machine." This maps to
   `git.autoCommit`; default yes. Do not use the words "git" or "commit" with
   the designer unless they ask.
5. "Do you have a Figma design system you'd like to connect? We can skip this
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
- Use plain, experience-focused language.
- Ask "What happens when the list is empty?" not "What is the empty-state
  validation behavior?"
- Do not ask about pixels, breakpoint numbers, or validation schemas.
- Periodically call `kotikit_brainstorm_assess` with your honest coverage
  assessment.
- Do not move to Step 4 until `kotikit_brainstorm_assess` confirms all
  required dimensions are covered and you can honestly say: "Any developer or
  designer could build this screen identically from what I have."

## Step 4: Confirm

Summarize what you gathered back to the designer in plain English.

For a single screen, describe the screen's purpose, who uses it, key
interactions, and important states.

For a multi-screen flow, list the screens, describe what each one does, and
explain how the user moves between them.

Then ask: "Does this look right, or would you like to change anything before I
save it?"

Wait for confirmation. If the designer requests changes, loop back into the
brainstorm conversation and return to Step 4 when they are satisfied.

## Step 5: Create And Save

Once the designer confirms:

- For a single screen, call `kotikit_spec_create({ draft: <full spec draft> })`.
- For a multi-screen flow, call `kotikit_flow_create({ draft: <full flow draft> })`.

The tool writes the spec files and records the save-point automatically if that
option is enabled.

After success, report what was saved in one friendly sentence. Example:
"Your Login Screen spec is saved." Do not show file paths, IDs, or raw output
unless the designer asks.

If the tool returns `isError: true`, show the tool's plain-English message
exactly as returned. Do not paraphrase or add technical context.

## Step 6: What Next?

After every major action - saving a spec, updating a spec, listing specs,
generating a plan, syncing a design system, scaffolding components, or
implementing code - present this menu:

```text
What next?
  - Add another screen
  - Edit a screen
  - See everything I've specced so far
  - Sync my design system
  - Generate code
  - I'm done for now
```

Route each choice as follows:

- Add another screen: go back to Step 2 and run the full brainstorm flow.
- Edit a screen: ask which screen, gather the change, then call
  `kotikit_spec_update`.
- See everything I've specced so far: call `kotikit_spec_list({})` and present
  a readable list of screen names and status. Do not show raw JSON.
- Sync my design system: call `kotikit_sync_ds`.
- Generate code: use the code track described below.
- I'm done for now: close gracefully with "All set. Come back any time to keep
  building."

The designer must never be left at a blank prompt after a completed action.

## Code Track

For screen implementation:

1. Call `kotikit_implement_code_start({ scope, screen? })`.
2. If the React doctrine has not been fetched in this session, call
   `kotikit_get_system_prompt({ kind: "react" })`.
3. Use `componentRefs` by default. Fetch only the component JSON needed with
   `kotikit_ds_get_component({ path })`.
4. Write the component and test files into the returned target paths.
5. Call `kotikit_implement_code_save`.
6. If gates fail, fix files in place and call `kotikit_implement_code_gate`.

Do not ask the designer about TypeScript, Tailwind classes, test internals, or
tool names unless they ask.

## Scaffold Track

For design-system component scaffolding:

1. Call `kotikit_scaffold_start`.
2. Keep batches small; default pagination is intentional.
3. If the scaffold doctrine has not been fetched in this session, call
   `kotikit_get_system_prompt({ kind: "scaffold" })`.
4. Refine the returned shapes into production code.
5. Call `kotikit_scaffold_save`.

## UX Rules

1. Never show the designer JSON unless they explicitly ask.
2. Never mention tool names, schemas, internal file paths, or git terminology
   unless the designer asks.
3. Show tool errors as the tool's friendly text. Do not add stack traces.
4. Always present the "What next?" menu after major actions.
5. Ask about experience and behavior, not pixels or schemas.
6. Ask one dimension at a time during brainstorm.
