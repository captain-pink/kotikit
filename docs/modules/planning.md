# Planning

Kotikit plans Figma work inside the active graph run. A designer request, or a
validated screen blueprint for a detailed request, becomes one screen model. The
graph saves compact artifacts for the design approach, state matrix, local
design-system fit, composition, canvas, variable bindings, Figma transactions,
and QA. There is no separate spec or design-plan file to maintain.

## Active path

- `src/core/nodes/brief/index.ts` captures the request and selects the screen
  blueprint. Detailed ambiguous requests pause for a typed blueprint before
  composition.
- `src/core/nodes/ux/index.ts` builds the design approach, UX envelope, and
  requested state matrix.
- `src/core/domain/ui-composition-contract.ts`, `layout-contract.ts`,
  `canvas-plan.ts`, and `variable-binding-plan.ts` describe the editable draft
  using local design-system evidence.
- `src/core/domain/figma-transaction-plan.ts` splits visible Figma work into
  incremental transactions. `src/core/nodes/draft/index.ts` builds the apply
  packet and checks that typed UI parts, states, and expected content survived
  planning.

The `create-screen` flow produces one screen. If a flow blueprint contains
several screens, this run uses its primary screen; the agent should name that
screen to the designer and start a separate run for each other screen.

Older projects may contain `.kotikit/specs/*` and disposable design-plan JSON.
Kotikit leaves those historical files in place but does not read or update them
for new graph runs.
