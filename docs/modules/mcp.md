# MCP

## What it does

The mcp module is the boundary between kotikit's engines and the AI model. It owns the MCP server process (stdio transport, used by Claude Code), the optional WebSocket bridge (used by the Figma plugin), the `ToolRegistry` pattern that all tool registrars write to, and the `ToolContext` that every tool handler receives. It registers all 26 tools and routes `tools/list` and `tools/call` requests from both transports through a single shared handler map.

## Public surface

**Server build and start** (`src/mcp/server.ts`)
- `ToolRegistry` — `{ tools: Tool[], handlers: Map<string, Handler> }` — the shared accumulator every `register*` function writes to
- `buildServer()` — construct the MCP `Server`, populate the registry by calling all `register*` functions, wire `ListToolsRequestSchema` and `CallToolRequestSchema` handlers; returns `{ server, registry }`
- `startServer()` — call `buildServer`, connect stdio transport, optionally start the bridge

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

**Tool registrars** (each in `src/mcp/tools/<name>.ts`)

See [docs/tools.md](../tools.md) for the complete cheat-sheet. The 26 tools are grouped here by phase:

- Phase 1: `kotikit_config_status`, `kotikit_config_init`, `kotikit_spec_create`, `kotikit_spec_update`, `kotikit_spec_list`, `kotikit_flow_create`, `kotikit_brainstorm_start`, `kotikit_brainstorm_assess`
- Phase 2: `kotikit_sync_ds`, `kotikit_ds_search`, `kotikit_ds_get_component`, `kotikit_icons_search`
- Phase 3: `kotikit_plan_code`, `kotikit_implement_code_start`, `kotikit_implement_code_gate`
- Phase 4: `kotikit_registry_status`, `kotikit_scaffold_start`, `kotikit_scaffold_commit`
- Phase 5: `kotikit_plan_design`, `kotikit_design_get_screen`, `kotikit_design_apply`, `kotikit_design_commit`, `kotikit_bridge_status`
- Phase 6: `kotikit_audit`, `kotikit_get_system_prompt`

## How it works

`buildServer` is the single composition root. It constructs one `ToolRegistry` object, finds the project root via `findProjectRoot()`, builds a `ToolContext`, then calls each `register*` function with both. Each registrar pushes one or more `Tool` objects (the MCP JSON Schema description) onto `registry.tools` and one handler function per tool onto `registry.handlers`. The server's `CallToolRequestSchema` handler is a single dispatcher: it looks up the tool name in `handlers`, calls the handler, and lets `toolError` convert any thrown error into a safe MCP error response.

The stdio transport and the WebSocket bridge share the identical handler map. The bridge's `tools/call` JSON-RPC handler looks up the tool name in `registry.handlers` and calls it with the parsed arguments, exactly as the stdio dispatcher does. This means every feature automatically works both in Claude Code (stdio) and in the Figma plugin (bridge) without any duplication.

The bridge binds to `127.0.0.1` only and requires a per-session token on the WebSocket upgrade URL query string. The `/handshake` endpoint is unauthenticated and returns project metadata so the Figma plugin can display the connected project name before asking for a token. When the bridge starts, it writes `BridgeConfig` to `.kotikit/bridge.json` atomically; on SIGINT/SIGTERM it removes that file so a stale config cannot mislead a future session.

The bridge transport is opt-in: set `KOTIKIT_BRIDGE=1` or pass `--bridge` when starting the server (`bun run bridge`). The preferred port is 53124; if that port is in use, `tryStartBridge` increments up to 50 times before giving up. The actual bound port is written into `BridgeConfig` so the Figma plugin can discover it by reading the config file.

## When to extend it

- Adding a new tool — create `src/mcp/tools/<name>.ts`, implement a `register<Name>Tools(registry, ctx)` function following the existing pattern, import and call it in `buildServer`. Update the tool count assertion in `server.test.ts`.
- Supporting a third transport (e.g. HTTP SSE) — implement a new server using `registry.handlers` for dispatch; the handlers are transport-agnostic.
- Adding per-tool authorization — wrap handler lookups in `buildServer`'s `CallToolRequestSchema` handler with a permission check before calling the handler function.
- Extending `ToolContext` with a new shared dependency — add the field to the interface in `context.ts` and update `buildServer` to populate it; all registrars receive it automatically.
- Updating the bridge token length or format — edit `generateBridgeToken` in `bridge/token.ts`; the `BridgeConfigSchema` validates `token: z.string().min(12)`.

## Related

- [config](./config.md) — `ToolContext.loadConfig` wraps `loadConfig` from the config module
- [util](./util.md) — `findProjectRoot` is called at server startup; `bridgeConfigPath` is the bridge config path helper
- [spec](./spec.md), [sync](./sync.md), [codegen](./codegen.md), [planning](./planning.md), [db](./db.md), [git](./git.md) — all module engines are invoked from tool handler functions
- `docs/tools.md` — complete cheat-sheet for all 26 MCP tools
- `planning/phase-1.md` — MCP server architecture and ToolRegistry pattern
- `planning/phase-5.md` — bridge design, token gating, Figma plugin connection protocol
- `planning/phase-6.md` §P6-B1, §P6-B2 — `kotikit_audit` and `kotikit_get_system_prompt` wiring
