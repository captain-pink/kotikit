import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const designSystemDir = (root: string): string => `${root}/design-system`;

export const componentsDbPath = (root: string): string => `${root}/design-system/components.db`;

export const iconsDbPath = (root: string): string => `${root}/design-system/icons.db`;

export const variablesJsonPath = (root: string): string => `${root}/design-system/variables.json`;

export const manifestPath = (root: string): string => `${root}/design-system/manifest.json`;

export const componentJsonPath = (root: string, slug: string): string =>
  `${root}/design-system/components/${slug}.json`;

export const checkpointPath = (root: string): string =>
  `${root}/design-system/.sync-checkpoint.json`;

export const syncReportPath = (root: string): string => `${root}/design-system/.sync-report.json`;

export const configPath = (root: string): string => `${root}/.kotikit/config.json`;

/** Path to the bridge config file written when the bridge starts. */
export const bridgeConfigPath = (root: string): string => `${root}/.kotikit/bridge.json`;

/**
 * Walk up from `start` (default: process.cwd()) looking for a directory
 * that contains a `.kotikit` folder. Returns that directory if found,
 * otherwise returns the original start directory.
 */
export const findProjectRoot = (start?: string): string => {
  const initial = start ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let current = resolve(initial);
  while (true) {
    if (existsSync(`${current}/.kotikit`)) return current;
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }
  return resolve(initial);
};
