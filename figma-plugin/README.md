# kotikit Figma variables plugin

This plugin is only for kotikit's variable fallback. It connects to the
localhost bridge, reads variables from the currently open Figma file, and
imports them into kotikit when Figma's REST Variables API is unavailable.

It does not create designs, run reviews, inspect comments, sync components, or
manage kotikit setup. Design creation and review stay in the assistant workflow
through the official Figma integration.

## Install (one-time)

```bash
cd figma-plugin
bun install
bun run build
```

This produces `dist/code.js` and `dist/ui.html`.

## Load into Figma

1. Open Figma -> Plugins -> Development -> Import plugin from manifest...
2. Pick `figma-plugin/manifest.json`.

See [../docs/figma.md](../docs/figma.md) for the complete Figma setup flow,
token scopes, draft page safety rules, and variable fallback.

## Use

1. Ask your assistant to start the kotikit Figma plugin bridge.
   It will build `dist/` if needed, patch `manifest.json` for the chosen
   localhost port, and return a URL (`ws://localhost:53124?token=...`).
2. Open the source design-system file in Figma.
3. Run Plugins -> Development -> kotikit. Paste the URL into Connect.
4. Click **Sync Variables From Open File**.

For screen creation, use the assistant flow. The assistant should use the
official Figma integration, not this local plugin.

When developing from this repository, this manual fallback starts the same bridge:

```bash
cd /path/to/your-react-project
bun run /path/to/kotikit/src/mcp/server.ts --bridge
```

## Test

```bash
cd figma-plugin
bun test
```
