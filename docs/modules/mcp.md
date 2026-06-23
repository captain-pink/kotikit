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

**Tool registrars** (each in `src/mcp/tools/<name>.ts`)

See [docs/tools.md](../tools.md) for the complete cheat-sheet. The tools are
grouped here by product area:

- Setup and specs: `kotikit_config_status`, `kotikit_config_init`, `kotikit_config_get`, `kotikit_spec_create`, `kotikit_spec_get`, `kotikit_spec_list`, `kotikit_spec_update`, `kotikit_flow_create`, `kotikit_brainstorm_start`, `kotikit_brainstorm_answer`, `kotikit_brainstorm_confirm`, `kotikit_brainstorm_assess`
- Design-system sync and search: `kotikit_sync_ds`, `kotikit_sync_plugin_variables`, `kotikit_ds_search`, `kotikit_ds_get_component`, `kotikit_icons_search`
- Experimental implementation: `kotikit_plan_code`, `kotikit_implement_code_start`, `kotikit_implement_code_save`, `kotikit_implement_code_gate`, `kotikit_registry_search`, `kotikit_scaffold_start`, `kotikit_scaffold_save`
- Figma bridge and design creation: `kotikit_bridge_start`, `kotikit_bridge_stop`, `kotikit_bridge_status`, `kotikit_figma_target_bind`, `kotikit_component_plan_create`, `kotikit_plan_design`, `kotikit_design_get_screen`, `kotikit_design_apply_step`
- Design review, comments, and memory: `kotikit_design_review_comments`, `kotikit_design_adjustment_record`, `kotikit_design_review_report`, `kotikit_design_comment_reply_prepare`, `kotikit_design_comment_reply_post`, `kotikit_design_memory_candidates`, `kotikit_design_memory_promote`, `kotikit_design_memory_dismiss`, `kotikit_design_memory_update`, `kotikit_design_memory_search`, `kotikit_design_review_start`, `kotikit_design_review_record`, `kotikit_design_review_get`, `kotikit_design_review_comment_prepare`, `kotikit_design_review_comment_post`
- Audit, prompts, and diagnostics: `kotikit_audit`, `kotikit_get_system_prompt`, `kotikit_doctor`

Implementation and scaffolding tools are currently experimental. They stay
registered so engineering work can continue, but guided designer flows should
prefer specs, design-system sync, Figma design creation/refinement, and comment
review.

## How it works

`buildServer` is the single composition root. It constructs one `ToolRegistry` object, finds the project root via `findProjectRoot()`, builds a `ToolContext`, then calls each `register*` function with both. Each registrar pushes one or more `Tool` objects (the MCP JSON Schema description) onto `registry.tools` and one handler function per tool onto `registry.handlers`. The server's `CallToolRequestSchema` handler is a single dispatcher: it looks up the tool name in `handlers`, calls the handler, and lets `toolError` convert any thrown error into a safe MCP error response.

The server also exposes `KOTIKIT_MCP_INSTRUCTIONS` during MCP initialization. These instructions are agent-neutral and front-load the workflow: translate tool JSON into plain language, fetch long system prompts by reference, search design-system indexes before reading exact files, keep user-facing errors friendly, and treat kotikit as design-first until design-to-code returns in a later version.

The stdio transport and the WebSocket bridge share the identical handler map. The bridge's `tools/call` JSON-RPC handler looks up the tool name in `registry.handlers` and calls it with the parsed arguments, exactly as the stdio dispatcher does. This means every feature automatically works in stdio MCP clients such as Claude Code and Codex, and in the Figma plugin bridge, without duplication. Browserless Figma comment review uses the same path: `kotikit_design_review_comments` reads comments through the REST API, maps them through the local node map written by apply-step results, and stores compact review state in `.kotikit/design-review.db`. Standalone design-quality review uses `kotikit_design_review_start` to gather bounded shallow Figma evidence, then stores agent-authored findings and optional approved root comments in the same review DB.

Figma design creation is fail-closed around explicit draft targets. The agent first calls `kotikit_figma_target_bind` with the designer's exact Figma draft page URL. The tool verifies the URL points to a page node, the page name contains `Draft` or `Drafts`, and the target is saved in the screen spec or flow manifest. `kotikit_plan_design` refuses to build a plugin plan until that target exists. The plugin then switches to the bound page and creates or reuses a kotikit-owned Section for the generated screen; `kotikit_design_apply_step` validates reported file, page, and Section metadata before updating comment-review maps.

The bridge binds to `127.0.0.1` only and requires a per-session token on the WebSocket upgrade URL query string. The `/handshake` endpoint is unauthenticated and returns project metadata so the Figma plugin can display the connected project name before asking for a token. When the bridge starts, it writes `BridgeConfig` to `.kotikit/bridge.json` atomically; on SIGINT/SIGTERM it removes that file so a stale config cannot mislead a future session.

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
- [spec](./spec.md), [sync](./sync.md), [codegen](./codegen.md), [planning](./planning.md), [db](./db.md), [git](./git.md) — all module engines are invoked from tool handler functions
- [tools](../tools.md) — complete MCP tool cheat-sheet
