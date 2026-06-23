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

Use the Figma plugin variable import fallback:

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

