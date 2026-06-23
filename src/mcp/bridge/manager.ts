import { basename } from "path";
import { nowIso } from "../../util/ids.js";
import type { ToolRegistry } from "../server.js";
import {
  defaultPluginRoot,
  type PreparePluginBuildResult,
  patchPluginManifestAllowedDomains,
  preparePluginBuild,
} from "./plugin-preflight.js";
import { type BridgeOpts, type BridgeServer, startBridgeServer } from "./server.js";
import {
  type BridgeConfig,
  clearBridgeConfig,
  generateBridgeToken,
  readBridgeConfig,
  writeBridgeConfig,
} from "./token.js";

export interface BridgeStatus {
  running: boolean;
  staleConfig: boolean;
  projectRoot: string;
  projectName: string;
  port?: number;
  url?: string;
  startedAt?: string;
  setupWarning?: string;
}

export interface BridgeStopResult {
  stopped: boolean;
  clearedConfig: boolean;
}

export interface BridgeManager {
  start(input?: { preferredPort?: number }): Promise<BridgeStatus>;
  stop(): Promise<BridgeStopResult>;
  status(): Promise<BridgeStatus>;
}

interface ActiveBridge {
  config: BridgeConfig;
  server: BridgeServer;
  setupWarning?: string;
}

interface BridgeManagerDeps {
  nowIso: () => string;
  generateToken: () => string;
  startBridgeServer: (opts: BridgeOpts) => BridgeServer;
  writeBridgeConfig: (root: string, config: BridgeConfig) => Promise<void>;
  readBridgeConfig: (root: string) => Promise<BridgeConfig | null>;
  clearBridgeConfig: (root: string) => Promise<void>;
  preparePluginBuild: (pluginRoot: string) => Promise<PreparePluginBuildResult>;
  patchPluginManifestAllowedDomains: (pluginRoot: string, port: number) => Promise<string[]>;
}

export interface CreateBridgeManagerInput {
  registry: ToolRegistry;
  root: string;
  projectName?: string;
  pluginRoot?: string;
  portRange?: number;
  deps?: Partial<BridgeManagerDeps>;
}

const DEFAULT_BRIDGE_PORT = 53124;
const DEFAULT_PORT_RANGE = 50;

export const bridgeUrlForConfig = (config: Pick<BridgeConfig, "port" | "token">): string =>
  `ws://localhost:${config.port}?token=${config.token}`;

const statusForActive = (active: ActiveBridge): BridgeStatus => ({
  running: true,
  staleConfig: false,
  projectRoot: active.config.projectRoot,
  projectName: active.config.projectName,
  port: active.config.port,
  url: bridgeUrlForConfig(active.config),
  startedAt: active.config.startedAt,
  ...(active.setupWarning ? { setupWarning: active.setupWarning } : {}),
});

const inactiveStatus = (root: string, projectName: string): BridgeStatus => ({
  running: false,
  staleConfig: false,
  projectRoot: root,
  projectName,
});

export function createBridgeManager(input: CreateBridgeManagerInput): BridgeManager {
  const projectName = input.projectName ?? basename(input.root);
  const pluginRoot = input.pluginRoot ?? defaultPluginRoot();
  const portRange = input.portRange ?? DEFAULT_PORT_RANGE;
  const deps: BridgeManagerDeps = {
    nowIso,
    generateToken: generateBridgeToken,
    startBridgeServer,
    writeBridgeConfig,
    readBridgeConfig,
    clearBridgeConfig,
    preparePluginBuild,
    patchPluginManifestAllowedDomains,
    ...input.deps,
  };
  let active: ActiveBridge | null = null;

  return {
    async start(startInput = {}): Promise<BridgeStatus> {
      if (active !== null) return statusForActive(active);

      const pluginSetup = await deps.preparePluginBuild(pluginRoot);
      const preferredPort = startInput.preferredPort ?? DEFAULT_BRIDGE_PORT;
      const ports = Array.from({ length: portRange }, (_, index) => preferredPort + index);
      for (const port of ports) {
        const config: BridgeConfig = {
          version: 1,
          port,
          token: deps.generateToken(),
          projectRoot: input.root,
          projectName,
          startedAt: deps.nowIso(),
        };
        let server: BridgeServer;
        try {
          server = deps.startBridgeServer({ registry: input.registry, config });
        } catch {
          continue;
        }

        try {
          await deps.patchPluginManifestAllowedDomains(pluginRoot, config.port);
          await deps.writeBridgeConfig(input.root, config);
        } catch (err) {
          await server.close().catch(() => {});
          throw err;
        }

        active = { config, server, setupWarning: pluginSetup.warning };
        return statusForActive(active);
      }

      throw new Error(
        `Could not bind bridge: ports ${preferredPort}-${preferredPort + portRange - 1} all in use.`
      );
    },

    async stop(): Promise<BridgeStopResult> {
      const hadActiveBridge = active !== null;
      const stale = hadActiveBridge ? null : await deps.readBridgeConfig(input.root);
      if (hadActiveBridge && active !== null) {
        const server = active.server;
        active = null;
        await server.close();
      }
      await deps.clearBridgeConfig(input.root);
      return {
        stopped: hadActiveBridge,
        clearedConfig: hadActiveBridge || stale !== null,
      };
    },

    async status(): Promise<BridgeStatus> {
      if (active !== null) return statusForActive(active);
      const stale = await deps.readBridgeConfig(input.root);
      if (stale === null) return inactiveStatus(input.root, projectName);
      return {
        running: false,
        staleConfig: true,
        projectRoot: stale.projectRoot,
        projectName: stale.projectName,
        port: stale.port,
        startedAt: stale.startedAt,
      };
    },
  };
}
