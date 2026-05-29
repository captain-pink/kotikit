import { existsSync } from "fs";
import { resolve, dirname } from "path";

export const KOTIKIT_DIR = ".kotikit";

export const DESIGN_SYSTEM_DIR = "design-system";

export const designSystemDir = (root: string): string =>
  `${root}/design-system`;

export const componentsDbPath = (root: string): string =>
  `${root}/design-system/components.db`;

export const iconsDbPath = (root: string): string =>
  `${root}/design-system/icons.db`;

export const variablesJsonPath = (root: string): string =>
  `${root}/design-system/variables.json`;

export const manifestPath = (root: string): string =>
  `${root}/design-system/manifest.json`;

export const componentJsonPath = (root: string, slug: string): string =>
  `${root}/design-system/components/${slug}.json`;

export const checkpointPath = (root: string): string =>
  `${root}/design-system/.sync-checkpoint.json`;

export const syncReportPath = (root: string): string =>
  `${root}/design-system/.sync-report.json`;

export const configPath = (root: string): string =>
  `${root}/.kotikit/config.json`;

export const indexPath = (root: string): string =>
  `${root}/.kotikit/index.json`;

export const scopeDir = (root: string, scope: string): string =>
  `${root}/.kotikit/specs/${scope}`;

export const screenSpecPath = (
  root: string,
  scope: string,
  screenSlug: string
): string => `${root}/.kotikit/specs/${scope}/${screenSlug}.spec.json`;

export const singleSpecPath = (root: string, scope: string): string =>
  `${root}/.kotikit/specs/${scope}/spec.json`;

export const flowManifestPath = (root: string, scope: string): string =>
  `${root}/.kotikit/specs/${scope}/flow.json`;

/** Path to a screen's ephemeral code plan inside .kotikit/specs/<scope>/. */
export const codePlanPath = (
  root: string,
  scope: string,
  screenSlug: string | null
): string => {
  const name = screenSlug ? `${screenSlug}.code.plan.json` : "code.plan.json";
  return `${root}/.kotikit/specs/${scope}/${name}`;
};

/** Path to the Phase 3 minimal registry DB. */
export const registryDbPath = (root: string): string =>
  `${root}/.kotikit/registry.db`;

/** Directory under the user's project that holds generated screen components for a scope. */
export const codeComponentDir = (
  root: string,
  codeComponentsDir: string,
  scope: string
): string => `${root}/${codeComponentsDir}/${scope}`;

/** Full path to a generated component file. */
export const codeComponentFile = (
  root: string,
  codeComponentsDir: string,
  scope: string,
  fileName: string
): string => `${root}/${codeComponentsDir}/${scope}/${fileName}`;

/** The directory where scaffolded DS components land: <codeComponentsDir>/ui/. */
export const uiDir = (root: string, codeComponentsDir: string): string =>
  `${root}/${codeComponentsDir}/ui`;

/** Full path to a scaffolded component file: <codeComponentsDir>/ui/<kebab-name>.tsx. */
export const uiComponentFile = (
  root: string,
  codeComponentsDir: string,
  kebabName: string
): string => `${root}/${codeComponentsDir}/ui/${kebabName}.tsx`;

/** Full path to a colocated Storybook story: <codeComponentsDir>/ui/<kebab-name>.stories.tsx. */
export const uiStoryFile = (
  root: string,
  codeComponentsDir: string,
  kebabName: string
): string => `${root}/${codeComponentsDir}/ui/${kebabName}.stories.tsx`;

/**
 * Walk up from `start` (default: process.cwd()) looking for a directory
 * that contains a `.kotikit` folder. Returns that directory if found,
 * otherwise returns the original start directory.
 */
export const findProjectRoot = (start?: string): string => {
  let current = resolve(start ?? process.cwd());
  while (true) {
    if (existsSync(`${current}/.kotikit`)) return current;
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }
  return resolve(start ?? process.cwd());
};
