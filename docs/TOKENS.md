# Tokens

kotikit responses cost tokens to generate and tokens for the active agent to read. Hosted coding assistants have conversation budgets; if you burn them in twenty minutes during a single screen-build session, you lose useful working context for the rest of that task.

This doc tells you what each tool costs and how to keep your conversations cheap.

---

## TL;DR — three things you can do today

1. **Brainstorm one screen per session.** Start a new chat for the next screen so the prior brainstorm doesn't sit in context.
2. **Sync and review in focused sessions.** Design-system sync, Figma design creation, and comment review each work best when they are not mixed into one long conversation.
3. **Use search before detail.** `kotikit_ds_search`, `kotikit_icons_search`, and design memory search are small; fetch exact details only after narrowing the target.

---

## Why this matters

Sonnet 4.6's weekly token budget covers tens of conversations of normal-length work. A single naive experimental `kotikit_implement_code_start` followed by `kotikit_scaffold_start` for 20 components, both with `expand: true`, can consume 100KB+ of tool results — eating half a day's budget on one screen.

The guided kotikit workflow is currently design-first. Implementation and
scaffold tools are measured here for engineering visibility, but agents should
not use them in `/kotikit-auto` or `kotikit:auto` until design-to-code returns.

Recent payload changes cut steady-state tool-result traffic by roughly
25-30%, with larger savings on the pathological `expand: true` paths. A
typical "build one screen with 5-component scaffold" session drops from about
25KB of tool returns to about 18KB. The changes that drive this:

- Returning `componentRefs` (paths + keys) instead of inline DS JSON.
- Paginating scaffold bundles at `pageSize: 3` with a `compact: true` DS JSON shape.
- Replacing the duplicated system prompts in implement / scaffold / brainstorm with a `systemPromptRef` field; the full doctrine is fetched once per session via `kotikit_get_system_prompt`.

You don't have to know about any of this. The defaults are conservative on purpose.

---

## Measured costs

| tool | bytes | ~tokens |
|---|---:|---:|
| kotikit_config_status | 272 | 72 |
| kotikit_config_get | 507 | 133 |
| kotikit_spec_list | 133 | 35 |
| kotikit_spec_get | 1,018 | 268 |
| kotikit_brainstorm_start (cached prompt ref) | 993 | 261 |
| kotikit_ds_search | 247 | 65 |
| kotikit_icons_search | 138 | 36 |
| kotikit_ds_get_component | 599 | 158 |
| kotikit_implement_code_start (default: refs) | 5,339 | 1,405 |
| kotikit_implement_code_start (expand: full) | 6,408 | 1,686 |
| kotikit_plan_code | 2,252 | 593 |
| kotikit_scaffold_start (default: compact, pageSize 3) | 5,192 | 1,366 |
| kotikit_scaffold_start (full dsJson, pageSize 3) | 5,723 | 1,506 |
| kotikit_registry_search | 653 | 172 |
| kotikit_plan_design | 3,727 | 981 |
| kotikit_component_plan_create | ~1,200-2,600 | ~315-685 |
| kotikit_design_get_screen | 5,751 | 1,513 |
| kotikit_audit | 992 | 261 |
| kotikit_get_system_prompt (react) | 1,741 | 458 |
| kotikit_get_system_prompt (brainstorm) | 2,532 | 666 |

Token estimate = bytes / 3.8 (rough JSON-heavy estimate). The real tokenizer can produce 10-15% more tokens for structured JSON; treat these numbers as a floor, not a ceiling. Measured against a fixture project (3 DS components, 1 screen with 2 components).

### What to notice

- **Three tools dominate the cost:** `implement_code_start`, `scaffold_start`, and `design_get_screen` — each 1,400+ tokens at minimum, and the `expand`/non-compact modes push them past 1,500.
- **Search tools are tiny:** `ds_search`, `icons_search`, `registry_search` — all under 200 tokens. Use them aggressively to locate what you need before fetching full detail.
- **`get_system_prompt` is a one-time cost** per session per kind. After the first call in a conversation, the model's KV cache holds the result; subsequent calls to `implement_code_start` or `scaffold_start` read from that warm context rather than re-inlining 1,500 bytes of doctrine.

### A note on `kotikit_design_get_screen` (1,513 tokens)

This is the largest tool by response size, but it is called by the Figma plugin over the
WebSocket bridge, not directly by the coding assistant. Its bytes hit the bridge transport,
not the assistant context window. It is intentionally less optimized than
assistant-facing tools. If the plugin's UI needs to render
many screens per session, a componentRefs-style lazy mode could be added; that work is
tracked in `NEXT_STEPS.md`.

---

## The three big mitigations

### 1. `kotikit_get_system_prompt({ kind })`

