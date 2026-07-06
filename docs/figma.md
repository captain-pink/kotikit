# Figma Setup

kotikit uses Figma in two ways:

1. Figma's assistant integration for reads, writes, screenshots, and metadata.
2. A tiny local kotikit plugin for variable export when REST variables are not
   available.

## Assistant Integration

Install the Figma integration for your assistant from inside Figma. The
assistant must be able to inspect and write to the target file.

Use Figma writes only on draft files or copies while kotikit is alpha.

## Draft Page Rule

kotikit will not write to a normal page by accident.

Before creating a screen:

- Use a page name that includes `Draft` or `Drafts`.
- Give kotikit the exact Figma page URL, or a copied frame/node URL on that
  draft page.
- Let kotikit create or reuse one kotikit-owned Section.

kotikit resolves copied node URLs to their containing page and prepares a page
guard before every Figma write. If a write reports a different page or Section,
the graph rejects it before recording the result.

Generated frames should stay inside that Section and follow the planned layout
grid, with at least clear spacing between sibling screens.

## Design-System Sync

Local design-system sync is for published Figma libraries.

Use it when you want kotikit to reuse real components and icons:

```text
Use kotikit to sync this published Figma library:
<figma-library-url>
```

The local index lets kotikit search first, then fetch exact component details.
This is faster and cheaper than loading full library data into chat.

Draft or unpublished files can be useful for inspection, but published
component keys are the reliable path for reuse.

## Figma Token

A Figma personal access token is needed for local design-system sync.

It is not required to create drafts through Figma's assistant integration.

Add the token to the target project's `.env` only when needed:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

Do not commit this file.

## Variables

Figma REST variables are plan-dependent. If kotikit cannot read variables
through REST, use the local plugin:

1. Open the target file in Figma.
2. Run the kotikit plugin.
3. Export variables.
4. Continue the assistant run.

The plugin writes a local variables file that kotikit can use during future
drafting. The plugin does not create designs, bind pages, or review comments.

## What Good Figma Output Looks Like

kotikit should produce:

- one full-size frame per screen state when a state changes the whole screen,
- region states inside the relevant area when only one region changes,
- real component instances for matched design-system parts,
- icons from the local design-system/icon index where icons improve scanning,
- auto layout for structured rows, panels, toolbars, and cards,
- readable frame names,
- no overlapping states,
- no hidden proof nodes.

If screenshot review finds broken text, clipped content, or visual overlap,
kotikit should fix the layout before recording the result.

## Common Figma Problems

- **Page rejected:** rename the page so it includes `Draft`.
- **Components not reused:** sync a published library and ask kotikit to search
  the local design system before composing.
- **Variables unavailable:** use the variable-only local plugin.
- **Broken imported component:** compose with the real component from the start;
  do not place it later as evidence.
- **Comments not mapped:** keep comments on visible frames or child nodes inside
  the kotikit Section.
