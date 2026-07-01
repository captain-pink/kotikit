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
- `.kotikit/design-review.db`
- `.kotikit/bridge.json` when a bridge is running

Specs, graph runs, and graph artifacts are JSON. Review state and memory live
in SQLite. Runs persist flow ids, graph hashes, node versions, status, and
state; artifacts hold compact contracts such as briefs, fit reports, apply
packets, review sessions, revision plans, and QA reports.

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

The local plugin bridge is used only for exporting variables through the Plugin
API when REST variables are unavailable. Search, comments, design review, and
design creation stay on the normal MCP plus Figma REST or official Figma
assistant paths.

The bridge:

- binds to `127.0.0.1`
- requires a per-session token
- patches the plugin manifest to the selected localhost port
- starts and stops from the active MCP process
- writes short-lived bridge state to `.kotikit/bridge.json`

### Figma Safety Boundary

Figma design creation is fail-closed:

1. A user provides an exact Figma draft page URL.
2. kotikit verifies that it points to a page node.
3. The page name must contain `Draft` or `Drafts`.
4. Graph draft nodes copy that target.
5. The official Figma integration creates or reuses a kotikit-owned Section.
6. Apply metadata reporting validates file, page, and Section metadata.

This gives teams without Figma branches a practical safety boundary.

## Core Data Flow

1. **Graph flow**
   The assistant starts a built-in or trusted flow and follows graph
   interrupts, checkpoints, and artifacts.

2. **Design-system sync**
   Figma published-library metadata is normalized into local component and icon
   indexes.

3. **Draft planning**
   Graph nodes turn intent, local design-system evidence, draft components, and
   variables into an apply-packet artifact.

4. **Official Figma apply**
   The assistant uses the official Figma integration to apply the plan and
   reports results back to kotikit.

5. **Review**
   Comments and design-quality findings are stored in `design-review.db`.

6. **Memory**
   Repeated feedback can become a local design preference used in future design
   passes.

## Module References

- [modules/config.md](modules/config.md) - `.kotikit/config.json`, defaults,
  and secret resolution.
- [modules/spec.md](modules/spec.md) - screen specs, flow manifests, and index.
- [modules/sync.md](modules/sync.md) - Figma sync, normalization, rate limits,
  and checkpoints.
- [modules/planning.md](modules/planning.md) - design plans, graph draft
  component planning, node maps, and review evidence.
- [modules/mcp.md](modules/mcp.md) - MCP server, tool registry, and bridge.
- [modules/workflow.md](modules/workflow.md) - removed legacy workflow module
  and graph-runtime replacement notes.
- [modules/db.md](modules/db.md) - SQLite stores and migrations.
- [modules/git.md](modules/git.md) - local auto-commit helpers.
- [modules/util.md](modules/util.md) - path, ID, env, and result helpers.
- [modules/migrations.md](modules/migrations.md) - lazy JSON migration model.
