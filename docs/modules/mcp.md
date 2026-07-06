# MCP

## What it does

The mcp module is the boundary between kotikit's engines and the AI model. It owns the MCP server process (stdio transport, used by Claude Code, Codex, and other MCP clients), the optional WebSocket bridge (used by the Figma plugin), the `ToolRegistry` pattern that all tool registrars write to, and the `ToolContext` that every tool handler receives. It registers the shared MCP tool set and routes `tools/list` and `tools/call` requests from both transports through a single shared handler map.

## Public surface

**Server build and start** (`src/mcp/server.ts`)
- `ToolRegistry` — `{ tools: Tool[], handlers: Map<string, Handler> }` — the shared accumulator every `register*` function writes to
- `buildServer()` — construct the MCP `Server` with `KOTIKIT_MCP_INSTRUCTIONS`, populate the registry by calling all `register*` functions, wire `ListToolsRequestSchema` and `CallToolRequestSchema` handlers; returns `{ server, registry }`
- `startServer()` — call `buildServer`, connect stdio transport, optionally start the bridge
- `KOTIKIT_MCP_INSTRUCTIONS` (`src/mcp/instructions.ts`) — concise server-level guidance that MCP clients can read during initialization

**Tool context** (`src/mcp/context.ts`)
- `ToolContext` — `{ root: string, loadConfig: () => Promise<Config | null> }` — passed to every tool registrar at startup

**WebSocket bridge** (`src/mcp/bridge/server.ts`, `src/mcp/bridge/token.ts`)
- `startBridgeServer({ registry, config, onReady? })` — bind a localhost WebSocket server on the configured port; authenticate via per-session token; route `tools/list` and `tools/call` JSON-RPC calls through the shared `ToolRegistry`
- `BridgeServer` — `{ close(): Promise<void> }`
- `BridgeConfig` — `{ version: 1, port, token, projectRoot, projectName, startedAt }`
- `generateBridgeToken()` — produce a 12-character lowercase-hex token from `crypto.randomUUID()`
- `writeBridgeConfig(root, cfg)` — atomic write (`.tmp` + rename) to `.kotikit/bridge.json`
- `readBridgeConfig(root)` — read and validate; returns `null` on missing or malformed
- `clearBridgeConfig(root)` — remove `bridge.json` on server shutdown
- `createBridgeManager({ registry, root })` — own the bridge lifecycle for the current MCP process, including plugin preflight, manifest port patching, idempotent start, port fallback, status, stop, and stale config cleanup

**Tool registrars** (each in `src/mcp/tools/<name>.ts` or
`src/mcp/facade/<name>.ts`)

See [docs/tools.md](../tools.md) for the complete cheat-sheet. The tools are
grouped here by product area:

- Graph facade: `kotikit_flow_list`, `kotikit_flow_validate`,
  `kotikit_start`, `kotikit_answer`, `kotikit_continue`,
  `kotikit_bind_figma_target`, `kotikit_get_artifact`,
  `kotikit_list_artifacts`, `kotikit_search_design_system`,
  `kotikit_feedback_snapshot`, `kotikit_prepare_figma_write`,
  `kotikit_record_figma_apply`, and `kotikit_doctor`.
- Setup: `kotikit_config_status`, `kotikit_config_init`,
  `kotikit_config_get`.
- Local design-system support: `kotikit_sync_ds`,
  `kotikit_sync_plugin_variables`, `kotikit_ds_search`,
  `kotikit_ds_get_component`, and `kotikit_icons_search`.
- Local plugin bridge and prompt support: `kotikit_bridge_start`,
  `kotikit_bridge_stop`, `kotikit_bridge_status`, and
  `kotikit_get_system_prompt`.

Design-to-code tools are not registered in the core MCP server. Code planning,
implementation, scaffold, registry, and code/design audit flows can return
later only as isolated extensions after the design workflow is stable.

## How it works

`buildServer` is the single composition root. It constructs one `ToolRegistry` object, finds the project root via `findProjectRoot()`, builds a `ToolContext`, then calls each `register*` function with both. Each registrar pushes one or more `Tool` objects (the MCP JSON Schema description) onto `registry.tools` and one handler function per tool onto `registry.handlers`. The server's `CallToolRequestSchema` handler is a single dispatcher: it looks up the tool name in `handlers`, calls the handler, and lets `toolError` convert any thrown error into a safe MCP error response.

