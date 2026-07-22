# Workflows

Use kotikit like a design partner with a strict local workflow. Ask for the
screen or review you need; kotikit should handle the Figma mechanics.

## Create A Screen

```text
Use kotikit and create an admin members page on this Figma draft page:
<figma-url>
```

Expected behavior:

- Starts the `create-screen` flow.
- Clarifies only missing product details.
- Searches the local design system before drawing.
- Uses existing components, icons, variables, and auto layout when available.
- Creates the filled screen and important states as real screen or region
  states, not loose preview cards.
- Applies incremental Figma changes one screen state at a time.
- Runs screenshot and evidence checks before completion.

Good requests are specific about the product job:

```text
Create a workspace members page for admins. Include search, filters, invite,
roles, status, empty, loading, error, and permission states.
```

## Create A Fast High-Fidelity Draft

Use this when you already know the screen and want speed.

```text
Use kotikit to create a high-fidelity billing settings screen from existing
design-system components. Keep it simple and ask only if something blocks the
draft.
```

kotikit should still search first and reuse local components. It should not
pause for unnecessary approvals.

## Review Comments

Use this after you leave comments in Figma.

```text
Use kotikit to review comments on this draft and suggest changes:
<figma-url>
```

Expected behavior:

- Starts the `review-screen` flow.
- Reads a compact Figma comment snapshot with verified anchor geometry.
- Maps comments to visible roots or direct children when possible.
- Groups root comments and replies into one feedback thread.
- Produces a change plan in plain design language.
- Asks before applying changes and returns an explicit apply-or-skip handoff.

The graph prepares the revision plan; the assistant applies an approved
handoff through official Figma tools. A skipped handoff must not change Figma.

kotikit should not rely on browser debugging for comments.

## Sync A Design System

```text
Use kotikit to sync this published Figma library:
<figma-library-url>
```

After sync, kotikit can search local component and icon indexes. This keeps
runs fast and token-efficient.

## Sync Variables

If kotikit says Figma variables are unavailable through REST, open the kotikit
Figma plugin and export variables from the current file.

Then continue:

```text
Variables are synced. Continue the kotikit run.
```

The plugin is only for variables.

## When Components Are Missing

kotikit should finish the visible screen first. If the screen uses repeated
draft-only parts that could become components, kotikit should ask whether to
extract them.

Rules:

- Do not publish anything to the real design system automatically.
- Keep extracted draft components on the same draft page.
- Prefer local design-system alternatives when they exist.
- Do not add hidden or visible proof components just to satisfy checks.

## Recovery

If a run blocks, ask:

```text
Explain what is blocking kotikit and what exact action would unblock it.
```

Good recovery output should say:

- what failed,
- why it matters to the design,
- what kotikit expected,
- what it found,
- the smallest next action.

Avoid starting over unless the existing Figma section is unusable.
