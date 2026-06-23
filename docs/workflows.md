# Workflows

These are the main kotikit workflows a designer or product person should know.
The assistant should run the MCP tools for you; you should not need to call tool
names directly.

kotikit keeps a compact workflow pointer in the project. If you stop halfway
through setup, syncing, creating a draft, or reviewing a design, the assistant
should continue from the next safe step instead of rereading old history or
guessing what happened.

## Guided Screen Or Flow Spec

Start with:

```text
kotikit:auto
```

or in Claude Code:

```text
/kotikit-auto
```

Then describe the thing you want to build:

```text
I want to build a members admin page with search, filters, table rows, member
status controls, and an invite flow.
```

The assistant should:

1. Ask product and design questions one topic at a time.
2. Record your answers before it can save the spec.
3. Confirm the screen or flow back to you in plain language.
4. Save a local spec under `.kotikit/specs`.
5. Offer the "What next?" menu.

## Sync A Figma Design System

Ask:

```text
Sync my Figma design system.
```

If no design system is configured, the assistant should ask for the Figma file
URL or file key, save it to kotikit config, then run sync.

kotikit syncs published components, component sets, icons, styles, and available
variables into `design-system/`.

Important: the Figma file must be published as a library. Figma does not return
importable component keys for unpublished local components.

## Create Or Refine A Figma Draft

Ask:

```text
Create the Figma design for the Members screen.
```

The assistant should:

1. Pick the saved spec or ask which one to use.
2. Confirm the design system has been synced if the screen should use it.
3. Ask for an exact Figma draft page link.
4. Bind that page as the safe target.
5. Generate a design plan.
6. Fetch the kotikit apply packet.
7. Use the official Figma assistant integration to create or refine the design
   inside a kotikit-owned Section.
8. Record applied node metadata back into kotikit so comment review can map
   feedback to the right design parts.

Draft page rules:

- The Figma URL must include `node-id`.
- The target must be a page node, not a random child frame.
- The page name must contain `Draft` or `Drafts`.

## Missing Components

If the saved spec needs a component that is not in the synced design system,
kotikit should not silently invent it.

The assistant should ask you to choose:

- Create reusable draft components first.
- Build the missing pieces inline in this page only.

If synced variables are unavailable, kotikit should suggest importing variables
through the plugin before using literal values. Literal draft values are allowed
only after you explicitly approve them.

Reusable draft components pause the main screen task until you review those
components and confirm the screen can use them.

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

## Review Existing Figma Comments

Ask:

```text
Review the Figma comments for the Members screen.
```

kotikit reads comments through the Figma API, maps comments on known nodes back
to generated design-plan nodes when possible, and stores a compact review
session in `.kotikit/design-review.db`.

After fixes, kotikit can prepare replies for fixed comments. It should never
post those replies without your approval.

## Run A Design-Quality Review

Ask:

```text
Review this Figma design like a design director:
https://www.figma.com/design/...
```

The link must include `node-id`.

kotikit gathers bounded evidence instead of reading the full Figma file:

- shallow target metadata
- limited child-region summaries
- a temporary screenshot URL when available
- a short-lived local cache row with schema, fingerprint, and expiry

The assistant records structured findings, summarizes the review, and asks
whether you want selected comments posted back to Figma.

## Design Memory

When the same feedback appears repeatedly, kotikit can turn it into a local
design preference. Future design passes can read those preferences before
creating another draft.

This is intentionally local. Preferences live in `.kotikit/design-review.db`,
not in a hosted service.
