# Workflow Module

The workflow module lets agents resume kotikit tasks without rereading large
project artifacts or old conversation history.

## Files

- `src/workflow/workflow-schema.ts` defines workflow sessions, snapshots, and
  next-action results.
- `src/workflow/workflow-store.ts` stores `.kotikit/workflows/<id>.json` and
  `.kotikit/workflows/current.json`.
- `src/workflow/workflow-snapshot.ts` reads compact project state from config,
  sync manifests, variables, draft targets, plans, bridge status, and apply
  logs.
- `src/workflow/workflow-next.ts` decides the next allowed phase and tool set.
- `src/mcp/tools/workflow.ts` exposes the workflow controller through MCP.

## Invariants

- Sessions store only the latest event summary, not an append-only history.
- `.kotikit/workflows/` is runtime state and should stay ignored by git.
- Snapshots must not open SQLite design-system indexes or load component/icon
  directories.
- `next.allowedTools` is the source of truth for the next agent action.
- `next.forbiddenTools` blocks premature design application and experimental
  code generation in the guided designer workflow.
- User approvals must be recorded through `kotikit_workflow_event` before the
  agent posts Figma comments or falls back to literal values.

## Token Efficiency

The snapshot reader deliberately checks small files only:

- `.kotikit/config.json`
- `.kotikit/specs/<scope>/*` for the active target
- `design-system/manifest.json`
- `design-system/.sync-report.json`
- `design-system/.sync-checkpoint.json`
- `design-system/variables.json`
- `.kotikit/bridge.json` through the bridge manager

Do not add broad directory scans or database reads to this module unless the
decision cannot be made from compact state.
