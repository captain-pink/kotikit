# Figma Setup

kotikit uses two Figma integration paths:

1. The Figma REST API for syncing published libraries, reading comments, and
   posting approved comments.
2. The local Figma plugin for applying draft designs and exporting variables
   when REST variables are unavailable.

## Personal Access Token

Create a Figma personal access token in Figma account settings and store it in
the target project's `.env` file:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

Recommended scopes:

- File read access for design-system sync and design review evidence.
- `file_comments:read` for browserless comment review.
- `file_comments:write` only if you want kotikit to post approved replies or
  review comments.

Do not put the token in the kotikit repo. It belongs in the target project root
next to `.kotikit/`.

## Published Libraries

Design-system sync uses Figma's published component APIs. The source file must
be published as a library before kotikit can see importable component keys.

If a file is not published, Figma may still show components in the UI, but the
published-component API returns zero usable components. Kotikit does not scrape
the full document tree as a substitute, because draft creation needs importable
keys.

## Draft Page Safety

kotikit does not write to arbitrary Figma pages.

Before creating a design, the assistant must bind an exact draft page URL. The
page URL must:

- include `node-id`
- point to a Figma page node
- have a page name containing `Draft` or `Drafts`

Generated frames are placed inside a kotikit-owned Section on that page. Later
apply logs validate the Figma file, page, and Section metadata before updating
node maps used for comment review.

## Figma Plugin

The plugin is optional for design-system search and comment reading. It is
needed for:

- applying generated Figma design plans
- exporting variables on Figma plans where REST variables are unavailable

Build the plugin:

```bash
cd ~/kotikit
bun run plugin:build
```

Import it in Figma:

```text
Plugins -> Development -> Import plugin from manifest -> ~/kotikit/figma-plugin/manifest.json
```

Normally you do not start the bridge manually. Ask the assistant:

```text
Start the kotikit Figma plugin bridge.
```

The assistant calls `kotikit_bridge_start`, prepares the plugin build if
needed, patches the manifest for the selected localhost port, and gives you a
one-time `ws://localhost:...?...` URL to paste into the plugin.

## Variable Fallback

Figma's REST Variables API is Enterprise-gated. On Professional plans, sync may
import components and styles but skip variables.

Use the plugin fallback:

1. Open the source design-system file in Figma.
2. Ask the assistant to start the kotikit bridge.
3. Run Plugins -> Development -> kotikit.
4. Paste the bridge URL.
5. Click **Sync Variables From Open File**.

The plugin exports variables from the open Figma file through the Plugin API and
sends them to kotikit over localhost.

## API Limits

Figma applies different rate limits depending on token permissions, endpoint
tier, account type, and current usage. kotikit uses an adaptive limiter with
backoff instead of assuming one fixed Professional or Enterprise quota.

Large design systems may pause before the MCP request timeout and ask you to
run sync again. The checkpoint is saved locally and the next run resumes or
restarts safely.

