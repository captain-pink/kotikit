# Figma Setup

kotikit uses three Figma integration paths:

1. The Figma REST API for syncing published libraries and reading comments for
   feedback review.
2. The official Figma assistant integration for creating and refining draft
   designs in Figma.
3. The local kotikit Figma plugin only for exporting variables when REST
   variables are unavailable.

## Personal Access Token

Figma personal access token is not required for draft creation when your
assistant is connected through Figma's remote MCP integration. Create a token
only when you want local design-system sync or Figma comment feedback, then
store it in the target workspace `.env` file:

```env
FIGMA_TOKEN=figd_...your_token_here...
```

Recommended scopes:

- File read access for design-system sync.
- `file_comments:read` for the lightweight `review-screen` feedback loop.

Do not put the token in the kotikit repo. It belongs in the target project root
next to `.kotikit/`.

## Account And Rate Limits

Professional, Organization, or Enterprise Figma accounts are the practical
target for kotikit design-system sync. Free/Starter accounts can have very low
monthly or per-minute limits on file endpoints, so sync may pause repeatedly or
fail before a useful design-system index is built.

kotikit uses adaptive pacing and exponential backoff instead of hardcoding one
Figma quota. That helps across different seats and plans, but it cannot turn a
very low quota into a reliable large-library sync. If the assistant reports
rate-limit pauses often, retry later, use a paid workspace token, or sync a
smaller published library first.

## Published Libraries

Design-system sync uses Figma's published component APIs. The source file must
be published as a library before kotikit can see importable component keys.

If a file is not published, Figma may still show components in the UI, but the
published-component API returns zero usable components. Kotikit does not scrape
the full document tree as a substitute, because draft creation needs importable
keys.

kotikit can still inspect some draft-file data for experiments. That is
different from composing a new Figma draft with reusable design-system
components. Generated drafts need importable component keys, and those keys
come from published libraries.

## Draft Page Safety

kotikit does not write to arbitrary Figma pages.

Before creating a design, the assistant must bind an exact draft page URL. The
page URL must:

- include `node-id`
- point to a Figma page node
- have a page name containing `Draft` or `Drafts`

Generated frames are placed inside a kotikit-owned Section on that page. Later
apply metadata validates the Figma file, page, and Section before graph QA can
use it.

## Official Figma Assistant Integration

Install the Figma assistant integration for the assistant you use, such as
Claude Code or Codex, from inside Figma. Kotikit agents use that official
integration to write draft designs with Figma's supported tools.

In Codex-style environments, the relevant official Figma tools are
`use_figma` for normal Figma writes and `generate_figma_design` only when a
web page or HTML reference should be captured into Figma. Normal kotikit draft
creation uses deterministic `use_figma` writes one transaction at a time.
`generate_figma_design` is reserved for capturing a web page or HTML reference,
not for composing kotikit's design-system-grounded screen states. Kotikit still
owns the spec, design-system search, draft target, canvas plan, apply packet,
and audit logging.

Kotikit draft output should use imported design-system component instances,
icons, design variables, and auto layout. When a reusable component does not
exist, kotikit should still compose the visible screen first with screen-draft
structure, then ask whether the designer wants those reusable parts extracted
as draft components on the same draft page.

Each active Figma transaction creates exactly one screen state or region state
at the bounds from the canvas plan. After each write, record transactionId,
node id, bounds, component refs, component source, variable refs, required icon
refs, auto-layout metadata, screenshot review status, and a compact
`evidenceSnapshot` from the applied root node with
`kotikit_record_figma_apply`, then continue the run. The evidence snapshot
should be scanner-derived from actual Figma nodes and include visible component
instances, local design-system component/icon keys, bounds, layout mode,
visibility, opacity, and compact layout metrics. Scanner output should use
`FigmaEvidenceSnapshot/v1` with `parts`, `componentInstances`, `layoutFrames`,
and `icons` arrays plus direct-child and auto-layout-container counts in
`summary`. Existing-component proof must be the actual visible UI instance for
that part. Hidden references, low-opacity proof layers, imported-but-unused
components, and hand-built text or rectangles do not count. Take a screenshot
after placing visible DS components, inspect it for overlap, clipped or
mirrored text, broken component internals, and layout drift, then record
`screenshotReviewed: true` plus any `screenshotFindings`. Newly created local
components do not count as existing design-system reuse.

## Figma Comment Feedback

After a draft exists, designers can leave normal Figma comments and ask kotikit
to review them. Kotikit reads comments through Figma REST with
`kotikit_feedback_snapshot`, maps `client_meta.node_id` to the recorded node
ledger, saves a compact `CommentEvidenceMap`, then creates a `RevisionPlan` and
asks before applying changes.

The tiny core does not post comments, resolve threads, or store feedback as
project memory. Comment reads require a token with `file_comments:read`; draft
creation still uses the official Figma assistant integration for writes.

## Local Kotikit Plugin

The plugin is optional for design-system search. It is needed only for
exporting variables on Figma plans where REST variables are unavailable.

Build the plugin:

```bash
cd ~/kotikit
bun run plugin:build
```

Import it in Figma:

```text
Plugins -> Development -> Import plugin from manifest -> ~/kotikit/figma-plugin/manifest.json
```

Normally you do not start the bridge manually. Use it only when kotikit tells
you variables could not be synced through the REST API. Ask the assistant:

```text
Start the kotikit Figma plugin bridge.
```

The assistant calls `kotikit_bridge_start`, prepares the tiny variable-sync
plugin if needed, patches the manifest for the selected localhost port, and
gives you a one-time `ws://localhost:...?...` URL to paste into the plugin.

## Variable Fallback

Figma's REST Variables API is Enterprise-gated. On Professional plans, sync may
import components and styles but skip variables.

When variables or tokens are important on non-Enterprise plans, use the local
plugin fallback. The plugin has one job: read variables from the currently open
Figma file through Figma's Plugin API and send them to kotikit over localhost.
It does not create designs, review comments, or sync components.

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

Free/Starter tokens are not a reliable target for large design-system sync.
They are useful for tiny experiments, but the normal kotikit workflow assumes a
paid workspace token with access to the published library being synced.
