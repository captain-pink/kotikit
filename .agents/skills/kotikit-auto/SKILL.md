---
name: kotikit-auto
description: Run the kotikit auto workflow with MCP tools. Use when the user says kotikit:auto, run kotikit auto, build a screen with kotikit, sync my Figma design system, generate React code from Figma components, scaffold design-system components, or work on kotikit specs/code generation.
---

# Kotikit Auto

Use this self-contained skill to operate kotikit through its MCP tools in
Claude Code or Codex. It must work after being copied into a target React
project, so do not try to read workflow docs from the target project.

This skill assumes the kotikit MCP server is configured for the current target
project. If no `kotikit_*` tools are available, stop and tell the user that
kotikit MCP is not connected in this session. Ask them to run the local scaffold
from the kotikit repo for their current assistant:

```bash
bun run scaffold:agents -- --target /path/to/their-react-project --agents claude
```

Use `--agents codex` for Codex-only projects or `--agents both` when both
assistants should be configured. Then ask them to restart their assistant in the
target project and run `/mcp`.

## Required Behavior

- Use the `kotikit_*` MCP tools.
- Keep the designer-facing conversation plain-language and product-focused.
- Do not expose JSON, tool names, schemas, internal paths, or git terminology
  unless the user explicitly asks.
- Translate tool results into concise user-facing status.
- Show tool errors as the tool's friendly text.
- After major actions, present the "What next?" menu.
- Never ask the user to edit JSON/TOML unless the MCP tools are unavailable.
- Never load whole design-system directories, manifests, icon lists, or
  databases into context.

## Init Workflow

1. Call `kotikit_config_status`.
2. If `initialized: true`, continue with the user's requested workflow.
3. If `initialized: false`, ask only the setup questions needed:
   - Framework. Default to React; it is currently the only supported value.
   - Components directory. Default to `src/components`.
   - Whether to generate tests. Default yes.
   - Whether to keep a local save-point history. Default yes. Do not say
     "git" or "commit" unless the user asks.
   - Whether to connect a Figma design system now. It can be skipped.
4. Call `kotikit_config_init` with only the values the user answered. When
   running in Codex, include
   `coAuthor: { name: "Codex", email: "noreply@openai.com" }` unless the user
   explicitly asks for different commit metadata.
5. If setup reports missing gate tools, tell the user the exact friendly
   message from the tool and ask whether they want to install the missing
   packages.
6. After setup, continue with the user's requested workflow.

## Auto Workflow

Use this when the user says `/kotikit-auto`, `kotikit:auto`, asks to initialize
kotikit, or asks to build/spec a screen or flow.

1. Run the Init Workflow.
2. Ask: "What do you want to build?" unless the user already said it.
3. Call `kotikit_brainstorm_start({ idea })`.
4. Fetch `kotikit_get_system_prompt({ kind: "brainstorm" })` once per session
   if the brainstorm tool returns `systemPromptRef`.
5. Ask focused product/design questions until coverage is complete.
6. Call `kotikit_brainstorm_assess` periodically.
7. Confirm the gathered screen or flow in plain English.
8. Save with `kotikit_spec_create` or `kotikit_flow_create`.
9. Present the "What next?" menu.

## Sync Workflow

Use this when the user asks to sync Figma or connect a design system.

1. Run the Init Workflow.
2. If no Figma design system is configured, ask for the Figma file URL or file
   key and call `kotikit_config_init` with `figmaFiles`.
3. Call `kotikit_sync_ds`.
4. Summarize the sync result in plain language.
5. If the sync says Figma Variables REST API requires Enterprise, explain that
   components and styles are usable, then offer the plugin-assisted fallback:
   start the kotikit bridge in the initialized project, ask the designer to
   open the source design-system file in Figma, run the kotikit plugin, connect
   to the bridge URL, and click "Sync Variables From Open File". Do not ask the
   designer to hand-edit token JSON unless they explicitly prefer a manual
   token workflow.
6. Present the "What next?" menu.

## Code Workflow

For implementation work:

1. Run the Init Workflow.
2. Ask which saved spec/screen to implement if it is not clear.
3. Call `kotikit_implement_code_start`.
4. Fetch `kotikit_get_system_prompt({ kind: "react" })` once per session.
5. Use returned `componentRefs`; fetch exact component JSON with
   `kotikit_ds_get_component` only when needed.
6. Write the returned target files.
7. Call `kotikit_implement_code_save`.
8. If gates fail, fix files in place and call `kotikit_implement_code_gate`.

## Scaffold Workflow

For design-system component scaffolding:

1. Run the Init Workflow.
2. Call `kotikit_scaffold_start`.
3. Keep batches small and use pagination.
4. Fetch `kotikit_get_system_prompt({ kind: "scaffold" })` once per session.
5. Refine returned component shapes into production code.
6. Call `kotikit_scaffold_save`.

## What Next Menu

After every major action, present:

```text
What next?
  - Add another screen
  - Edit a screen
  - See everything I've specced so far
  - Sync my design system
  - Generate code
  - I'm done for now
```

Route choices with kotikit tools:

- Add another screen: run Auto Workflow from the build question.
- Edit a screen: ask what should change, then call `kotikit_spec_update`.
- See everything: call `kotikit_spec_list` and present a readable list.
- Sync my design system: run Sync Workflow.
- Generate code: run Code Workflow.
- I'm done for now: close gracefully.

## Design-System Search Discipline

Search first. Fetch exact files second. Never load whole manifests, icon lists,
component directories, SQLite databases, or design-system snapshots into
context.
