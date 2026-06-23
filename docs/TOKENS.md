# Token And Context Budget

This is a maintainer and agent-workflow reference. Normal kotikit users should
not need to read it to create Figma drafts.

kotikit is designed for Claude Code, Codex, and other MCP-capable agents. Every
tool response enters the active conversation unless the caller is the Figma
plugin bridge. Large responses can make the assistant slower, more expensive,
and less reliable because they consume the same context the agent needs for
product decisions.

The user-facing rule is simple: keep sessions focused, search before fetching
details, and let kotikit use its defaults.

## User-Facing Summary

These are the only token habits most designers need:

1. Work on one screen or flow at a time.
2. Sync design systems, create drafts, and run design reviews in focused
   sessions instead of mixing everything into one long chat.
3. Let the agent search the design-system index before fetching exact component
   details.
4. Avoid code/scaffold tools in design sessions. Guided design-to-code is not
   enabled yet.

README and getting-started docs should keep token advice at this level. The
tables below are for maintainers checking payload regressions.

## Why This Exists

The project is local-first, but context is still limited. Without discipline,
an agent can accidentally load:

- full design-system component JSON,
- large scaffold bundles,
- repeated system prompts,
- long design-review reports,
- stale brainstorm context from previous tasks.

kotikit reduces that risk by keeping long doctrines behind
`kotikit_get_system_prompt`, returning refs before details where possible,
using SQLite search instead of dumping indexes, storing only compact workflow
state instead of replaying history, and paginating expensive responses.

## Current Measurements

Run `bun run measure` from the repo root to regenerate this table. It builds a
small deterministic fixture project with three design-system components and one
single-screen spec.

Token estimate = bytes / 3.8. Real tokenizer output varies by model and MCP
client, so treat these numbers as regression signals, not exact billing data.

| tool | bytes | ~tokens |
| --- | ---: | ---: |
| `kotikit_config_status` | 272 | 72 |
| `kotikit_config_get` | 639 | 168 |
| `kotikit_workflow_start` create-design | 2,147 | 565 |
| `kotikit_workflow_next` | 2,142 | 564 |
| `kotikit_workflow_event` latest summary | 2,332 | 614 |
| `kotikit_spec_list` | 133 | 35 |
| `kotikit_spec_get` | 1,043 | 274 |
| `kotikit_brainstorm_start` | 1,442 | 379 |
| `kotikit_ds_search` | 247 | 65 |
| `kotikit_icons_search` | 138 | 36 |
| `kotikit_ds_get_component` | 599 | 158 |
| `kotikit_implement_code_start` default refs | 5,366 | 1,412 |
| `kotikit_implement_code_start` expanded | 6,435 | 1,693 |
| `kotikit_plan_code` | 2,252 | 593 |
| `kotikit_scaffold_start` compact page size 3 | 5,192 | 1,366 |
| `kotikit_scaffold_start` full JSON page size 3 | 5,723 | 1,506 |
| `kotikit_registry_search` | 653 | 172 |
| `kotikit_plan_design` blocked fixture response | 217 | 57 |
| `kotikit_design_get_screen` blocked fixture response | 136 | 36 |
| `kotikit_audit` | 992 | 261 |
| `kotikit_get_system_prompt` react | 1,741 | 458 |
| `kotikit_get_system_prompt` brainstorm | 2,532 | 666 |

The design-plan rows are intentionally labeled as blocked fixture responses.
The measurement fixture does not bind a real Figma draft target, so those rows
verify that blocked responses stay small rather than measuring a full happy
path design payload.

## What To Watch

- Search tools should stay tiny. `kotikit_ds_search`, `kotikit_icons_search`,
  and `kotikit_registry_search` are the expected first step before exact
  detail reads.
- `kotikit_get_system_prompt` is a one-time session cost per prompt kind. Do
  not inline long doctrines into every tool response.
- `kotikit_workflow_start`, `kotikit_workflow_next`, and
  `kotikit_workflow_event` should stay compact. They are the preferred way for
  agents to resume because they return the current phase and next allowed
  tools, not the full history of the task.
- Code and scaffold tools are intentionally measured for engineering
  visibility, but they are not part of the current guided designer workflow.
- Figma plugin bridge responses do not normally enter the assistant context.
  Optimize bridge payloads for latency and plugin reliability first, then
  context size.

## Design Rules For Tool Authors

1. Return search results, refs, paths, and counts before returning full JSON.
2. Add pagination before a response can grow with project size.
3. Keep long instructions behind `systemPromptRef` and
   `kotikit_get_system_prompt`.
4. Make expensive expansion opt-in, for example `expand: true`.
5. Prefer structured summaries over raw file, manifest, or database dumps.
6. Keep friendly error responses compact.

## Re-Measuring

Run:

```bash
bun run measure
```

Paste the new output into this file when a tool response shape changes. If a
payload grows materially, either document why or adjust the tool to return a
smaller default shape.

## Related Docs

- [tools.md](tools.md) - tool reference and approximate response sizes.
- [agent_workflow.md](agent_workflow.md) - shared agent workflow discipline.
- [coding_guidelines.md](coding_guidelines.md) - context and performance rules
  for implementation work.
