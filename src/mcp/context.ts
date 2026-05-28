import type { Config } from "../config/schema.js";

export interface ToolContext {
  root: string;
  loadConfig: () => Promise<Config | null>;
}
