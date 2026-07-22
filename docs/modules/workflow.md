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
- `kotikit_feedback_snapshot`

The old manual phase router stored compact session files and returned static
next-action guidance. That approach did not hold the work line reliably enough
for design creation, approval, and Figma apply cycles. The graph runtime
replaces it with explicit nodes, interrupts, persisted checkpoints, artifacts,
flow hashes, and manifest hashes.

Figma draft creation is also graph-backed now. The create-screen graph builds a
canvas plan and a transaction queue, then drains the queue through repeated
Figma interrupts one screen state or region state at a time. This keeps
generated frames non-overlapping and avoids large one-step apply payloads.

Post-screen feedback is graph-backed too. The `review-screen` flow reads a
compact Figma comment snapshot with verified anchor geometry, maps comments to
live roots or direct children, saves a revision plan artifact, and pauses for
designer approval. Approval returns an assistant apply handoff; skip returns a
distinct no-change result. The graph itself does not mutate Figma. This
replaces the old review/comment/memory workflow with a small artifact loop
instead of a standalone review database.

Do not add new code to this module. New resumable behavior belongs in graph
nodes, flow manifests, runtime stores, or facade tools.
