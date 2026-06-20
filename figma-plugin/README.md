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

1. From the project where you ran `kotikit init`: `kotikit mcp --bridge`.
   Copy the printed URL (`ws://localhost:53124?token=...`).
2. In Figma: Plugins -> Development -> kotikit. Paste the URL into Connect.
3. To import variables on a Professional plan, open the source design-system
   file in Figma and click **Sync Variables From Open File**.
4. (P5-D4 -- coming) pick a screen, click Run All.

When developing from this repository, `bun run bridge` from the repository root
starts the same bridge.

## Test

```bash
cd figma-plugin
bun test
```
