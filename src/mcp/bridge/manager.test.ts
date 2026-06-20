import { describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createBridgeManager, bridgeUrlForConfig } from "./manager.js";
import type { BridgeConfig } from "./token.js";
import type { BridgeServer } from "./server.js";
import type { ToolRegistry } from "../server.js";

const registry = (): ToolRegistry => ({
  tools: [] as Tool[],
  handlers: new Map(),
});

const root = "/tmp/kotikit-project";

function fakeServer(closed: string[]): BridgeServer {
  return {
    async close(): Promise<void> {
      closed.push("closed");
    },
  };
}

describe("bridge manager", () => {
  it("starts a bridge, writes config, and returns the pasteable URL", async () => {
    const written: BridgeConfig[] = [];
    const manager = createBridgeManager({
      registry: registry(),
      root,
      projectName: "Project",
      deps: {
        nowIso: () => "2026-06-20T00:00:00.000Z",
        generateToken: () => "tok123456789",
        startBridgeServer: ({ config }) => fakeServer([`server:${config.port}`]),
        writeBridgeConfig: async (_root, config) => { written.push(config); },
        clearBridgeConfig: async () => {},
        readBridgeConfig: async () => null,
      },
    });

    const result = await manager.start({ preferredPort: 53124 });

    expect(result.running).toBe(true);
    expect(result.port).toBe(53124);
    expect(result.url).toBe("ws://localhost:53124?token=tok123456789");
    expect(written[0]).toMatchObject({
      port: 53124,
      token: "tok123456789",
      projectRoot: root,
      projectName: "Project",
    });
  });

  it("is idempotent when start is called twice in the same process", async () => {
    let starts = 0;
    const manager = createBridgeManager({
      registry: registry(),
      root,
      projectName: "Project",
      deps: {
        nowIso: () => "2026-06-20T00:00:00.000Z",
        generateToken: () => `tok${++starts}23456789`,
        startBridgeServer: () => fakeServer([]),
        writeBridgeConfig: async () => {},
        clearBridgeConfig: async () => {},
        readBridgeConfig: async () => null,
      },
    });

    const first = await manager.start({ preferredPort: 53124 });
    const second = await manager.start({ preferredPort: 53125 });

    expect(starts).toBe(1);
    expect(second).toEqual(first);
  });

  it("tries the next port when the preferred port is unavailable", async () => {
    const ports: number[] = [];
    const manager = createBridgeManager({
      registry: registry(),
      root,
      projectName: "Project",
      deps: {
        nowIso: () => "2026-06-20T00:00:00.000Z",
        generateToken: () => "tok123456789",
        startBridgeServer: ({ config }) => {
          ports.push(config.port);
          if (config.port === 53124) throw new Error("in use");
          return fakeServer([]);
        },
        writeBridgeConfig: async () => {},
        clearBridgeConfig: async () => {},
        readBridgeConfig: async () => null,
      },
    });

    const result = await manager.start({ preferredPort: 53124 });

    expect(ports).toEqual([53124, 53125]);
    expect(result.port).toBe(53125);
  });

  it("stops the active bridge and clears the bridge config", async () => {
    const closed: string[] = [];
    let cleared = 0;
    const manager = createBridgeManager({
      registry: registry(),
      root,
      projectName: "Project",
      deps: {
        nowIso: () => "2026-06-20T00:00:00.000Z",
        generateToken: () => "tok123456789",
        startBridgeServer: () => fakeServer(closed),
        writeBridgeConfig: async () => {},
        clearBridgeConfig: async () => { cleared += 1; },
        readBridgeConfig: async () => null,
      },
    });

    await manager.start();
    const result = await manager.stop();

    expect(result.stopped).toBe(true);
    expect(result.clearedConfig).toBe(true);
    expect(closed).toEqual(["closed"]);
    expect(cleared).toBe(1);
  });

  it("reports stale bridge config when no in-process bridge is active", async () => {
    const manager = createBridgeManager({
      registry: registry(),
      root,
      projectName: "Project",
      deps: {
        nowIso: () => "2026-06-20T00:00:00.000Z",
        generateToken: () => "tok123456789",
        startBridgeServer: () => fakeServer([]),
        writeBridgeConfig: async () => {},
        clearBridgeConfig: async () => {},
        readBridgeConfig: async () => ({
          version: 1,
          port: 53124,
          token: "tok123456789",
          projectRoot: root,
          projectName: "Project",
          startedAt: "2026-06-20T00:00:00.000Z",
        }),
      },
    });

    const status = await manager.status();

    expect(status.running).toBe(false);
    expect(status.staleConfig).toBe(true);
    expect(status.port).toBe(53124);
  });

  it("builds bridge URLs from config", () => {
    expect(bridgeUrlForConfig({
      version: 1,
      port: 53124,
      token: "tok123456789",
      projectRoot: root,
      projectName: "Project",
      startedAt: "2026-06-20T00:00:00.000Z",
    })).toBe("ws://localhost:53124?token=tok123456789");
  });
});
