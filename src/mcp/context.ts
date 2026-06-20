import type { Config } from "../config/schema.js";
import type { BridgeManager } from "./bridge/manager.js";

export interface ToolContext {
  root: string;
  loadConfig: () => Promise<Config | null>;
  bridge?: BridgeManager;
}
