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
4. Read the apply-packet artifact.
5. Use the official Figma assistant integration to create the draft inside a
   kotikit-owned Section.
6. Record Figma node metadata back into kotikit.
7. Let the UI quality gate check common broken-output issues.

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

Kotikit never posts replies or review comments without your approval.

## Design Memory

When the same feedback appears repeatedly, kotikit can turn it into a local
design preference. Future design passes can read those preferences before
creating another draft.

This is intentionally local. Preferences live in `.kotikit/design-review.db`,
not in a hosted service.
