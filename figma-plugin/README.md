# kotikit Figma plugin

The local Figma companion for kotikit's variable fallback. The plugin connects
to the localhost bridge and exports variables from an open Figma file when the
REST Variables API is unavailable.

Design creation does not use this plugin. Kotikit agents create or refine
Figma drafts through the official Figma assistant integration, then record node
metadata back into kotikit for audit and comment mapping.

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
2. In Figma: Plugins -> Development -> kotikit. Paste the URL into Connect.
3. To import variables on a Professional plan, open the source design-system
   file in Figma and click **Sync Variables From Open File**.

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
