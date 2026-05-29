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

1. From the kotikit project root in your terminal: `bun run bridge`.
   Copy the printed URL (`ws://localhost:53124?token=...`).
2. In Figma: Plugins -> Development -> kotikit. Paste the URL into Connect.
3. (P5-D4 -- coming) pick a screen, click Run All.

## Test

```bash
cd figma-plugin
bun test
```
