---
name: kotikit-auto
description: Run the kotikit auto workflow with MCP tools. Use when the user says kotikit:auto, run kotikit auto, build a screen with kotikit, sync my Figma design system, create a Figma design from a saved spec, review Figma comments, or work on kotikit screen and flow specs.
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
- Do not generate React code or scaffold code components in the guided workflow
  yet. If asked, explain that design-to-code is coming in a later version once
  design creation is stable, then offer to create or refine the Figma design.

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
   call `kotikit_bridge_start`, give the designer the returned bridge URL,
   tell them the plugin build and manifest were prepared automatically, ask them
   to open the source design-system file in Figma, run the kotikit plugin,
   connect to the bridge URL, and click "Sync Variables From Open File".
   Do not ask the designer to hand-edit token JSON unless they explicitly
   prefer a manual token workflow.
6. Present the "What next?" menu.

## Design Workflow

Use this when the user asks to create or refine a Figma design from a saved
screen or flow spec.

1. Run the Init Workflow.
2. Ask which saved spec or screen to use if it is not clear.
3. Make sure the Figma design system has been synced if the design should use
   design-system components.
4. Call `kotikit_plan_design`.
5. Call `kotikit_design_get_screen`.
6. If the Figma plugin bridge is not running, call `kotikit_bridge_start` and
   give the designer the returned bridge URL.
7. Ask the designer to open the target Figma draft, run the kotikit plugin, and
   connect to the bridge URL.
8. Apply the design plan step by step through the plugin, recording each result
   with `kotikit_design_apply_step`.
9. Summarize what was created or refined, then present the "What next?" menu.

## Review Workflow

Use this when the user asks to read, review, or resolve Figma comments.

1. Run the Init Workflow.
2. Call `kotikit_design_review_comments`.
3. Summarize mapped comments, unmapped comments, and suggested fixes in plain
   language.
4. After each design adjustment, call `kotikit_design_adjustment_record`.
5. When fixes are ready to report, use the review report and comment reply tools
   to prepare designer-facing replies.
6. Present the "What next?" menu.

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
  - I'm done for now
```

Route choices with kotikit tools:

- Add another screen: run Auto Workflow from the build question.
- Edit a screen: ask what should change, then call `kotikit_spec_update`.
- See everything: call `kotikit_spec_list` and present a readable list.
- Sync my design system: run Sync Workflow.
- Create or refine the Figma design: run Design Workflow.
- Review Figma comments: run Review Workflow.
- I'm done for now: close gracefully.

## Design-System Search Discipline

Search first. Fetch exact files second. Never load whole manifests, icon lists,
component directories, SQLite databases, or design-system snapshots into
context.
