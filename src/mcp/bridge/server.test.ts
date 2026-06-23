import { afterEach, describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "../server.js";
import { type BridgeServer, startBridgeServer } from "./server.js";

let activeBridge: BridgeServer | null = null;

afterEach(async () => {
  if (activeBridge) {
    await activeBridge.close();
    activeBridge = null;
  }
  // Brief delay so port is released before the next test binds
  await new Promise((r) => setTimeout(r, 50));
});

function makeRegistry(): ToolRegistry {
  const tools: Tool[] = [
    {
      name: "test_echo",
      description: "Echoes the input.",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      },
    },
    {
      name: "test_fail",
      description: "Throws.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
  const handlers = new Map<
    string,
    (args: unknown) => Promise<{ content: { type: "text"; text: string }[] }>
  >();
  handlers.set("test_echo", async (args: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: `echo: ${(args as { msg?: string })?.msg ?? ""}`,
      },
    ],
  }));
  handlers.set("test_fail", async () => {
    throw new Error("boom");
  });
  return { tools, handlers: handlers as ToolRegistry["handlers"] };
}

let nextPort = 54000 + Math.floor(Math.random() * 4000);

const isPortInUse = (err: unknown): boolean => (err as { code?: string }).code === "EADDRINUSE";

function startTestBridge(input: {
  registry: ToolRegistry;
  token?: string;
  onReady?: (info: { url: string }) => void;
}): { bridge: BridgeServer; port: number; token: string } {
  const token = input.token ?? "tok123456789abc";
  const candidates = Array.from({ length: 50 }, (_, index) => nextPort + index);
  nextPort += candidates.length;

  for (const port of candidates) {
    try {
      const bridge = startBridgeServer({
        registry: input.registry,
        config: configFor(port, token),
        ...(input.onReady !== undefined ? { onReady: input.onReady } : {}),
      });
      return { bridge, port, token };
    } catch (err) {
      if (!isPortInUse(err)) throw err;
    }
  }

  throw new Error("Could not allocate a bridge test port.");
}

function configFor(port: number, token: string = "tok123456789abc") {
  return {
    version: 1 as const,
    port,
    token,
    projectRoot: "/tmp/proj",
    projectName: "proj",
    startedAt: "2026-05-29T00:00:00.000Z",
  };
}

async function callRpc(
  url: string,
  method: string,
  params?: unknown,
  id: number = 1
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout"));
    }, 3000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    };
    ws.onmessage = (evt) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(evt.data as string));
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    };
  });
}

describe("startBridgeServer", () => {
  it("tools/list returns registered tool names", async () => {
    const { bridge, port, token } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    const reply = await callRpc(`ws://127.0.0.1:${port}?token=${token}`, "tools/list");
    const result = (reply as { result: { tools: Tool[] } }).result;
    expect(result.tools.map((t) => t.name).sort()).toEqual(["test_echo", "test_fail"]);
  });

  it("tools/call returns the handler result", async () => {
    const { bridge, port, token } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    const reply = await callRpc(`ws://127.0.0.1:${port}?token=${token}`, "tools/call", {
      name: "test_echo",
      arguments: { msg: "hi" },
    });
    const result = (reply as { result: { content: { type: string; text: string }[] } }).result;
    expect(result.content[0]?.text).toBe("echo: hi");
  });

  it("connect with invalid token is rejected with HTTP 403", async () => {
    const { bridge, port } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    // Use fetch to test the upgrade rejection
    const res = await fetch(`http://127.0.0.1:${port}/?token=wrong`, {
      headers: { upgrade: "websocket" },
    });
    expect(res.status).toBe(403);
  });

  it("GET /handshake works without auth", async () => {
    const { bridge, port } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    const res = await fetch(`http://127.0.0.1:${port}/handshake`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projectName: string };
    expect(body.projectName).toBe("proj");
  });

  it("calling an unknown tool returns a JSON-RPC error response", async () => {
    const { bridge, port, token } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    const reply = await callRpc(`ws://127.0.0.1:${port}?token=${token}`, "tools/call", {
      name: "does_not_exist",
      arguments: {},
    });
    expect((reply as { error?: { message: string } }).error).toBeDefined();
    expect((reply as { error: { message: string } }).error.message).toContain("Unknown tool");
  });

  it("calling a tool that throws returns a JSON-RPC error response (no crash)", async () => {
    const { bridge, port, token } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    const reply = await callRpc(`ws://127.0.0.1:${port}?token=${token}`, "tools/call", {
      name: "test_fail",
      arguments: {},
    });
    expect((reply as { error?: { message: string } }).error).toBeDefined();
    expect((reply as { error: { message: string } }).error.message).toContain("boom");
  });

  it("close() releases the port", async () => {
    const { bridge, port } = startTestBridge({ registry: makeRegistry() });
    await bridge.close();
    // Wait a tick for port release
    await new Promise((r) => setTimeout(r, 100));
    // Should be able to bind again
    const bridge2 = startBridgeServer({
      registry: makeRegistry(),
      config: configFor(port),
    });
    await bridge2.close();
    activeBridge = null;
  });

  it("onReady is called with the connect URL", async () => {
    const token = "tok123456789abc";
    let captured = "";
    const { bridge, port } = startTestBridge({
      registry: makeRegistry(),
      token,
      onReady: (info) => {
        captured = info.url;
      },
    });
    activeBridge = bridge;
    expect(captured).toBe(`ws://localhost:${port}?token=${token}`);
  });

  it("invalid JSON message yields a JSON-RPC parse error", async () => {
    const { bridge, port, token } = startTestBridge({ registry: makeRegistry() });
    activeBridge = bridge;
    const reply = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`);
      ws.onopen = () => ws.send("not valid json {{{");
      ws.onmessage = (evt) => {
        ws.close();
        resolve(JSON.parse(evt.data as string));
      };
      ws.onerror = () => reject(new Error("ws err"));
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
    expect((reply as { error?: { code: number } }).error?.code).toBe(-32700);
  });
});
