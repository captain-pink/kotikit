# Workflows

These are the main kotikit workflows a designer or product person should know.
The assistant should run MCP tools for you; you should not need to call tool
names directly.

Kotikit now runs designer work as graph flows. A flow can pause for a designer
decision, wait for Figma work, save an artifact, and resume from a run id.

## Start Kotikit

Use the assistant entry point:

```text
kotikit:auto
```

or in Claude Code:

```text
/kotikit-auto
```

The assistant should check setup, list relevant flows when needed, then start
the best prebuilt flow for your request.

## Quick High-Fidelity Screen

Ask for a specific screen when you already have a usable design system:

```text
Create a high-fidelity members admin screen using our existing table, filters,
buttons, and status components.
```

The assistant should:

1. Start the `create-screen` flow with your intent.
2. Let kotikit save a compact design approach: goal, workflow, chosen
   strategy, alternatives considered, state strategy, and key risks.
3. Search the local design-system cache before inventing anything.
4. Ask only blocking questions, such as literal variable fallback approval or
   the exact Figma draft page target.
5. Read the apply-packet artifact and active Figma transaction.
6. Use the official Figma assistant integration to apply one screen state or
   region state at the canvas plan bounds.
7. Scan the applied root node, take a screenshot, and repair visible layout
   issues before recording metadata back into kotikit.
8. Continue the run and repeat one screen state at a time until the transaction
   queue is complete.
9. Let the UI quality gate check common broken-output issues.

Kotikit applies Figma drafts through incremental Figma transactions. It creates
the actual screen states first using local design-system components, icons,
variables, and auto layout. Missing reusable structure is kept as screen-draft
work during composition. After the design is visible, the assistant should ask
whether you want those missing reusable parts extracted into draft components on
the same draft page. Each generated node is placed by the canvas plan and
recorded in the node ledger so future recovery and QA have real evidence.
Design-system components must be the actual visible UI, not hidden or
low-opacity proof layers. If evidence fails, the active transaction remains
repairable so the assistant should fix the current frame instead of starting a
new run or section.

### Manual QA For Generated Figma Drafts

After kotikit creates a draft, verify:

- generated frames are in one clean kotikit Section;
- optional extracted draft components are in their own zone on the same draft
  page;
- state frames are same-sized and non-overlapping;
- loading, empty, no-results, error, and permission states replace the affected
  region;
- important controls use design-system component instances;
- required icons come from the local design-system icon index, not placeholders;
- variables/styles are bound where available;
- screen-state frames were reviewed from a screenshot after visible component
  placement;
- all frames stay editable and selectable without manual cleanup.

## Screen States

Kotikit plans the design approach and state coverage before it composes the
Figma screen. The graph stores the approach as `DesignApproach` and state
coverage as `StateMatrix`, so filled, loading, empty, no-results, error, and
permission states are treated as page, region, component, or flow states.

The design approach is the lightweight brainstorm step. It considers the likely
workflow, alternatives, layout strategy, design-system strategy, icon strategy,
assumptions, and risks. Quick mode records this silently and proceeds when the
request is clear; kotikit should only ask the designer when an unresolved choice
would materially change the design.

For data tables and lists, loading, empty, and error output should replace the
affected data region. It should not appear as extra cards below the screen.
Stable shell regions such as navigation, top bars, and page headers stay in
place unless the state is explicitly page-level.

Quick mode still works for fast high-fidelity screens. If kotikit can infer the
screen archetype and design-system fit, it records assumptions and continues.
It asks only when a decision would change the design outcome or safety boundary.

## Review Comments And Apply Changes

After a draft exists, designers can leave comments in Figma and ask the
assistant to review them. Kotikit should use the lightweight `review-screen`
flow, not the old standalone review database.

The assistant should:

1. Fetch a compact Figma comment snapshot with `kotikit_feedback_snapshot`.
2. Start or continue `review-screen` with that feedback.
3. Let kotikit map comments to the Figma node ledger and save a
   `CommentEvidenceMap` artifact.
4. Read the `RevisionPlan` artifact and explain the proposed changes in plain
   design language.
5. Ask before applying revisions.
6. If approved, apply changes incrementally through the same Figma transaction
   discipline used by `create-screen`.

Kotikit does not post comments, resolve threads, or promote feedback into
memory in the tiny core. If a comment cannot be mapped to a known node, it
stays explicit as page-level or needs-human feedback instead of being attached
to a guessed layer.

## Guided Screen

Use the guided path when the product shape is not clear yet:

```text
I want to design an invite flow for adding new members.
```

The assistant should ask product/design questions one topic at a time, confirm
the summary, save a design-brief artifact, and then continue into screen
drafting. Multi-screen product-flow graphs are not part of the tiny built-in
core right now; use separate screen drafts until that extension returns.

## Sync A Figma Design System

Ask:

```text
Sync my Figma design system.
```

If no design system is configured, the assistant should ask for the Figma file
URL or file key, save it to kotikit config, then run sync.

Kotikit syncs published components, component sets, icons, styles, and available
variables into `design-system/`.

Important: the Figma file must be published as a library. Figma does not return
importable component keys for unpublished local components.

## Missing Components

If local design-system search cannot find a meaningful UI part, kotikit should
not silently invent or imitate it.

The create-screen happy path should compose the visible screen first using
local design-system components, icons, variables, auto layout, and screen-draft
structure for any true gaps. Once the result is visible, the assistant should
ask whether you want reusable missing parts extracted into draft components.
Extracted draft components stay on the same draft page; kotikit never publishes
them into the real design system automatically.

Literal color, typography, spacing, radius, stroke, shadow, or effect values
are allowed only after you explicitly approve them.

## Import Variables On Non-Enterprise Figma Plans

Figma's REST Variables API is Enterprise-gated. If sync says variables were
skipped, use the variable-only plugin fallback:

1. Ask your assistant: "Start the kotikit Figma plugin bridge."
2. Open the source design-system file in Figma.
3. Run Plugins -> Development -> kotikit.
4. Paste the bridge URL.
5. Click **Sync Variables From Open File**.

The plugin reads variables from the open file through Figma's Plugin API and
sends a compact payload to kotikit over the local bridge. It does not create
designs, review comments, or sync components.

## Recovery And Resume

Kotikit graph runs are designed to resume after assistant restarts, Figma apply
waits, and approval interrupts. Context durability checks keep graph state
small enough to reload reliably.

When kotikit blocks, it should use designer recovery language: the problem,
why it matters for the design, and one recommended next action. Technical
details stay in artifacts or logs for maintainers.
