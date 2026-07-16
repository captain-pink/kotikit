# Architecture

kotikit is a local-first MCP and Figma workflow. It keeps project data on the
user's machine and lets Claude Code, Codex, or another MCP client operate
through shared tools.

## System Map

```text
Assistant
  -> kotikit MCP server
  -> target project .kotikit state
  -> local design-system indexes
  -> official Figma MCP integration
  -> optional kotikit variable bridge
  -> Figma draft page
```

## Main Pieces

### MCP Server

The MCP server exposes `kotikit_*` tools over stdio. Claude Code, Codex, and
future MCP clients share the same tool set and engines.

The local kotikit plugin bridge uses the same handler map over a localhost
WebSocket for the narrow variable-export fallback. Design creation uses the
official Figma MCP integration instead of kotikit's local plugin.

### Local Project State

The target project owns:

- `.kotikit/config.json`
- `.kotikit/runs/*`
- `.kotikit/artifacts/*`
- `.kotikit/specs/*`
- `.kotikit/index.json`
- `.kotikit/bridge.json` when a bridge is running

Specs, graph runs, and graph artifacts are JSON. Runs persist flow ids, graph
hashes, node versions, status, and state; artifacts hold compact contracts such
as briefs, design approaches, fit reports, apply packets, comment evidence
maps, revision plans, usage reports, and QA reports.

### Design-System Indexes

`kotikit_sync_ds` writes:

- `design-system/components.db`
- `design-system/icons.db`
- `design-system/components/*.json`
- `design-system/variables.json`
- `design-system/manifest.json`
- compact sync reports and checkpoints

Agents search the indexes first, then fetch exact component JSON files only
when needed.

### Figma Integrations

Figma design creation uses the official Figma assistant integration. Kotikit
generates a bounded apply packet, the assistant writes through official Figma
tools, then reports applied node metadata back to kotikit with
`kotikit_record_figma_apply`.

Figma comment feedback uses the REST API only for compact comment snapshots.
The `review-screen` graph maps comments to the node ledger and saves a revision
plan artifact before asking the designer whether to apply changes. The tiny
core does not post comments, resolve threads, or store design memory.

The local plugin bridge is used only for exporting variables through the Plugin
API when REST variables are unavailable. Search, sync, and design creation stay
on the normal MCP plus Figma REST or official Figma assistant paths.

The bridge:

- binds to `127.0.0.1`
- requires a per-session token
- patches the plugin manifest to the selected localhost port
- starts and stops from the active MCP process
- writes short-lived bridge state to `.kotikit/bridge.json`

### Figma Safety Boundary

Figma design creation is fail-closed:

1. A user provides an exact Figma draft page or frame URL.
2. kotikit resolves copied node URLs to the containing page through Figma REST.
3. The page name must contain `Draft` or `Drafts`.
4. Graph draft nodes copy that target and prepare a write preflight for each
   active transaction.
5. The official Figma integration creates or reuses a kotikit-owned Section on
   the preflight page.
6. Apply metadata reporting requires the preflight id and validates file, page,
   and Section metadata before patching graph state.

This gives teams without Figma branches a practical safety boundary.

## Core Data Flow

1. **Graph flow**
   The assistant starts a built-in or trusted flow and follows graph
   interrupts, checkpoints, and artifacts.

2. **Design-system sync**
   Figma published-library metadata is normalized into local component and icon
   indexes.

3. **Draft planning**
   Graph nodes turn intent into a compact design approach, then combine local
   design-system evidence, screen-draft structure, icons, and variables into an
   apply-packet artifact.

4. **Official Figma apply**
   The assistant uses the official Figma integration to drain incremental Figma
   transactions one screen state or region state at a time.
   Each write follows the canvas plan and records node-ledger metadata back to
   kotikit.

5. **Feedback review**
   The assistant fetches compact Figma comments, runs `review-screen`, reads the
   revision plan artifact, and asks before applying any changes.

### Intent Confidence Boundary

UX pattern packs are deterministic defaults, not free-text classifiers. An
explicit blueprint pattern-pack reference may select one directly, and a short
inferred prompt may use the small built-in fallback. A detailed free-text
request is already marked low confidence by brief planning and must remain on
the generic `unknown` archetype regardless of incidental words such as
`table`, `dashboard`, or `settings`.

For low-confidence intent, UX artifacts preserve the supplied request, use
no inferred standard states, and halt at the brief boundary before local
design-system composition or Figma work. The pending question directs the
caller to restart `kotikit_start` with a validated `screenBlueprint` or
`flowBlueprint` containing structured required UI parts, regions, expected
content, and only requested states. Text approval and quick-lane wording do
not bypass this boundary. Low-confidence artifacts must not copy actors,
entities, fields, actions, permissions, or state copy from a built-in pattern
pack.

For explicit blueprints, the executable Figma apply packet carries the
validated required UI parts and expected content so the applying assistant can
preserve visible product requirements.

## Module References

- [modules/config.md](modules/config.md) - `.kotikit/config.json`, defaults,
  and secret resolution.
- [modules/spec.md](modules/spec.md) - screen specs, flow manifests, and index.
- [modules/sync.md](modules/sync.md) - Figma sync, normalization, rate limits,
  and checkpoints.
- [modules/planning.md](modules/planning.md) - design plans, graph draft
  component planning, and apply metadata.
- [modules/mcp.md](modules/mcp.md) - MCP server, tool registry, and bridge.
- [modules/workflow.md](modules/workflow.md) - removed legacy workflow module
  and graph-runtime replacement notes.
- [modules/db.md](modules/db.md) - SQLite stores and migrations.
- [modules/util.md](modules/util.md) - path, ID, env, and result helpers.
- [modules/migrations.md](modules/migrations.md) - lazy JSON migration model.
