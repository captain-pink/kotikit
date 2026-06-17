---
name: kotikit-auto
description: Run the kotikit auto workflow with MCP tools. Use when the user says kotikit:auto, run kotikit auto, build a screen with kotikit, sync my Figma design system, generate React code from Figma components, scaffold design-system components, or work on kotikit specs/code generation.
---

# Kotikit Auto

Use this skill to operate kotikit through its MCP tools in Codex.

Before acting, read `../../../docs/agent_workflow.md` when available. That file
is the canonical workflow shared by Claude Code, Codex, and future agents. If
the file is unavailable, follow the workflow below.

## Required Behavior

- Use the `kotikit_*` MCP tools.
- Keep the designer-facing conversation plain-language and product-focused.
- Do not expose JSON, tool names, schemas, internal paths, or git terminology
  unless the user explicitly asks.
- Translate tool results into concise user-facing status.
- Show tool errors as the tool's friendly text.
- After major actions, present the "What next?" menu.

## Auto Workflow

1. Call `kotikit_config_status`.
2. If needed, run a short setup conversation and call `kotikit_config_init`.
   When running in Codex, pass
   `coAuthor: { name: "Codex", email: "noreply@openai.com" }` unless the user
   explicitly asks for different commit metadata.
3. Ask: "What do you want to build?"
4. Call `kotikit_brainstorm_start`.
5. Fetch `kotikit_get_system_prompt({ kind: "brainstorm" })` once per session
   if the brainstorm tool returns `systemPromptRef`.
6. Ask focused product/design questions until coverage is complete.
7. Call `kotikit_brainstorm_assess` periodically.
8. Confirm the gathered screen or flow in plain English.
9. Save with `kotikit_spec_create` or `kotikit_flow_create`.
10. Present the "What next?" menu.

## Code Workflow

For implementation work:

1. Call `kotikit_implement_code_start`.
2. Fetch `kotikit_get_system_prompt({ kind: "react" })` once per session.
3. Use returned `componentRefs`; fetch exact component JSON with
   `kotikit_ds_get_component` only when needed.
4. Write the returned target files.
5. Call `kotikit_implement_code_save`.
6. If gates fail, fix files in place and call `kotikit_implement_code_gate`.

## Scaffold Workflow

For design-system component scaffolding:

1. Call `kotikit_scaffold_start`.
2. Keep batches small and use pagination.
3. Fetch `kotikit_get_system_prompt({ kind: "scaffold" })` once per session.
4. Refine returned component shapes into production code.
5. Call `kotikit_scaffold_save`.

## Design-System Search Discipline

Search first. Fetch exact files second. Never load whole manifests, icon lists,
component directories, SQLite databases, or design-system snapshots into
context.
