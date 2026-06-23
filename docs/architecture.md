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
  -> optional Figma plugin bridge
  -> Figma draft page
```

## Main Pieces

### MCP Server

The MCP server exposes `kotikit_*` tools over stdio. Claude Code, Codex, and
future MCP clients share the same tool set and engines.

The Figma plugin bridge uses the same handler map over a localhost WebSocket,
so plugin calls and assistant calls go through the same validation and business
logic.

### Local Project State

The target project owns:

- `.kotikit/config.json`
- `.kotikit/workflows/*`
- `.kotikit/specs/*`
- `.kotikit/index.json`
- `.kotikit/registry.db`
- `.kotikit/design-review.db`
- `.kotikit/bridge.json` when a bridge is running

Specs and plans are JSON. Review state and memory live in SQLite.
Workflow sessions are compact JSON pointers to the current task; they keep only
the latest decision summary so agents can resume without loading old history.

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

### Figma Plugin Bridge

The plugin bridge is optional for search and comment review, but required for
applying generated design plans and exporting variables through the plugin API.

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
4. Design plans copy that target.
5. The plugin creates or reuses a kotikit-owned Section.
6. Apply-step reporting validates file, page, and Section metadata.

This gives teams without Figma branches a practical safety boundary.

## Core Data Flow

1. **Spec**  
   The assistant brainstorms with the user and writes a screen spec or flow
   manifest under `.kotikit/specs`.

2. **Workflow control**  
   The assistant asks `kotikit_workflow_start` or `kotikit_workflow_next` what
   phase is currently allowed. The controller reads only compact state files and
   returns the next action.

3. **Design-system sync**  
   Figma published-library metadata is normalized into local component and icon
   indexes.

4. **Design plan**  
   The planner turns a saved spec plus design-system references into semantic
   Figma plan steps.

5. **Plugin apply**  
   The plugin applies each step in Figma and reports results back to kotikit.

6. **Review**  
   Comments and design-quality findings are stored in `design-review.db`.

7. **Memory**  
   Repeated feedback can become a local design preference used in future design
   passes.

## Module References

- [modules/config.md](modules/config.md) - `.kotikit/config.json`, defaults,
  and secret resolution.
- [modules/spec.md](modules/spec.md) - screen specs, flow manifests, and index.
- [modules/sync.md](modules/sync.md) - Figma sync, normalization, rate limits,
  and checkpoints.
- [modules/planning.md](modules/planning.md) - code plans, design plans,
  component plans, node maps, and review evidence.
- [modules/mcp.md](modules/mcp.md) - MCP server, tool registry, and bridge.
- [modules/workflow.md](modules/workflow.md) - compact workflow controller,
  snapshots, and next-action decisions.
- [modules/db.md](modules/db.md) - SQLite stores and migrations.
- [modules/git.md](modules/git.md) - local auto-commit helpers.
- [modules/codegen.md](modules/codegen.md) - experimental design-to-code track.
- [modules/util.md](modules/util.md) - path, ID, env, and result helpers.
- [modules/migrations.md](modules/migrations.md) - lazy JSON migration model.
