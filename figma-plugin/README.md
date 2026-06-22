# kotikit Figma plugin

Phase 5 of the kotikit design track.

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

## Use

1. Ask your assistant to start the kotikit Figma plugin bridge.
   It will build `dist/` if needed, patch `manifest.json` for the chosen
   localhost port, and return a URL (`ws://localhost:53124?token=...`).
2. In Figma: Plugins -> Development -> kotikit. Paste the URL into Connect.
3. Before creating or refining a screen, send your assistant the exact Figma
   draft page link. The page name must contain `Draft` or `Drafts`. Kotikit
   binds that page, and the plugin applies generated frames inside a
   kotikit-owned Section on that page.
4. To import variables on a Professional plan, open the source design-system
   file in Figma and click **Sync Variables From Open File**.
5. For screen creation, use the assistant flow: ask to create or refine the
   Figma design, connect the plugin, then let the plugin run the returned plan
   step by step.

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
