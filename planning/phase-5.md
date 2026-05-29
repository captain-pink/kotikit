# Kotikit — Phase 5 Implementation Plan

> **Phase 5 deliverable:** *A designer in VS Code says "build the design for this spec" in their `/kotikit:auto` conversation; kotikit writes a `<screen>.design.plan.json` next to the spec. The designer opens the kotikit Figma plugin, clicks Connect (auto-detects the local bridge), picks a screen, and clicks Run — kotikit places every spec'd DS component on a new Figma page with one auto-layout frame per state. Variables are bound by name; nothing else mutates.*
>
> Build on Phases 1-4 (specs, sync, code track, scaffolding). No code → Figma reverse path, no real-time bidirectional sync, no flow-level prototyping. Just **spec → design plan → plugin executes plan → frames + component instances appear in Figma**.

This document is self-contained. A senior engineer or AI agent with **Phase 1-4 context** should be able to read it and build the right thing. Read §0 before picking up any task.

---

## 0. Orientation — what you are building (read this first)

### Architectural decisions that are non-negotiable

These were settled in advance. Do **not** re-litigate them.

1. **Transport: WebSocket bridge inside the existing Bun MCP process.** The same server process can listen on stdio (for Claude Code) AND a localhost WebSocket (for the Figma plugin) when started with `--bridge` (or env var `KOTIKIT_BRIDGE=1`). The bridge speaks the same JSON-RPC payloads as the stdio MCP server — same tool names, same handlers, same registry. Authentication is a per-session token written to `.kotikit/bridge.json`. **No second daemon. No filesystem polling.**

2. **One Figma Page per screen; one auto-layout Frame per state.** For each screen spec, the plugin creates (or finds) a Page named `<screen>`. Inside that page, one Frame per `requirements.states` key (default fallback: `default`, `loading`, `empty`, `error`, `filled`). Each frame is 1440×AUTO with `layoutMode = "VERTICAL"`, `paddingTop/bottom/left/right = 24`, `itemSpacing = 16`. Components placed inside that frame are appended in spec-declared order. The designer rearranges from there.

3. **Four design plan step kinds.** `define-state-frame` (build the per-state frames), `place-component` (import + append a DS component by key), `apply-auto-layout` (configure frame settings — usually one per `define-state-frame`, but separable for re-runs), `bind-variable` (rename-bound color/text/effect variables). One plan per screen, written to `<screen>.design.plan.json` next to the spec.

4. **Plugin code at `figma-plugin/` repo root, own package.json + Vite build.** Sibling to `src/`. Independent dependency graph (React, Figma typings, Vite) so the MCP server's `bun test` and `tsc --noEmit` are not contaminated. A root-level `bun run plugin:build` script runs Vite then copies the output next to the manifest.

5. **Two-pane plugin UI: plan checklist + status log.** Left pane lists the steps of the active screen's design plan with per-step Run buttons + a Run All button at the top. Right pane shows a streaming log of placements, bind successes, warnings (missing keys, unresolved variables). **No chat surface in the plugin.** VS Code Claude Code stays the conversational surface; the plugin is the execution surface.

6. **Bridge discovery via `Copy Connect Link`.** When `bun run kotikit:bridge` starts, it prints a URL like `ws://localhost:53124?token=<8-char-token>` plus a one-line "Copy this link and paste into the kotikit Figma plugin's Connect dialog." The plugin auto-tries `localhost:53124` first (the default), accepts a pasted URL otherwise, and stores the link in Figma `clientStorage`. Multi-project selection is **out of Phase 5 scope** (one bridge = one project).

7. **Testing strategy: full bun test for MCP tools + thin Figma shim for plugin orchestration.** New MCP tools (`kotikit_plan_design`, `kotikit_design_get_screen`, `kotikit_design_apply_step`) get the same `bun test` coverage as Phase 1-4. The plugin uses a `FigmaShim` interface that abstracts the 6-8 Figma API calls we touch (`createPage`, `createFrame`, `importComponentByKeyAsync`, `appendChild`, `setBoundVariable`, `getLocalVariables`); a fake implementation drives the orchestration logic in unit tests. **No Playwright-against-Figma**, no headless plugin runner. Phase 5 ships with a manual smoke checklist in §6.

