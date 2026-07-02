# Troubleshooting

Use this when kotikit setup, Figma sync, or the plugin bridge does not behave as
expected.

## kotikit Tools Do Not Appear In `/mcp`

Rerun scaffold from the kotikit repo:

```bash
cd ~/kotikit
bun run scaffold:agents -- --target /Users/YOUR_USERNAME/path/to/your-project --agents both
```

Then restart the assistant in the target project.

Check that:

- Claude Code has `.mcp.json` in the target project.
- Codex has `.codex/config.toml` in the target project.
- The paths point to your local kotikit clone.
- `bun install` has been run in the kotikit repo.

## Figma Token Is Missing

The target project's `.env` should contain:

```env
FIGMA_TOKEN=figd_...
```

The file should live in the target project root, not inside the kotikit repo.

If you edited `.env` during the same assistant session, retry the sync. kotikit
refreshes empty placeholders such as `FIGMA_TOKEN=` from disk.

## Sync Returns Zero Components

The Figma design-system file must be published as a library. Figma's published
component endpoints do not return unpublished local components.

If the file is published and sync still returns zero components:

1. Confirm the token can access the file.
2. Confirm the configured file key is correct.
3. Run sync again if the previous run was interrupted.
4. Run `kotikit doctor` from the target project if available.

## Variables Are Skipped

This is expected on non-Enterprise Figma plans when using the REST API.

Use the variable-only Figma plugin fallback:

1. Open the source design-system file in Figma.
2. Ask the assistant to start the kotikit Figma plugin bridge.
3. Connect the plugin with the returned bridge URL.
4. Click **Sync Variables From Open File**.

## Figma Plugin Cannot Connect

Ask the assistant:

```text
Is the Figma plugin bridge running?
```

If not, ask:

```text
Start the kotikit Figma plugin bridge.
```

The bridge URL is one-time session state. If you restart the assistant or close
the MCP process, start the bridge again and paste the new URL into the plugin.

If the plugin manifest fails to import, rebuild and start the bridge again:

```bash
cd ~/kotikit
bun run plugin:build
```

The bridge start tool also patches `figma-plugin/manifest.json` with the exact
localhost port that was selected.

## Large Design-System Sync Pauses

Large Figma libraries can take longer than one MCP request window. kotikit uses
a soft deadline and checkpoint so sync can return before the transport closes.

If the assistant says sync paused, run sync again. It should resume or restart
from a safe point instead of silently returning an empty design system.

## Old kotikit Files Are Reported

kotikit uses lazy migrations. Older specs are upgraded only when kotikit edits
them.

To inspect local artifacts without changing files, run this from the target
project:

```bash
bun run /path/to/kotikit/src/cli.ts migrate --dry-run
```

Future-version or unreadable files should be treated as blockers. Update
kotikit before editing artifacts created by a newer version.

## Design Creation Refuses A Figma Page

kotikit only binds safe draft pages.

Check that the Figma link:

- includes `node-id`
- points to a page node
- has a page name containing `Draft` or `Drafts`

This guard exists to reduce accidental changes to production design pages.

## Figma Draft Looks Messy Or Overlapped

Ask kotikit to continue the run so it can run the UI quality gate. If the gate
blocks on canvas overlap, rerun the active Figma transaction or ask kotikit to
reconcile the current canvas before continuing.

Generated frames should sit inside one kotikit Section, follow the canvas plan,
and be applied one screen state at a time. Draft components belong in their own
zone; loading, empty, no-results, error, and permission states should replace
the affected region rather than appear as extra cards.

## Loading, Empty, Or Error States Look Like Extra Cards

For tables and lists, these states should usually replace the affected data
region rather than becoming extra content around it. Kotikit stores the intended
coverage in a `StateMatrix`.

If a generated screen shows loading, empty, no-results, error, or permission
states as disconnected cards, continue the run and ask kotikit to check state
representation. The QA result should point to the affected page, region,
component, or flow state.

## Figma Comments Do Not Load

The lightweight feedback flow reads comments through Figma REST. Check that the
target project `.env` has `FIGMA_TOKEN`, the token can access the file, and the
token includes `file_comments:read`.

If comments load but kotikit cannot map them, continue the `review-screen` run
and open the `CommentEvidenceMap` artifact. Unmapped comments should stay
explicit as page-level or needs-human feedback rather than being attached to a
guessed layer.

## Draft Components Are Created But Not Used

Draft components are optional post-screen extraction output. The create-screen
happy path should produce the visible screen first; extracted draft components
stay on the same draft page and should not overlap the finished screen.

If a draft component area overlaps the main screen, or if components were
created before the screen exists, treat the run as failed. Ask kotikit to
recreate the screen with the compose-first path, then decide whether extraction
is useful.

## Kotikit Reused The Wrong Amount Of Design System

Before Figma writes, kotikit saves a `DesignSystemReusePlan`. Check it when the
draft looks too custom or when a close component was ignored. The plan separates
exact reuse, substitutes to validate, close candidates that should be wrapped or
composed, and true gaps that should remain screen-draft work until extraction
is explicitly approved.

After QA, kotikit saves a `DesignSystemUsageReport`. Use it to confirm which
design-system components, screen-draft parts, optional draft components, icons,
and primitive exceptions were actually recorded from Figma metadata.

## Kotikit Blocks On The Same Validator Twice

Repeated graph validator failures are persisted in the run's `errors` list.
The second repeated failure should include compact diagnostics with what kotikit
expected, what it found, and the accepted next action. Continue from that
diagnostic instead of guessing or restarting the whole flow.

## Kotikit Says The Run Carries Too Much Context

This is a context durability guard. Long-running graph state should stay small
and resumable; raw Figma and research payloads belong in artifacts once compact
contracts exist.

Retry the flow from the latest saved run if available. If it blocks again,
open the listed artifact or run `kotikit doctor` from the target project. The
designer recovery message should explain the problem, why it matters, and the
recommended next action without exposing stack traces.
