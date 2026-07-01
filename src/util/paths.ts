import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const KOTIKIT_DIR = ".kotikit";

export const DESIGN_SYSTEM_DIR = "design-system";

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

export const indexPath = (root: string): string => `${root}/.kotikit/index.json`;

export const scopeDir = (root: string, scope: string): string => `${root}/.kotikit/specs/${scope}`;

export const screenSpecPath = (root: string, scope: string, screenSlug: string): string =>
  `${root}/.kotikit/specs/${scope}/${screenSlug}.spec.json`;

export const singleSpecPath = (root: string, scope: string): string =>
  `${root}/.kotikit/specs/${scope}/spec.json`;

export const flowManifestPath = (root: string, scope: string): string =>
  `${root}/.kotikit/specs/${scope}/flow.json`;

/** Path to <screen>.design.plan.json next to the spec.
 *  Single-screen scope (screen === null) → design.plan.json.
 *  Multi-screen → <screen>.design.plan.json. */
export const designPlanPath = (root: string, scope: string, screen: string | null): string => {
  const name = screen ? `${screen}.design.plan.json` : "design.plan.json";
  return `${root}/.kotikit/specs/${scope}/${name}`;
};

/** Path to the per-screen apply log (JSONL). */
export const designApplyLogPath = (root: string, scope: string, screen: string | null): string => {
  const name = screen ? `${screen}.design.apply.log` : "design.apply.log";
  return `${root}/.kotikit/specs/${scope}/${name}`;
};

/** Path to the per-screen Figma node map used to match review comments. */
export const designNodeMapPath = (root: string, scope: string, screen: string | null): string => {
  const name = screen ? `${screen}.design.node-map.json` : "design.node-map.json";
  return `${root}/.kotikit/specs/${scope}/${name}`;
};

/** Path to the bridge config file written when the bridge starts. */
export const bridgeConfigPath = (root: string): string => `${root}/.kotikit/bridge.json`;

/** Path to the local design review ledger and project design preferences DB. */
export const designReviewDbPath = (root: string): string => `${root}/.kotikit/design-review.db`;

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