Earlier builds inlined the full React doctrine in
`kotikit_implement_code_start` and `kotikit_scaffold_start` — about 1,500 bytes
per call. Brainstorm inlined a separate roughly 800 byte doctrine on every
conversation start.

Current builds return a `systemPromptRef: "react" | "brainstorm" | "scaffold"`
field; the long doctrine is fetched once via
`kotikit_get_system_prompt({ kind })`. The model's KV cache keeps the doctrine
warm for the rest of the session.

**Net savings on a typical session:** ~3-5KB of duplicated text across multiple implement/scaffold calls (e.g. three implement calls × 1,500 bytes saved each = 4,500 bytes = ~1,184 tokens avoided).

**First-turn recommendation:** If you call `implement_code_start` or `scaffold_start` early in a fresh conversation, make your first tool call `kotikit_get_system_prompt({ kind: 'react' })` to fetch the doctrine into context. After that, every subsequent implement/scaffold call references it for free. Without that priming call, the model has only the short `systemPromptRef` stub and may ask to fetch the doctrine mid-flow, costing an extra round-trip.

### 2. Experimental scaffold pagination

`kotikit_scaffold_start` defaults:

- `pageSize: 3` (clamped 1-10) — return the first 3 design-only components.
- `cursor` — pass the prior page's `nextCursor` to get the next 3.
- `compact: true` — strip DS JSON to `{name, key, variants, propertyNames}`.

A 20-component design system scaffolds in 7 round-trips of ~5KB each instead of one 50KB blob (~13,157 tokens → ~9,562 tokens across the full set). Each batch is small enough to review and correct before committing to the next.

This is engineering guidance for the experimental scaffold track. It is not part
of the current designer-facing guided workflow.

### 3. `componentRefs` lazy expansion

`kotikit_implement_code_start` default response carries `componentRefs: [{name, path, key}]` instead of the full `dsComponents` dictionary. The agent fetches a specific component JSON on demand via `kotikit_ds_get_component({path})`.

For a screen with 8 components, this drops the implement_code_start response from ~6,408 bytes (1,686 tokens, expand mode) to ~5,339 bytes (1,405 tokens, default refs mode) — a 17% reduction before any components are fetched. The agent only pays for the components it actually reads during code generation, so a screen that ultimately uses 3 of 8 available components saves an additional ~2-3KB.

Pass `expand: true` if you want the legacy bundle — for example, when the agent knows up front that it will need every component JSON for a complex screen and the round-trip latency matters more than the token cost.

---

## What you can do as a user

These are the highest-leverage habits for keeping sessions cheap:

- **Brainstorm one screen per session.** Close the chat when you finish a screen. The brainstorm context is the longest-lived blob in a conversation; carrying it forward into implementation doubles your context size for free.
- **Don't call sync or audit in the middle of a brainstorm.** Start a fresh session for sync or audit work — those tools return their own payloads and don't benefit from the brainstorm context already being warm.
- **Review comments in batches.** Pull a focused set of Figma comments, make the adjustments, record them, then continue.
- **Avoid experimental code tools in design sessions.** `implement_code_start`, `scaffold_start`, and audit reports add code context that the current design-first workflow does not need.
- **Use search tools to narrow before fetching.** `ds_search`, `icons_search`, and `registry_search` are all under 200 tokens. Run one first, then fetch the specific component you need. This avoids pulling full DS JSON for things you won't use.

---

## Why MCP-protocol caching doesn't apply (yet)

Anthropic supports prompt caching via `cache_control` markers on content blocks at the Messages API level. **MCP tool responses do NOT surface those markers in Sonnet 4.6's stack today.** kotikit can't tag its outputs as cached at the protocol level.

What kotikit can and does do:

- Tool *definitions* (registered via `tools/list`) are stable and naturally cached by the MCP client at session start.
- Tool *outputs* are structured so a stable prefix (system prompt fetched once, plan written once) lives in conversation history and the KV cache keeps it warm.
- Static content (the doctrines) is moved behind `kotikit_get_system_prompt` so they appear ONCE per session.

When Anthropic ships `cache_control` for tool results, kotikit will retrofit. Until then, the smaller-payload approach is the primary lever.

---

## Re-measuring after payload changes

Run `bun run measure` from the repo root. It writes a table to stdout that you can paste into this file.

The script builds a tiny fixture project (3 DS components, 1 screen with 2 components), calls every tool, and prints byte + token estimates. Re-run after editing any tool to confirm your change didn't regress sizes.

```
bun run measure
```

The fixture is deterministic — the same inputs every time — so byte counts are stable and regressions are obvious.

---

## Related

- `docs/tools.md` — every tool with its individual cost listed in the description.
- `README.md` — the "Keeping Sessions Cheap" section is the designer-facing summary of this doc.
- `NEXT_STEPS.md` — items including "MCP protocol cache_control" and "session-aware dedup" for future leverage.