8. **One-way sync only.** Phase 5 reads from `.kotikit/specs/` and writes to Figma. Edits made inside Figma never flow back to the spec. The plugin can re-run a plan idempotently (replacing the frame contents on the screen's page), but it does not detect or merge Figma-side changes. Bidirectional sync is **Phase 6 or later**.

### Why we're not "putting Claude in the plugin"

OPEN_QUESTIONS B2 says designers want "one place" — VS Code AND the plugin running `/kotikit:auto`. We cannot honestly deliver that in Phase 5 because the conversation requires Claude, and Claude lives in VS Code. Phase 5 honors the spirit of B2 by making the plugin a true execution surface (not a search-and-paste tool), while keeping the brainstorm conversation in VS Code where it already works. The bridge token model leaves room for a Phase 7 "plugin streams chat from VS Code" if Anthropic ships an embedded SDK.

### Folder layout produced by Phase 5

Inside `.kotikit/` (additive):

```
.kotikit/
  bridge.json                          # NEW — token + port + project root; gitignored
  specs/checkout-flow/
    flow.json
    cart.spec.json
    cart.code.plan.json                # Phase 3
    cart.design.plan.json              # NEW (Phase 5)
    shipping.spec.json
    shipping.design.plan.json
    ...
```

Inside the repo (new top-level directory):

```
figma-plugin/
  manifest.json                        # Figma plugin manifest
  package.json                         # plugin-local deps (React, Vite, Figma typings)
  vite.config.ts
  tsconfig.json
  code.ts                              # sandbox-side entry (main thread)
  ui/
    index.html                         # Vite entry
    main.tsx                           # React UI bootstrap
    App.tsx                            # Two-pane layout
    components/                        # PlanList, StatusLog, ConnectDialog
  src/
    bridge-client.ts                   # WebSocket JSON-RPC client (in-plugin UI side)
    figma-shim.ts                      # Interface + real impl wrapping figma.* calls
    orchestrator.ts                    # Pure logic: plan → shim calls
    test/
      orchestrator.test.ts             # uses fake shim
  dist/                                # gitignored — Vite output
```

Inside `src/` (MCP server additions):

```
src/
  mcp/
    bridge/
      server.ts                        # Bun WebSocket server (alongside stdio)
      token.ts                         # generate/read/write bridge.json
      protocol.ts                      # JSON-RPC framing
    tools/
      plan-design.ts                   # kotikit_plan_design
      design-screen.ts                 # kotikit_design_get_screen, kotikit_design_apply_step
  planning/
    design-plan-schema.ts              # Zod schema for DesignPlan
    design-planner.ts                  # spec → DesignPlan
    design-plan-store.ts               # read/write <screen>.design.plan.json
  util/
    paths.ts                           # EXTEND: designPlanPath, bridgeConfigPath
```

### Conventions every task must follow

- **Language/runtime:** TypeScript, Bun for the MCP server. The Figma plugin uses TypeScript + Vite + React (its own toolchain).
- **Validation:** every external/persisted shape goes through Zod.
- **Errors:** plain English via `KotikitError`.
- **The bridge MUST share handlers with stdio.** Do not duplicate tool logic. The bridge accepts a JSON-RPC message, looks up the handler from the same `ToolRegistry.handlers` map the stdio CallTool path uses, and returns the result.
- **Bridge auth is mandatory.** Every WebSocket connection must present the per-session token on connect (query param `?token=...`); reject any other connection with HTTP 401 BEFORE upgrade.
- **Localhost-only bind.** The WebSocket server MUST bind to `127.0.0.1`, not `0.0.0.0`. No remote access.
- **`.kotikit/bridge.json` is gitignored.** Update `.gitignore` in P5-A1 so a stray token never gets committed.
- **The Figma shim is the only thing in `figma-plugin/src/` that touches the `figma.*` global.** Orchestrator and tests use the shim interface.
- **No `figma.notify` in tests.** The fake shim collects notifications into an array tests can read.

### Shared types (canonical)

`src/planning/design-plan-schema.ts`:

```ts
import { z } from "zod";

export const DesignPlanStepKindSchema = z.enum([
  "define-state-frame",
  "apply-auto-layout",
  "place-component",
  "bind-variable",
]);
export type DesignPlanStepKind = z.infer<typeof DesignPlanStepKindSchema>;

const StateFrameStepSchema = z.object({
  kind: z.literal("define-state-frame"),
  state: z.string(),                          // "default" | "loading" | ... or custom
  width: z.number().int().positive().default(1440),
  height: z.union([z.number().int().positive(), z.literal("auto")]).default("auto"),
});

const AutoLayoutStepSchema = z.object({
  kind: z.literal("apply-auto-layout"),
  state: z.string(),                          // which state-frame to target
  direction: z.enum(["VERTICAL", "HORIZONTAL"]).default("VERTICAL"),
  padding: z.number().int().nonnegative().default(24),
  itemSpacing: z.number().int().nonnegative().default(16),
});

const PlaceComponentStepSchema = z.object({
  kind: z.literal("place-component"),
  state: z.string(),                          // which state-frame to append into
  componentName: z.string(),                  // for human reference
  dsKey: z.string().optional(),               // Figma component key — required for actual placement
  variant: z.record(z.string(), z.string()).optional(),  // e.g. {Variant: "Primary", Size: "md"}
});

const BindVariableStepSchema = z.object({
  kind: z.literal("bind-variable"),
  state: z.string(),                          // which state-frame to target
  variableName: z.string(),                   // e.g. "brand/blue"
  property: z.enum(["fill", "text", "effect"]).default("fill"),
  nodeNameHint: z.string().optional(),        // narrow which child to bind (Phase 5: optional)
});

export const DesignPlanStepSchema = z.discriminatedUnion("kind", [
  StateFrameStepSchema, AutoLayoutStepSchema, PlaceComponentStepSchema, BindVariableStepSchema,
]);
export type DesignPlanStep = z.infer<typeof DesignPlanStepSchema>;

export const DesignPlanSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),                       // null for single-screen scope
  pageName: z.string(),                                // Figma page where this screen lives
  states: z.array(z.string()).min(1),                  // resolved state list
  steps: z.array(DesignPlanStepSchema).min(1),
  createdAt: z.string(),
});
export type DesignPlan = z.infer<typeof DesignPlanSchema>;

export function parseDesignPlan(raw: unknown): DesignPlan;
```

`src/mcp/bridge/protocol.ts` (JSON-RPC framing for the bridge):

```ts
export interface BridgeRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;       // e.g. "tools/call"
  params: unknown;      // depends on method
}

export interface BridgeResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

/** Mirror MCP's protocol shape so the bridge speaks the same dialect Claude does. */
```

`.kotikit/bridge.json` schema:

```ts
export const BridgeConfigSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1024).max(65535),
  token: z.string().min(12),                  // random per session
  projectRoot: z.string(),                    // absolute path
  projectName: z.string(),                    // basename for display
  startedAt: z.string(),                      // ISO-8601
});
```

`figma-plugin/src/figma-shim.ts` (interface only):

```ts
export interface FigmaShim {
  // Page management
  findOrCreatePage(name: string): Promise<{ id: string }>;
  setCurrentPage(pageId: string): Promise<void>;

  // Frame management
  createFrame(input: {
    name: string;
    parentId: string;                                  // page id
    width: number;
    height: number | "auto";
  }): Promise<{ id: string }>;
  setAutoLayout(frameId: string, opts: {
    direction: "VERTICAL" | "HORIZONTAL";
    padding: number;
    itemSpacing: number;
  }): Promise<void>;

  // Component instances
  importComponentByKey(dsKey: string): Promise<{ id: string }>;
  appendInstance(parentId: string, componentId: string): Promise<{ instanceId: string }>;
  setVariantProperties(instanceId: string, props: Record<string, string>): Promise<void>;

  // Variables
  findVariableByName(name: string): Promise<{ id: string } | null>;
  setBoundVariable(nodeId: string, property: "fill" | "text" | "effect", variableId: string): Promise<void>;

  // UX
  notify(message: string, opts?: { error?: boolean }): void;
}
```

### Auto-commit policy

Phase 5 commits `.design.plan.json` files using the existing `autoCommit` machinery with `subjectScope: "spec"` (the plan is a spec-adjacent artifact, like Phase 3's `.code.plan.json`):

- `feat(spec): create design plan checkout-flow/cart`
- `feat(spec): update design plan checkout-flow/cart`

Footer unchanged: `Co-authored-by: Claude Code <noreply@anthropic.com>`. The bridge does NOT auto-commit Figma-side mutations (Figma isn't git-tracked); only the planning artifacts get committed.

---

## 1. Dependency tiers (the build order)

| Tier | Tasks | Theme |
|---|---|---|
| **Tier 0** | P5-A1, P5-A2, P5-A3 | Foundations: design plan schema, path helpers, bridge config schema + token mgmt |
| **Tier 1** | P5-B1, P5-B2, P5-B3 | Engines: design planner, design plan store, WebSocket bridge module |
| **Tier 2** | P5-C1, P5-C2, P5-C3 | MCP tools: plan_design, design_get_screen, design_apply_step (bridge-only) |
| **Tier 3** | P5-D1, P5-D2, P5-D3 | Figma plugin: scaffolding + manifest, FigmaShim + fake, orchestrator + tests |
| **Tier 4** | P5-D4 | Figma plugin UI (React, two-pane, connect flow) |
| **Tier 5** | P5-E1, P5-E2 | Wire MCP tools into server + design plan E2E test |

Dependency graph:

```
A1 (schema)   ┐
A2 (paths)    ├─► B1, B2     ─► C1            ─► E1 (wire)   ─► E2 (E2E)
A3 (bridge)   ┘─► B3 (WS)    ─► C3            ─► (bridge wired into server.ts in E1)
                  └─► C2 (design_get_screen)  ─► D3 (orchestrator uses tool data)

D1 (plugin scaffolding) ─► D2 (shim) ─► D3 (orchestrator) ─► D4 (UI)
                                                            ─► smoke checklist (§6)
```

---

## TIER 0 — Foundations

### P5-A1 — Design plan schema + Zod
**Depends on:** none
**Complexity:** S

**What to build**

`src/planning/design-plan-schema.ts` containing the canonical schema from §0. Export `DesignPlan`, `DesignPlanStep`, `DesignPlanStepKind`, and the `parseDesignPlan(raw)` helper that throws a `KotikitError` on malformed input.

Mirror the Phase 3 pattern in `src/planning/code-plan-schema.ts`: same export style, same error format, same Zod patterns.

Also update `.gitignore` to add `.kotikit/bridge.json` so the bridge token never gets committed.

**Acceptance criteria**
- `bun test src/planning/design-plan-schema.test.ts` proves:
  - Valid plan with all 4 step kinds round-trips.
  - Each step kind validates its own discriminator (zod rejects `kind: "fake-step"`).
  - `parseDesignPlan` throws `KotikitError` with field names on schema mismatch.
  - Defaults fill in (e.g. width=1440 when omitted).
- `cat .gitignore` includes `.kotikit/bridge.json`.

**Commit**: `feat(planning): add design plan schema with 4 step kinds`

---

### P5-A2 — Path helpers for design plan + bridge config
**Depends on:** none
**Complexity:** S

**What to build**

Extend `src/util/paths.ts`:

```ts
/** Path to <screen>.design.plan.json next to the spec. */
export const designPlanPath = (
  root: string,
  scope: string,
  screen: string | null
): string => {
  const name = screen ? `${screen}.design.plan.json` : "design.plan.json";
  return `${root}/.kotikit/specs/${scope}/${name}`;
};

/** Path to the bridge config file written when the bridge starts. */
export const bridgeConfigPath = (root: string): string =>
  `${root}/.kotikit/bridge.json`;
```

Add tests in `src/util/paths.test.ts` for both helpers — same pattern as Phase 3/4 path-helper tests.

**Acceptance criteria**
- `designPlanPath("/p", "x", null) === "/p/.kotikit/specs/x/design.plan.json"`.
- `designPlanPath("/p", "checkout", "cart") === "/p/.kotikit/specs/checkout/cart.design.plan.json"`.
- `bridgeConfigPath("/p") === "/p/.kotikit/bridge.json"`.

**Commit**: `feat(util): add design plan and bridge config path helpers`

---

### P5-A3 — Bridge config: schema + token generation + read/write
**Depends on:** P5-A2
**Complexity:** S

**What to build**

`src/mcp/bridge/token.ts`:

```ts
import { z } from "zod";

export const BridgeConfigSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1024).max(65535),
  token: z.string().min(12),
  projectRoot: z.string(),
  projectName: z.string(),
  startedAt: z.string(),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

/** Generate a short URL-safe token (12 chars from base32 alphabet). */
export function generateBridgeToken(): string;

/** Read + parse the bridge config from disk. Returns null if missing or malformed. */
export async function readBridgeConfig(root: string): Promise<BridgeConfig | null>;

/** Atomic write: writeFile to .tmp + rename. */
export async function writeBridgeConfig(root: string, cfg: BridgeConfig): Promise<void>;

/** Remove the bridge config file. No-op if absent. */
export async function clearBridgeConfig(root: string): Promise<void>;
```

`generateBridgeToken()` uses `crypto.randomUUID()` reformatted: take first 12 chars of the hex digest, ensure URL-safe (no padding, no slashes). Or use `crypto.randomBytes(8).toString("base64url").slice(0, 12)`. Either is fine; document the approach.

**Acceptance criteria**
- `bun test src/mcp/bridge/token.test.ts`:
  - Generated tokens are 12+ chars, URL-safe (no `+`, `/`, `=`).
  - Two consecutive calls produce different tokens.
  - Write + read round-trips.
  - Read on missing file returns null.
  - Read on malformed file returns null (no throw).
  - Clear removes the file; subsequent read returns null.
  - Schema rejects port < 1024 or > 65535.

**Commit**: `feat(bridge): add config schema, token generator, and atomic read/write`

---

## TIER 1 — Engines

### P5-B1 — Design planner (spec → DesignPlan)
**Depends on:** P5-A1, P5-A2
**Complexity:** M

**What to build**

`src/planning/design-planner.ts`:

```ts
import type { ScreenSpec, FlowManifest } from "../spec/schema.js";
import type { Config } from "../config/schema.js";
import { nowIso, pascalCase } from "../util/ids.js";
import { DesignPlanSchema, type DesignPlan, type DesignPlanStep } from "./design-plan-schema.js";

export interface GenerateDesignPlanInput {
  scope: string;
  screen: string | null;
  spec: ScreenSpec;
  flowManifest?: FlowManifest;
  config: Config;
}

export function generateDesignPlan(input: GenerateDesignPlanInput): DesignPlan;
```

Algorithm:

1. Derive `pageName`: `pascalCase(screen ?? scope)` (e.g. "Cart", "ProfilePage").
2. Resolve states: `Object.keys(spec.requirements.states)`. If empty, default to `["default"]`.
3. Build steps in this order:
   - For each state: one `define-state-frame` step (width 1440, height "auto").
   - For each state: one `apply-auto-layout` step (VERTICAL, padding 24, itemSpacing 16).
   - For each state: for each `spec.components[]` entry, one `place-component` step (component name + dsKey if present + no variant overrides).
   - For each state: one `bind-variable` step per `spec.requirements.colors` (if present) — Phase 5 MVP skips this if the spec doesn't list colors. Instead, emit one informational bind step PER state to remind the designer: `{kind: "bind-variable", state, variableName: "brand/primary", property: "fill"}` as a placeholder if no color list. (You can also skip this entirely — see acceptance criteria.)

The order matters: frames first, then auto-layout, then content, then bindings. This way a partial re-run with `state: "loading"` only re-creates that frame.

**Acceptance criteria**
- `bun test src/planning/design-planner.test.ts`:
  - A spec with 4 states (`loading`, `empty`, `error`, `filled`) and 3 components → plan has 4 `define-state-frame` + 4 `apply-auto-layout` + 12 `place-component` steps (3 components × 4 states).
  - A spec with no states → plan defaults to a single `default` state.
  - `dsKey` is copied from `spec.components[].dsKey` when present.
  - Plan passes `DesignPlanSchema.parse`.
  - `pageName` is PascalCase of the screen slug (or scope slug for single-screen).

**Commit**: `feat(planning): add design planner producing per-screen design plans`

---

### P5-B2 — Design plan store (read/write/delete)
**Depends on:** P5-A1, P5-A2
**Complexity:** S

**What to build**

`src/planning/design-plan-store.ts` — mirrors `src/planning/plan-store.ts` from Phase 3:

```ts
export async function writeDesignPlan(
  root: string,
  scope: string,
  screen: string | null,
  plan: DesignPlan
): Promise<string>;

export async function readDesignPlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<DesignPlan | null>;

export async function deleteDesignPlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<void>;
```

Same error patterns as the Phase 3 plan-store: malformed JSON throws `KotikitError`; missing file returns null; pretty JSON + trailing newline.

**Acceptance criteria**
- `bun test src/planning/design-plan-store.test.ts`:
  - Write/read round-trip.
  - Missing → null.
  - Malformed JSON → KotikitError.
  - Malformed schema → KotikitError.
  - Delete removes the file; subsequent read is null.
  - Multi-screen vs single-screen filename convention works (`<screen>.design.plan.json` vs `design.plan.json`).

**Commit**: `feat(planning): add design plan store`

---

### P5-B3 — WebSocket bridge module
**Depends on:** P5-A3, existing `ToolRegistry` from `src/mcp/server.ts`
**Complexity:** L

**What to build**

`src/mcp/bridge/server.ts`:

```ts
import type { ToolRegistry } from "../server.js";
import type { BridgeConfig } from "./token.js";

export interface BridgeOpts {
  registry: ToolRegistry;
  config: BridgeConfig;
  /** Called when bridge starts (for logging). */
  onReady?: (info: { url: string }) => void;
}

export interface BridgeServer {
  close(): Promise<void>;
}

/**
 * Start a localhost WebSocket server that speaks the same JSON-RPC
 * protocol as the stdio MCP transport. Routes incoming "tools/call" and
 * "tools/list" requests through the same handlers map.
 *
 * Uses Bun.serve with websocket support.
 * Binds to 127.0.0.1 ONLY.
 * Rejects upgrade requests whose ?token=... query param doesn't match config.token.
 */
export function startBridgeServer(opts: BridgeOpts): BridgeServer;
```

Implementation:

- Use `Bun.serve({ hostname: "127.0.0.1", port: config.port, fetch: ..., websocket: ... })`.
- The `fetch` handler:
  - Parses query `token` from URL.
  - On any `GET /handshake`: returns JSON `{ projectName, projectRoot, version: 1 }` (no auth required for the handshake — it's discovery; the actual tool calls require token).
  - On any WebSocket upgrade: validate token. If invalid → `return new Response("Forbidden", { status: 403 })`. If valid → call `server.upgrade(req)`.
  - Otherwise → 404.
- The `websocket` handlers:
  - `open(ws)`: do nothing (the client sends requests first).
  - `message(ws, raw)`: parse JSON-RPC, look up `handlers.get(name)`, invoke, send back the response. On parse error, send a JSON-RPC error response.
- Supported JSON-RPC methods: `tools/list` (returns `registry.tools`) and `tools/call` (calls the handler from `registry.handlers`).

Test with Bun's WebSocket client (`new WebSocket("ws://localhost:<port>?token=...")`) — `bun test` supports this.

**Acceptance criteria**
- `bun test src/mcp/bridge/server.test.ts`:
  - Start bridge with a fake registry containing one tool that returns `{ ok: true }`.
  - Connect with valid token → tools/call returns the response.
  - Connect with invalid token → upgrade rejected with HTTP 403.
  - GET `/handshake` returns the project name without requiring auth.
  - `tools/list` returns the registered tool names.
  - Calling an unknown tool returns a JSON-RPC error response.
  - Calling a tool that throws returns a JSON-RPC error response (not a crash).
  - Bridge.close() resolves cleanly and the port is released (subsequent server can bind to the same port).

**Commit**: `feat(bridge): add localhost WebSocket bridge sharing stdio handlers`

---

## TIER 2 — MCP tools

### P5-C1 — `kotikit_plan_design` MCP tool
**Depends on:** P5-B1, P5-B2
**Complexity:** S

**What to build**

`src/mcp/tools/plan-design.ts` — mirrors Phase 3's `plan-code.ts`:

### `kotikit_plan_design`
Input: `{ scope: string; screen?: string }`

Logic:
1. Load config (default if missing).
2. Read spec via `readScreenSpec` — friendly error if missing.
3. Try read flow manifest.
4. `const plan = generateDesignPlan({scope, screen: screen ?? null, spec, flowManifest, config});`
5. `const path = await writeDesignPlan(root, scope, screen ?? null, plan);`
6. Call `autoCommit({ subjectScope: "spec", scope, kind: "create"-or-"update", files: [path], enabled: config.git.autoCommit, subjectSuffix: ` design plan ${scope}${screen ? "/" + screen : ""}` })`. Wait — the existing subject format is `feat(spec): create <scope>` — we need `feat(spec): create design plan <scope>/<screen>`. Use `autoCommit` with custom subjectSuffix to produce `feat(spec): create design plan checkout-flow/cart`.

Actually the cleanest path: just use the existing `autoCommitSpec` helper with the suffix shape. Let me think: the current `autoCommit` builds the subject as `feat(${scopePrefix}): ${kind} ${scope}${suffix}`. So passing `scope: "design plan checkout-flow"` and `suffix: "/cart"` produces `feat(spec): create design plan checkout-flow/cart`. That works.

7. Return `toolText("Design plan written. <n> steps for <pageName>.", { planPath: path, plan })`.

### Tool definition

```ts
registry.tools.push({
  name: "kotikit_plan_design",
  description: "Generate the per-screen design plan from a spec.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string" },
      screen: { type: "string" },
    },
    required: ["scope"],
  },
});
```

**Acceptance criteria**
- `bun test src/mcp/tools/plan-design.test.ts`:
  - Single-screen plan: writes `<scope>/design.plan.json`.
  - Multi-screen plan: writes `<scope>/<screen>.design.plan.json`.
  - Missing spec: friendly error.
  - Plan content matches `DesignPlanSchema`.
  - With autoCommit on: a commit appears with subject containing `design plan <scope>`.

**Commit**: `feat(mcp): add plan_design tool producing design plans`

---

### P5-C2 — `kotikit_design_get_screen` MCP tool
**Depends on:** P5-B2, Phase 2 `kotikit_ds_get_component`
**Complexity:** M

**What to build**

(Same file as C1, or a new `src/mcp/tools/design-screen.ts`.)

### `kotikit_design_get_screen`
Input: `{ scope: string; screen?: string }`

Logic:
1. Load config + read spec + try flow manifest.
2. Read `DesignPlan` from disk; if absent, error: "No design plan yet for <scope>. Call plan_design first."
3. For each `place-component` step's `componentName`: try to load the per-component JSON from `design-system/components/<slug>.json`. Skip missing ones (and record in a `skipped` array). Use the existing `ComponentJsonSchema` parse.
4. Return `toolText("Design plan for <pageName>: <n> steps.", { plan, spec, flow?, dsComponents, skipped })`.

This is the "fetch everything the plugin needs in one call" endpoint. The plugin calls it once after the designer picks a screen and gets all the data needed for `Run All`.

### Tool definition

```ts
registry.tools.push({
  name: "kotikit_design_get_screen",
  description: "Fetch the design plan + spec + DS component bundle for one screen.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string" },
      screen: { type: "string" },
    },
    required: ["scope"],
  },
});
```

**Acceptance criteria**
- `bun test src/mcp/tools/design-screen.test.ts`:
  - Happy path: returns `{plan, spec, dsComponents, skipped}`.
  - Missing design plan → friendly error mentioning `plan_design`.
  - Missing spec → friendly error.
  - DS component JSON missing → entry appears in `skipped`, no error.
  - With a flow manifest: `flow` field is populated.

**Commit**: `feat(mcp): add design_get_screen bundle tool`

---

### P5-C3 — `kotikit_design_apply_step` MCP tool (bridge-side audit log)
**Depends on:** P5-B2
**Complexity:** S

**What to build**

This tool records that the plugin applied a step. It does NOT do any Figma work itself — Figma operations live in the plugin. This tool is a side-effect log so kotikit knows what's been applied.

(Same file as C2.)

### `kotikit_design_apply_step`
Input: `{ scope: string; screen?: string; stepIndex: number; outcome: "ok" | "warned" | "failed"; note?: string }`

Logic:
1. Append a line to `<scope>/<screen>.design.apply.log` (one log per screen).
2. The log is JSONL: one row per call: `{ts, stepIndex, outcome, note}`.
3. Return `toolText("Recorded apply: step <n> <outcome>.", { line: <the appended line> })`.

This is the only Phase 5 MCP tool that writes a non-committed artifact (the apply log is intended as ephemeral diagnostics; not auto-committed). Add it to `.gitignore` as `*.design.apply.log` in P5-A1.

### Tool definition

```ts
registry.tools.push({
  name: "kotikit_design_apply_step",
  description: "Record that the plugin applied a design plan step (audit log).",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string" },
      screen: { type: "string" },
      stepIndex: { type: "number" },
      outcome: { type: "string", enum: ["ok", "warned", "failed"] },
      note: { type: "string" },
    },
    required: ["scope", "stepIndex", "outcome"],
  },
});
```

**Acceptance criteria**
- `bun test src/mcp/tools/design-apply-step.test.ts`:
  - Records ok / warned / failed outcomes.
  - Appends to the JSONL log (multiple calls → multiple lines).
  - Log file is at the expected path next to the spec.

**Commit**: `feat(mcp): add design_apply_step audit log tool`

---

## TIER 3 — Figma plugin

### P5-D1 — Plugin scaffolding (manifest, package.json, Vite config)
**Depends on:** none (independent toolchain)
**Complexity:** M

**What to build**

Create `figma-plugin/` at repo root:

```
figma-plugin/
  manifest.json
  package.json
  tsconfig.json
  vite.config.ts
  code.ts                    # entry — does nothing in V1 except call `figma.showUI(__html__)`
  ui/
    index.html               # bare Vite entry, will be filled by D4
    main.tsx                 # React mount
    App.tsx                  # placeholder until D4
  README.md                  # how to install the plugin in Figma
```

`manifest.json`:

```json
{
  "name": "kotikit",
  "id": "kotikit-design-track",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui/index.html",
  "editorType": ["figma", "dev"],
  "networkAccess": {
    "allowedDomains": ["http://localhost:*", "ws://localhost:*", "https://localhost:*"]
  }
}
```

`package.json` (own dependency graph):

```json
{
  "name": "@kotikit/figma-plugin",
  "private": true,
  "scripts": {
    "build": "vite build",
    "test": "bun test"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@figma/plugin-typings": "^1.100.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.0.0"
  }
}
```

`vite.config.ts`: build to a single `dist/ui.html` (inlined CSS+JS via `vite-plugin-singlefile`) and produce `code.js` from `code.ts` via a separate non-bundled tsc step or a multi-input Vite build.

Add a root-level script in the main `package.json`: `"plugin:build": "cd figma-plugin && bun install && bun run build"`.

Add `figma-plugin/dist/` to `.gitignore`.

Also create `figma-plugin/README.md` explaining: how to install (`bun install` inside `figma-plugin/`), how to build (`bun run build`), and how to load in Figma (Plugins → Development → Import plugin from manifest → pick `manifest.json`).

**Acceptance criteria**
- `cd figma-plugin && bun install` succeeds.
- `cd figma-plugin && bun run build` produces `figma-plugin/dist/code.js` and `figma-plugin/dist/ui.html`.
- The root repo's `bun test` and `bun x tsc --noEmit` still pass — the plugin's React imports don't leak into the server.
- `manifest.json` validates as a Figma plugin manifest (you can verify by loading it in Figma manually; for CI we just confirm it's valid JSON).

**Commit**: `feat(figma-plugin): scaffold manifest, Vite build, and base entry`

---

### P5-D2 — FigmaShim interface + fake implementation
**Depends on:** P5-D1
**Complexity:** M

**What to build**

`figma-plugin/src/figma-shim.ts` — the interface from §0.

`figma-plugin/src/figma-shim-real.ts` — the real implementation wrapping `figma.*` calls:

```ts
import type { FigmaShim } from "./figma-shim.js";

export const realFigmaShim: FigmaShim = {
  async findOrCreatePage(name) {
    const existing = figma.root.children.find((p): p is PageNode => p.type === "PAGE" && p.name === name);
    if (existing) return { id: existing.id };
    const page = figma.createPage();
    page.name = name;
    return { id: page.id };
  },
  async setCurrentPage(pageId) {
    const page = figma.root.findChild((n) => n.id === pageId) as PageNode | null;
    if (!page) throw new Error(`Page not found: ${pageId}`);
    figma.currentPage = page;
  },
  // ... rest
};
```

`figma-plugin/src/figma-shim-fake.ts` — a pure in-memory implementation for tests:

```ts
import type { FigmaShim } from "./figma-shim.js";

interface FakeNode {
  id: string;
  type: "PAGE" | "FRAME" | "INSTANCE";
  name?: string;
  parentId?: string;
  children: string[];
  // Frame props
  width?: number;
  height?: number | "auto";
  layoutMode?: "VERTICAL" | "HORIZONTAL";
  padding?: number;
  itemSpacing?: number;
  // Instance props
  componentKey?: string;
  variantProperties?: Record<string, string>;
}

export class FakeFigmaShim implements FigmaShim {
  nodes: Map<string, FakeNode> = new Map();
  variables: Map<string, string> = new Map();   // name → id
  bindings: { nodeId: string; property: string; variableId: string }[] = [];
  notifications: { message: string; error?: boolean }[] = [];
  currentPageId: string | null = null;

  // ... implementations that mutate the in-memory state and return synthetic ids
}
```

**Acceptance criteria**
- `bun test figma-plugin/src/test/figma-shim-fake.test.ts`:
  - `findOrCreatePage("Cart")` creates a page; second call returns the same id.
  - `createFrame({...})` creates a frame and `appendInstance` appends it to a parent.
  - `setAutoLayout` records the settings.
  - `findVariableByName` returns null when not seeded, an id when seeded.
  - `notify` collects messages.

**Commit**: `feat(figma-plugin): add FigmaShim interface, real impl, and fake for tests`

---

### P5-D3 — Plugin orchestrator (read plan → call shim)
**Depends on:** P5-D2
**Complexity:** L

**What to build**

`figma-plugin/src/orchestrator.ts`:

```ts
import type { FigmaShim } from "./figma-shim.js";

// These types mirror DesignPlan from src/planning/design-plan-schema.ts.
// We duplicate them here (small) because the plugin doesn't share imports with the server.
export interface DesignPlanStep { /* same shape */ }
export interface DesignPlan { /* same shape */ }

export interface ApplyStepResult {
  stepIndex: number;
  outcome: "ok" | "warned" | "failed";
  note?: string;
}

export interface OrchestratorOpts {
  shim: FigmaShim;
  plan: DesignPlan;
  /** Optional: call back with each step result (for status logging in the UI). */
  onStep?: (result: ApplyStepResult) => void;
}

/**
 * Apply ALL steps in plan order.
 * Returns the array of results.
 * Catches per-step errors and continues to the next step.
 */
export async function applyAll(opts: OrchestratorOpts): Promise<ApplyStepResult[]>;

/**
 * Apply ONE step by index.
 */
export async function applyStep(opts: OrchestratorOpts & { stepIndex: number }): Promise<ApplyStepResult>;
```

Algorithm for each step kind:

- `define-state-frame`: ensure page exists for plan.pageName → `setCurrentPage` → `createFrame({name: state, parentId: page, width, height})` and record frame id keyed by state.
- `apply-auto-layout`: look up frame by state → `setAutoLayout(...)`.
- `place-component`: requires `dsKey`. If missing → result `{outcome: "warned", note: "no dsKey for <name>"}`. Else: `importComponentByKey(dsKey)` → `appendInstance(stateFrameId, componentId)` → if `variant` is set, `setVariantProperties(instance, variant)`.
- `bind-variable`: `findVariableByName(variableName)` → if null, warn. Else `setBoundVariable(stateFrameId, property, variableId)` (Phase 5: bind to the frame itself unless `nodeNameHint` is provided; deeper nested binding is deferred).

The orchestrator maintains a `state → frameId` map across step applications so subsequent steps can target the right frame. This map is built fresh per `applyAll` call.

Error handling:
- Any thrown exception → result `{outcome: "failed", note: err.message}`. Do NOT halt the rest of the plan.

**Acceptance criteria**
- `bun test figma-plugin/src/test/orchestrator.test.ts` using `FakeFigmaShim`:
  - A 3-step plan (frame + auto-layout + 2 components) → 4 results, all `outcome: "ok"`.
  - A `place-component` step with no `dsKey` → `outcome: "warned"`, all other steps still execute.
  - A `bind-variable` step with a nonexistent variable name → `outcome: "warned"`.
  - A throwing shim (test: stub `importComponentByKey` to throw) → that step is `outcome: "failed"`, subsequent steps still execute.
  - State-frame map: a second `place-component` step targets the SAME frame as the first (only one frame is created per state).

**Commit**: `feat(figma-plugin): add orchestrator that maps design plan to shim calls`

---

## TIER 4 — Plugin UI (manual QA only)

### P5-D4 — React UI: two-pane plan + log + connect dialog
**Depends on:** P5-D3
**Complexity:** L (mostly UI work)

**What to build**

`figma-plugin/ui/App.tsx`:

- On mount: read connection URL from Figma `clientStorage`. If absent, show ConnectDialog.
- ConnectDialog: input for `ws://localhost:<port>?token=<...>` URL, Connect button. Stores in clientStorage on success.
- Once connected: call `tools/call kotikit_spec_list` and show a screen picker (a `<select>` listing scope+screen pairs).
- On screen pick: call `tools/call kotikit_design_get_screen`. Render the plan steps in the left pane as a checklist. Each row has its kind + a one-line summary + Run button. The header has a Run All button.
- Right pane: status log. Each `applyStep` call pushes a row.
- When the user clicks Run on a step: call the orchestrator's `applyStep` with the real Figma shim, then `kotikit_design_apply_step` over the bridge to record the outcome.
- When the user clicks Run All: orchestrator.applyAll, streaming results to the right pane and to the apply-step tool.

This is the most UI-heavy part of Phase 5. Don't over-engineer styling — minimal CSS, functional, readable. The plugin runs in Figma's plugin iframe (about 400px wide is typical).

`figma-plugin/src/bridge-client.ts`:

```ts
export class BridgeClient {
  private ws: WebSocket;
  private nextId: number = 1;
  private pending: Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (evt) => { /* JSON-RPC response handling */ };
  }

  async listTools(): Promise<{ name: string; description: string }[]>;
  async callTool(name: string, args: unknown): Promise<unknown>;

  close(): void;
}
```

**Acceptance criteria**
- Plugin builds: `bun run plugin:build` succeeds.
- Manual smoke checklist in §6 passes when run against a real Figma file.
- No `bun test` requirement for the UI itself (it's React in a Figma iframe; out of CI scope per the testing decision in §0).

**Commit**: `feat(figma-plugin): add React UI with plan checklist and bridge client`

---

## TIER 5 — Wire + E2E

### P5-E1 — Wire MCP tools + bridge into server.ts
**Depends on:** P5-B3, P5-C1, P5-C2, P5-C3
**Complexity:** M

**What to build**

Edit `src/mcp/server.ts`:

1. Register the three new tools (`registerPlanDesignTools`, `registerDesignScreenTools` — or combine into one registrar for clarity).
2. Update the "registers all" test assertion: count goes from 21 → 24 (plus three new names: `kotikit_plan_design`, `kotikit_design_get_screen`, `kotikit_design_apply_step`).
3. Add bridge startup logic to `startServer()`:
   - Check `process.env.KOTIKIT_BRIDGE === "1"` OR CLI arg `--bridge`.
   - If enabled: pick a free port (try 53124 first, then increment), generate a bridge token, build `BridgeConfig`, write to `bridge.json`, call `startBridgeServer(...)`.
   - Print to stderr: `[kotikit] Bridge running at ws://localhost:<port>?token=<token>\n[kotikit] Copy that URL into the kotikit Figma plugin's Connect dialog.`
   - On process exit (SIGINT, SIGTERM): `clearBridgeConfig` and close the bridge gracefully.
4. Add a new `package.json` script: `"bridge": "KOTIKIT_BRIDGE=1 bun run src/mcp/server.ts"`.

The bridge startup is OPT-IN; without the env var or flag, the server behaves identically to Phases 1-4.

**Acceptance criteria**
- `bun test src/mcp/server.test.ts`: "registers all" assertion lists 24 tools including the 3 new Phase 5 names.
- `bun x tsc --noEmit` clean.
- New test (in server.test.ts or a new bridge-server-integration.test.ts) confirms:
  - `startServer()` without `KOTIKIT_BRIDGE` does NOT start the bridge.
  - With `KOTIKIT_BRIDGE=1`, the bridge starts and writes `bridge.json`.
- Manual verification: `bun run bridge` starts and prints the connect URL.

**Commit**: `feat(mcp): wire phase 5 tools and opt-in WebSocket bridge`

---

### P5-E2 — End-to-end test: spec → plan → get → apply
**Depends on:** P5-E1
**Complexity:** M

**What to build**

`test/e2e/phase5.test.ts` — drives the design track in-process (no Figma plugin involved):

1. Create a screen spec via `kotikit_spec_create`.
2. Call `kotikit_plan_design({scope})` — assert the design plan file appears with the right structure.
3. Call `kotikit_design_get_screen({scope})` — assert the response carries plan + spec + (empty) dsComponents + (empty) skipped.
4. Simulate the plugin applying steps: call `kotikit_design_apply_step` for each step index — assert the apply log accumulates one line per call.
5. Bridge: start a bridge server with a `FAKE_BRIDGE_TOKEN`, connect a WebSocket client with that token, call `tools/list` over WS → confirm Phase 5 tool names appear. Close the bridge cleanly.

**Acceptance criteria**
- `bun test test/e2e/phase5.test.ts` — all 5 sub-scenarios pass.
- Full `bun test` suite stays green (~530+ tests).
- `bun x tsc --noEmit` clean.

**Commit**: `test(e2e): add phase 5 design plan + bridge smoke test`

---

## 2. Definition of Done for Phase 5

- [ ] `bun install`, `bun x tsc --noEmit`, and `bun test` all pass.
- [ ] `bun run src/mcp/server.ts` (default mode) behaves identically to Phase 4.
- [ ] `bun run bridge` starts the server with the WebSocket bridge, writes `.kotikit/bridge.json`, and prints the connect URL to stderr.
- [ ] `cd figma-plugin && bun install && bun run build` produces loadable plugin artifacts.
- [ ] The manifest installs in Figma (manual smoke checklist passes — see §6).
- [ ] 3 new MCP tools registered (`kotikit_plan_design`, `kotikit_design_get_screen`, `kotikit_design_apply_step`), bringing total tools to 24.
- [ ] One-way sync only: editing in Figma never changes `.kotikit/specs/`.
- [ ] `.kotikit/bridge.json` and `figma-plugin/dist/` are in `.gitignore`.
- [ ] Each task lands as one atomic commit with `feat(<scope>): <summary>` + the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer.

## 3. Parallelization summary

- **Wave 1 (3 agents):** A1, A2, A3 — independent foundations.
- **Wave 2 (3 agents):** B1, B2, B3 — engines.
- **Wave 3 (3 agents):** C1, C2, C3 — MCP tools.
- **Wave 4 (3 agents):** D1, D2, D3 — Figma plugin (D2 needs D1; D3 needs D2).
- **Wave 5 (1 agent):** D4 — Figma plugin UI (large, single agent).
- **Wave 6 (1 agent):** E1 — wire.
- **Wave 7 (1 agent):** E2 — proof.

Realistic timing: A1-C3 (server-side + planner) ships in 1 week of agent work. D1-D4 (plugin) is the second week and bigger, mostly UI assembly. The manual smoke checklist gates the close.

## 4. Atomic commit discipline

Same rules as Phases 1-4:

- One task = one commit.
- Subject `feat(<scope>): <imperative summary>`, under 72 chars.
- Body explains the WHY in 2-3 sentences.
- Footer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` (mandatory).
- No `--no-verify`. No amending.
- Tests + typecheck must pass before each commit.
- The full suite must stay green at every commit.

## 5. Out of scope (Phase 5)

Be ruthlessly explicit about these so reviewers don't ask:

- **Code → Figma reverse generation** (already deferred to V2+).
- **Bidirectional sync** (Figma edits → specs). One-way only in Phase 5.
- **Multi-project bridge selection** (one bridge = one project). Phase 6+ if real demand surfaces.
- **Flow-level prototype connections** (no inter-screen wiring in Figma). One plan per screen, period.
- **Design-side quality gates.** There's no `tsc` for Figma. Phase 5 has no equivalent of the §7 quality bar — design correctness is the designer's judgment.
- **Component variant resolution beyond `defaultKey`.** The plugin places the default variant; the designer picks variants in Figma after placement.
- **Variable binding for nested/scoped collections.** Only top-level matching by name. Property targeting via `nodeNameHint` is deferred.
- **Brainstorm conversation inside the plugin.** VS Code Claude Code remains the conversational surface.
- **Auto-installing the bridge as a system service** (launchd/systemd). Designer runs `bun run bridge` manually.
- **Authentication beyond per-session token.** No OAuth, no SSO. Localhost-only binding.
- **Real-time collaboration / multiple plugins / multiple Figma files at once.** Single user, single Figma file per session.
- **Figma plugin marketplace publishing.** Plugin is dev-mode only in Phase 5.
- **Drift audit between Figma instances and DS snapshot.** Phase 6.
- **Test framework / Playwright for the plugin UI.** Manual QA only — §6.

## 6. Manual smoke checklist (Phase 5 sign-off ritual)

Run these AFTER `bun test` is green to confirm the plugin works in Figma:

**Prep:**
1. Open a Figma file (any file you can scribble in).
2. In a kotikit-initialized project, run `bun run bridge`. Confirm a URL is printed.
3. Open the kotikit Figma plugin (Plugins → Development → kotikit). Paste the connect URL. Confirm connection.

**Acceptance scenarios:**

| # | Action | Expected result |
|---|---|---|
| 1 | Pick a screen with no DS components (e.g. a freshly-brainstormed scope) | Plugin shows the step list (state frames + auto-layout only); Run All creates the frames on a new page |
| 2 | Pick a screen with 3 DS components whose dsKeys exist in the linked Figma DS file | Run All produces a page with state frames, each containing 3 instances stacked vertically |
| 3 | Pick a screen with a missing dsKey | The Run All log shows ⚠ for that step; other steps still execute |
| 4 | Re-run Run All on the same screen | Second run replaces (or appends to — document which) the existing frames; no orphan duplicates |
| 5 | Click Run on one individual step | Only that step executes; status log shows one new entry |

If any of these fail, file as Phase 5 follow-up bugs before merging.
