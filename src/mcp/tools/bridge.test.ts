import { describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import type { BridgeManager } from "../bridge/manager.js";
import { registerBridgeTools } from "./bridge.js";

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const callTool = async (registry: ToolRegistry, name: string, args: unknown) => {
  const handler = registry.handlers.get(name);
  if (handler === undefined) throw new Error(`missing handler ${name}`);
  return handler(args);
};

function makeBridgeManager(): BridgeManager {
  let running = false;
  return {
    async start() {
      running = true;
      return {
        running: true,
        staleConfig: false,
        port: 53124,
        url: "ws://localhost:53124?token=tok123456789",
        projectName: "Project",
        projectRoot: "/tmp/project",
        startedAt: "2026-06-20T00:00:00.000Z",
      };
    },
    async stop() {
      const stopped = running;
      running = false;
      return { stopped, clearedConfig: true };
    },
    async status() {
      return running
        ? {
            running: true,
            staleConfig: false,
            port: 53124,
            url: "ws://localhost:53124?token=tok123456789",
            projectName: "Project",
            projectRoot: "/tmp/project",
            startedAt: "2026-06-20T00:00:00.000Z",
          }
        : {
            running: false,
            staleConfig: false,
            projectName: "Project",
            projectRoot: "/tmp/project",
          };
    },
  };
}

describe("bridge tools", () => {
  it("registers start, stop, and status tools", () => {
    const registry = makeRegistry();
    const ctx: ToolContext = { root: "/tmp/project", loadConfig: async () => null, bridge: makeBridgeManager() };

    registerBridgeTools(registry, ctx);

    expect(registry.tools.map((tool) => tool.name)).toEqual([
      "kotikit_bridge_start",
      "kotikit_bridge_stop",
      "kotikit_bridge_status",
    ]);
  });

  it("starts the bridge and returns the plugin URL", async () => {
    const registry = makeRegistry();
    const ctx: ToolContext = { root: "/tmp/project", loadConfig: async () => null, bridge: makeBridgeManager() };
    registerBridgeTools(registry, ctx);

    const result = await callTool(registry, "kotikit_bridge_start", {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Figma plugin bridge is running");
    expect(result.content[0]?.text).toContain("ws://localhost:53124?token=tok123456789");
  });

  it("stops the bridge and reports cleanup", async () => {
    const registry = makeRegistry();
    const bridge = makeBridgeManager();
    const ctx: ToolContext = { root: "/tmp/project", loadConfig: async () => null, bridge };
    registerBridgeTools(registry, ctx);

    await callTool(registry, "kotikit_bridge_start", {});
    const result = await callTool(registry, "kotikit_bridge_stop", {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Figma plugin bridge stopped");
  });

  it("returns a friendly error when bridge control is unavailable", async () => {
    const registry = makeRegistry();
    const ctx: ToolContext = { root: "/tmp/project", loadConfig: async () => null };
    registerBridgeTools(registry, ctx);

    const result = await callTool(registry, "kotikit_bridge_start", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Bridge control is not available");
  });
});
