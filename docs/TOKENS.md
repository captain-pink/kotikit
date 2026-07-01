# Token And Context Budget

This is a maintainer and agent-workflow reference. Normal kotikit users should
not need to read it to create Figma drafts.

kotikit is designed for Claude Code, Codex, and other MCP-capable agents. Every
stdio tool response enters the active conversation. Large responses can make
the assistant slower, more expensive, and less reliable because they consume
the same context the agent needs for product decisions. The local Figma plugin
bridge is reserved for variable export fallback and should return compact
machine payloads instead of design instructions.

The user-facing rule is simple: keep sessions focused, search before fetching
details, and let kotikit use its defaults.

## User-Facing Summary

These are the only token habits most designers need:

1. Work on one screen or flow at a time.
2. Sync design systems, create drafts, and run design reviews in focused
   sessions instead of mixing everything into one long chat.
3. Let the agent search the design-system index before fetching exact component
   details.
4. Keep implementation/code requests outside kotikit's core design sessions.

README and getting-started docs should keep token advice at this level. The
tables below are for maintainers checking payload regressions.

## Why This Exists

The project is local-first, but context is still limited. Without discipline,
an agent can accidentally load:

- full design-system component JSON,
- repeated system prompts,
- long design-review reports,
- stale brainstorm context from previous tasks.

kotikit reduces that risk by keeping long doctrines behind
`kotikit_get_system_prompt`, returning refs before details where possible,
using SQLite search instead of dumping indexes, storing graph checkpoints and
artifacts instead of replaying chat history, and paginating expensive responses.

## Current Measurements

Run `bun run measure` from the repo root to regenerate this table. It builds a
small deterministic fixture project with three design-system components.

Token estimate = bytes / 3.8. Real tokenizer output varies by model and MCP
client, so treat these numbers as regression signals, not exact billing data.

| tool | bytes | ~tokens |
| --- | ---: | ---: |
| `kotikit_config_status` | 210 | 55 |
| `kotikit_config_get` | 607 | 160 |
| `kotikit_flow_list` | 3,794 | 998 |
| `kotikit_flow_validate` | 799 | 210 |
| `kotikit_start` create-screen | 713 | 188 |
| `kotikit_list_artifacts` all | 86 | 23 |
| `kotikit_doctor` | 2,029 | 534 |
| `kotikit_ds_search` | 247 | 65 |
| `kotikit_search_design_system` | 247 | 65 |
| `kotikit_icons_search` | 138 | 36 |
| `kotikit_ds_get_component` | 599 | 158 |
| `kotikit_get_system_prompt` brainstorm | 2,549 | 671 |

## What To Watch

- Search tools should stay tiny. `kotikit_ds_search` and
  `kotikit_icons_search` are the expected first step before exact detail reads.
- `kotikit_get_system_prompt` is a one-time session cost per prompt kind. Do
  not inline long doctrines into every tool response.
- Graph facade outputs should stay compact. Runs should return ids, pending
  questions, artifact refs, and errors, not the full graph manifest or history.
- Local variable bridge responses do not normally enter the assistant context.
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
- [coding_guidelines.md](coding_guidelines.md) - context and performance rules
  for implementation work.