The server also exposes `KOTIKIT_MCP_INSTRUCTIONS` during MCP initialization.
These instructions are agent-neutral and front-load the graph facade: choose a
flow, start it, answer human-in-the-loop prompts, continue when external work
is complete, read artifacts by id, translate tool JSON into plain language,
fetch long system prompts by reference, search design-system indexes before
reading exact files, keep user-facing errors friendly, and keep kotikit focused
on design creation.

The stdio transport is the normal agent path. Claude Code, Codex, and other
MCP clients use it for setup, sync, graph flow execution, and official Figma
apply coordination. The WebSocket bridge reuses the same handler map, but it is
reserved for the local Figma plugin's variable-export fallback. Graph runs
store compact current state, checkpoints, and artifacts rather than a manual
workflow history.

Figma design creation is fail-closed around explicit draft targets. The agent
first binds the exact draft page or frame URL through
`kotikit_bind_figma_target` with `pageUrl` on the active graph run. Kotikit
resolves copied node URLs to their containing page, stores the canonical draft
target and Section name, and reports the resolved page identity back to the
agent. The graph validates the page target, requires a page name containing
`Draft` or `Drafts`, and writes generated nodes inside a kotikit-owned Section.
Draft creation then drains an incremental Figma transaction queue: before each
official Figma MCP write, the agent prepares the active transaction with
`kotikit_prepare_figma_write`, confirms the returned file key, page id, page
name, and Section, applies one screen state or region state at a time with
`use_figma`, records metadata with `kotikit_record_figma_apply` and the
preflight id, and continues the graph. Screen and region records include a
compact `evidenceSnapshot` scanned from actual Figma nodes so existing
design-system reuse is proved by visible instances whose keys came from the
pre-run local design-system search.
`kotikit_record_figma_apply` records official Figma MCP apply metadata back into
the run only when the preflight id, file, page, and Section match the bound
target. Graph QA nodes then validate component, component source, variable,
icon, layout, repeated-item, text-transform, transaction, placement, and
canvas-overlap metadata.

The bridge binds to `127.0.0.1` only and requires a per-session token on the WebSocket upgrade URL query string. It exists for the variable-only Figma plugin fallback; design creation, review, and comment handling do not use this transport. When the bridge starts, it writes `BridgeConfig` to `.kotikit/bridge.json` atomically; on SIGINT/SIGTERM it removes that file so a stale config cannot mislead a future session.

The bridge transport is opt-in and can be started in two ways. Normal users ask their assistant to call `kotikit_bridge_start`, which prepares the Figma plugin build if needed, patches `figma-plugin/manifest.json` to the selected localhost port, starts the bridge inside the already-running MCP process, and returns the pasteable `ws://localhost:...?...` URL. Developers can still set `KOTIKIT_BRIDGE=1` or pass `--bridge` when starting the server manually. The preferred port is 53124; if that port is in use, the bridge manager increments up to 50 times before giving up. The actual bound port is written into `BridgeConfig`.

## When to extend it

- Adding a new tool — create `src/mcp/tools/<name>.ts`, implement a `register<Name>Tools(registry, ctx)` function following the existing pattern, import and call it in `buildServer`. Update the tool count assertion in `server.test.ts`.
- Supporting a third transport (e.g. HTTP SSE) — implement a new server using `registry.handlers` for dispatch; the handlers are transport-agnostic.
- Adding per-tool authorization — wrap handler lookups in `buildServer`'s `CallToolRequestSchema` handler with a permission check before calling the handler function.
- Extending `ToolContext` with a new shared dependency — add the field to the interface in `context.ts` and update `buildServer` to populate it; all registrars receive it automatically.
- Updating the bridge token length or format — edit `generateBridgeToken` in `bridge/token.ts`; the `BridgeConfigSchema` validates `token: z.string().min(12)`.

## Related

- [config](./config.md) — `ToolContext.loadConfig` wraps `loadConfig` from the config module
- [util](./util.md) — `findProjectRoot` is called at server startup; `bridgeConfigPath` is the bridge config path helper
- [spec](./spec.md), [sync](./sync.md), [planning](./planning.md), [db](./db.md), [git](./git.md) — module engines are invoked from tool handler functions
- [tools](../tools.md) — complete MCP tool cheat-sheet
