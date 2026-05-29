import type { ToolRegistry } from "../server.js";
import type { BridgeConfig } from "./token.js";
import {
  BridgeRequestSchema,
  type BridgeResponse,
  RPC_PARSE_ERROR,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_INTERNAL_ERROR,
} from "./protocol.js";

export interface BridgeOpts {
  registry: ToolRegistry;
  config: BridgeConfig;
  onReady?: (info: { url: string }) => void;
}

export interface BridgeServer {
  close(): Promise<void>;
}

interface WsData {
  authenticated: boolean;
}

/**
 * Start a localhost WebSocket server speaking JSON-RPC,
 * routing tools/list and tools/call through the shared ToolRegistry.
 *
 * Binds to 127.0.0.1 only.
 * Requires a valid per-session token on the WebSocket upgrade request.
 * The /handshake endpoint is public (no auth) for plugin discovery.
 */
export function startBridgeServer(opts: BridgeOpts): BridgeServer {
  const { registry, config, onReady } = opts;

  const server: Bun.Server<WsData> = Bun.serve<WsData>({
    hostname: "127.0.0.1",
    port: config.port,
    async fetch(req, server) {
      const url = new URL(req.url);
      const reqToken = url.searchParams.get("token");

      // Public handshake endpoint — no auth required.
      if (url.pathname === "/handshake" && req.method === "GET") {
        return new Response(
          JSON.stringify({
            version: 1,
            projectName: config.projectName,
            projectRoot: config.projectRoot,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // WebSocket upgrade — require valid token before upgrade.
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (reqToken !== config.token) {
          return new Response("Forbidden", { status: 403 });
        }
        const upgraded = server.upgrade(req, {
          data: { authenticated: true },
        });
        if (upgraded) return undefined;
        return new Response("Upgrade failed", { status: 500 });
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(_ws) {
        // No-op; client speaks first.
      },
      async message(ws, raw) {
        let req;
        try {
          const parsed = JSON.parse(
            typeof raw === "string" ? raw : raw.toString(),
          );
          const parsedReq = BridgeRequestSchema.safeParse(parsed);
          if (!parsedReq.success) {
            ws.send(
              JSON.stringify(
                rpcError(null, RPC_INVALID_REQUEST, "Invalid request shape."),
              ),
            );
            return;
          }
          req = parsedReq.data;
        } catch {
          ws.send(
            JSON.stringify(rpcError(null, RPC_PARSE_ERROR, "Parse error.")),
          );
          return;
        }

        try {
          switch (req.method) {
            case "tools/list": {
              const reply: BridgeResponse = {
                jsonrpc: "2.0",
                id: req.id,
                result: { tools: registry.tools },
              };
              ws.send(JSON.stringify(reply));
              return;
            }
            case "tools/call": {
              const params = req.params as
                | { name?: string; arguments?: unknown }
                | undefined;
              const name = params?.name;
              if (!name) {
                ws.send(
                  JSON.stringify(
                    rpcError(
                      req.id,
                      RPC_INVALID_REQUEST,
                      "Missing tool name.",
                    ),
                  ),
                );
                return;
              }
              const handler = registry.handlers.get(name);
              if (!handler) {
                ws.send(
                  JSON.stringify(
                    rpcError(
                      req.id,
                      RPC_METHOD_NOT_FOUND,
                      `Unknown tool: ${name}`,
                    ),
                  ),
                );
                return;
              }
              const result = await handler(params?.arguments ?? {});
              const reply: BridgeResponse = {
                jsonrpc: "2.0",
                id: req.id,
                result,
              };
              ws.send(JSON.stringify(reply));
              return;
            }
            default:
              ws.send(
                JSON.stringify(
                  rpcError(
                    req.id,
                    RPC_METHOD_NOT_FOUND,
                    `Unknown method: ${req.method}`,
                  ),
                ),
              );
          }
        } catch (err) {
          ws.send(
            JSON.stringify(
              rpcError(req.id, RPC_INTERNAL_ERROR, (err as Error).message),
            ),
          );
        }
      },
      close(_ws, _code, _reason) {
        // No-op.
      },
    },
  });

  onReady?.({ url: `ws://localhost:${config.port}?token=${config.token}` });

  return {
    async close(): Promise<void> {
      server.stop(true);
    },
  };
}

function rpcError(
  id: number | string | null,
  code: number,
  message: string,
): BridgeResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
