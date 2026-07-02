# Workflow Module

The legacy workflow module has been removed from the active core.

Kotikit now uses graph-backed flow manifests, graph state, checkpoints, and
artifacts for resumable designer work. Agents should use the graph facade:

- `kotikit_flow_list`
- `kotikit_start`
- `kotikit_answer`
- `kotikit_continue`
- `kotikit_get_artifact`
- `kotikit_list_artifacts`

The old manual phase router stored compact session files and returned static
next-action guidance. That approach did not hold the work line reliably enough
for design creation, review, approval, and Figma apply cycles. The graph runtime
replaces it with explicit nodes, interrupts, persisted checkpoints, artifacts,
flow hashes, and manifest hashes.

Figma draft creation is also graph-backed now. The create-screen graph builds a
canvas plan and a transaction queue, then drains the queue through repeated
Figma interrupts one screen state, region state, or approved post-screen draft
component at a time. This keeps generated frames non-overlapping, preserves
node-ledger context for comment review, and avoids large one-step apply
payloads.

Do not add new code to this module. New resumable behavior belongs in graph
nodes, flow manifests, runtime stores, or facade tools.
