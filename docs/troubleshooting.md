# Troubleshooting

Start with the smallest check. Most kotikit failures are setup, Figma safety,
or design-system evidence issues.

## Kotikit Does Not Start

Run setup status from the target project:

```text
Run kotikit doctor.
```

Check that:

- the assistant was restarted after scaffold,
- `.kotikit/config.json` exists,
- the MCP server path points to this kotikit checkout,
- Bun is installed.

## Figma Page Is Rejected

kotikit writes only to draft pages.

Fix:

- rename the Figma page so it includes `Draft` or `Drafts`,
- pass the exact page URL again,
- let kotikit create or reuse its Section.

## Design System Search Finds Nothing

Make sure you synced a published Figma library, not only a draft file.

```text
Use kotikit to sync this published Figma library:
<figma-library-url>
```

If sync is slow or rate-limited, wait and resume. kotikit sync is local and can
continue from cached state.

## Variables Are Missing

If Figma REST variables are unavailable, use the local kotikit Figma plugin to
export variables from the file.

Then tell the assistant:

```text
Variables are synced. Continue the kotikit run.
```

## Draft Creation Uses Too Many Hardcoded Shapes

Ask kotikit to stop and explain the reuse plan:

```text
Show which local design-system components and icons you will use before drawing.
```

Good behavior:

- search first,
- place real component instances as the actual UI,
- use primitives only for missing layout wrappers or draft-only details,
- never add hidden or visible proof nodes.

## A Screen Looks Broken

Ask for screenshot-based review:

```text
Take a screenshot of the current state and list visible layout issues before
continuing.
```

kotikit should fix overlap, clipped text, vertical words, mirrored text, and
component collisions before it records the Figma result.

## States Are Cards Instead Of Screens

Loading, empty, error, no-results, and permission states must appear where a
designer would review them.

Ask kotikit to convert them:

```text
Convert these previews into real screen or region states inside the same
kotikit Section.
```

## Comments Are Not Reviewed

Use the `review-screen` flow:

```text
Use kotikit to review comments on this draft:
<figma-url>
```

Keep comments on visible frames or layers inside the kotikit Section. kotikit
should read a compact comment snapshot, verify anchored nodes, and ask before
returning an apply-or-skip handoff. The assistant applies an approved plan
through official Figma tools; the review graph does not apply it itself.

## The Run Keeps Asking For The Same Evidence

Do not add extra proof components to the canvas.

Ask:

```text
What exact visible node, component key, or screenshot evidence is missing?
```

If the screen is already visually correct, kotikit should recover by scanning
the existing frame again and recording truthful evidence, not by rebuilding in a
new section.

## Start Fresh

Only start fresh when the current Section is clearly unusable.

Good fresh-start request:

```text
Create a new kotikit Section on the same draft page and rebuild the screen from
local design-system components first.
```
