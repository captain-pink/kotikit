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
2. Search the local design-system cache before inventing anything.
3. Ask only blocking questions, such as missing component strategy, literal
   variable fallback approval, or the exact Figma draft page target.
4. Read the apply-packet artifact and active Figma transaction.
5. Use the official Figma assistant integration to apply one draft component,
   screen state, or region state at the canvas plan bounds.
6. Record Figma node metadata back into kotikit.
7. Continue the run and repeat one screen state at a time until the transaction
   queue is complete.
8. Let the UI quality gate check common broken-output issues.

Kotikit applies Figma drafts through incremental Figma transactions. It creates
draft components first, then creates the filled screen, then creates each
required state one screen state at a time. Each generated node is placed by the
canvas plan and recorded in the node ledger so comment review can still work
after designers move frames.

### Manual QA For Generated Figma Drafts

After kotikit creates a draft, verify:

- generated frames are in one clean kotikit Section;
- draft components are in their own zone;
- state frames are same-sized and non-overlapping;
- loading, empty, no-results, error, and permission states replace the affected
  region;
- important controls use design-system component instances;
- required icons come from the local design-system icon index, not placeholders;
- variables/styles are bound where available;
- comments on moved frames still map after comment review starts.

## Screen States

Kotikit plans state coverage before it composes the Figma screen. The graph
stores this as a `StateMatrix`, so filled, loading, empty, no-results, error,
and permission states are treated as page, region, component, or flow states.

For data tables and lists, loading, empty, and error output should replace the
affected data region. It should not appear as extra cards below the screen.
Stable shell regions such as navigation, top bars, and page headers stay in
place unless the state is explicitly page-level.

Quick mode still works for fast high-fidelity screens. If kotikit can infer the
screen archetype and design-system fit, it records assumptions and continues.
It asks only when a decision would change the design outcome or safety boundary.

## Guided Screen Or Product Flow

Use the guided path when the product shape is not clear yet:

```text
I want to design an invite flow for adding new members.
```

The assistant should ask product/design questions one topic at a time, confirm
the summary, save a design-brief artifact, and then continue into screen or
product-flow drafting.

Product-flow work should map actor, goal, scenario, screens, states, and shared
state before drafting screens.

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

The assistant should ask you to choose:

- Create reusable draft components first.
- Use an approved primitive exception for this draft only.

Reusable draft components are created and validated on the active draft page
before the main screen composition continues. Literal color, typography,
spacing, radius, stroke, shadow, or effect values are allowed only after you
explicitly approve them.

Each draft component is tracked through `DraftComponentLifecycle`: why it was
created, where it lives, which component key it produced, and which generated
screen instances use it. Orphan draft components and overlapping draft areas
should fail QA instead of becoming hidden clutter on the page.

## Import Variables On Non-Enterprise Figma Plans

Figma's REST Variables API is Enterprise-gated. If sync says variables were
skipped, use the plugin fallback:

1. Ask your assistant: "Start the kotikit Figma plugin bridge."
2. Open the source design-system file in Figma.
3. Run Plugins -> Development -> kotikit.
4. Paste the bridge URL.
5. Click **Sync Variables From Open File**.

The plugin reads variables from the open file through Figma's Plugin API and
sends a compact payload to kotikit over the local bridge.

## Review An Existing Figma Design

Ask:

```text
Review this Figma design like a design director:
https://www.figma.com/design/...
```

The link must include `node-id`.

Kotikit gathers bounded REST-backed evidence instead of reading the full Figma
file:

- shallow target metadata
- limited child-region summaries
- a temporary screenshot URL when available
- a short-lived local cache row with schema, fingerprint, and expiry

The graph compares the target to local design-system evidence, creates a
revision-plan artifact, and pauses before any approved revision is applied.

## Review Existing Figma Comments

Ask:

```text
Review the Figma comments for the Members screen.
```

Comment review works best when the design was created through kotikit and has
recorded Figma node metadata. Kotikit maps comments on known nodes back to graph
artifacts when possible, groups them into decisions, and can prepare replies.

The comment flow uses Figma REST comment snapshots, canvas reconciliation, and
saved apply metadata to build a compact `CommentEvidenceMap`. Designers may
move or rename generated frames; kotikit reconciles the current canvas before
mapping comments. Raw comment snapshots are stored as artifacts after the
evidence map exists, so the graph can resume review without keeping large
payloads in assistant context.

Kotikit never posts replies or review comments without your approval.

## Recovery And Resume

Kotikit graph runs are designed to resume after assistant restarts, Figma apply
waits, and approval interrupts. Context durability checks keep graph state
small enough to reload reliably.

When kotikit blocks, it should use designer recovery language: the problem,
why it matters for the design, and one recommended next action. Technical
details stay in artifacts or logs for maintainers.

## Design Memory

When the same feedback appears repeatedly, kotikit can turn it into a local
design preference. Future design passes can read those preferences before
creating another draft.

This is intentionally local. Preferences live in `.kotikit/design-review.db`,
not in a hosted service.
