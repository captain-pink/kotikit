import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { type ComponentSearchResult, searchComponents } from "../../../db/components-db.js";
import { getIconSvg, type IconSearchResult, searchIcons } from "../../../db/icons-db.js";
import { type ComponentJson, ComponentJsonSchema } from "../../../sync/component-shape.js";
import {
  type VariableEntry,
  VariableEntrySchema,
  VariablesJsonSchema,
} from "../../../sync/variables.js";
import {
  componentsDbPath,
  designSystemDir,
  iconsDbPath,
  variablesJsonPath,
} from "../../../util/paths.js";
import { KotikitError } from "../../../util/result.js";

export type LocalCacheSetupAction = {
  message: string;
  tool: "kotikit_sync_ds";
  hint: string;
};

export type LocalAdapterReady<T> = {
  status: "ready";
  source: "local-cache";
  results: T[];
};

export type LocalAdapterNeedsSync<T> = {
  status: "needs-sync";
  source: "local-cache";
  results: T[];
  setupAction: LocalCacheSetupAction;
};

export type LocalAdapterResult<T> = LocalAdapterReady<T> | LocalAdapterNeedsSync<T>;

export type LocalComponentRef = Pick<ComponentSearchResult, "name" | "path" | "key" | "fileKey">;

export type LocalIconRef = IconSearchResult & {
  svg?: string;
};

export type LocalDesignSystemContext = {
  status: "ready" | "needs-sync";
  source: "local-cache";
  componentsAvailable: boolean;
  iconsAvailable: boolean;
  variablesAvailable: boolean;
  setupAction?: LocalCacheSetupAction;
};

const DEFAULT_COMPONENT_LIMIT = 25;
const DEFAULT_ICON_LIMIT = 50;

export function searchLocalComponents(
  root: string,
  query: string,
  options: { limit?: number } = {}
): LocalAdapterResult<LocalComponentRef> {
  const cache = localComponentCacheStatus(root);
  if (cache.status === "needs-sync") return { ...cache, results: [] };

  const db = new Database(componentsDbPath(root), { readonly: true });
  try {
    const results = searchComponents(db, query, options.limit ?? DEFAULT_COMPONENT_LIMIT).map(
      compactComponentRef
    );
    return { status: "ready", source: "local-cache", results };
  } finally {
    db.close();
  }
}

export function getLocalComponent(root: string, ref: string): ComponentJson {
  assertSafeDesignSystemPath(ref);
  const path = `${designSystemDir(root)}/${ref}`;
  if (!existsSync(path)) {
    throw new KotikitError(
      "I could not find that component in the local design-system cache.",
      "Use kotikit_search_design_system to find a component ref, then read that exact path."
    );
  }
  return ComponentJsonSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}

export function searchLocalIcons(
  root: string,
  query: string,
  options: { limit?: number; includeSvg?: boolean } = {}
): LocalAdapterResult<LocalIconRef> {
  const cache = localIconCacheStatus(root);
  if (cache.status === "needs-sync") return { ...cache, results: [] };

  const db = new Database(iconsDbPath(root), { readonly: true });
  try {
    const rows = searchIcons(db, query, options.limit ?? DEFAULT_ICON_LIMIT);
    const results =
      options.includeSvg === true
        ? rows.map((row) => ({
            ...row,
            svg: getIconSvg(db, row.name) ?? undefined,
          }))
        : rows;
    return { status: "ready", source: "local-cache", results };
  } finally {
    db.close();
  }
}

export function getLocalVariables(
  root: string,
  options: { kind?: VariableEntry["kind"] } = {}
):
  | { status: "ready"; source: "local-cache"; entries: VariableEntry[] }
  | LocalAdapterNeedsSync<never> {
  if (!existsSync(variablesJsonPath(root))) {
    return {
      status: "needs-sync",
      source: "local-cache",
      results: [],
      setupAction: {
        message: "Your design-system variables have not been synced yet.",
        tool: "kotikit_sync_ds",
        hint: "Sync variables into design-system/variables.json before building variable-bound drafts.",
      },
    };
  }

  const variables = VariablesJsonSchema.parse(
    JSON.parse(readFileSync(variablesJsonPath(root), "utf-8"))
  );
  const entries =
    options.kind === undefined
      ? variables.entries
      : variables.entries.filter((entry) => entry.kind === options.kind);
  return {
    status: "ready",
    source: "local-cache",
    entries: entries.map((entry) => VariableEntrySchema.parse(entry)),
  };
}

export function buildLocalDesignSystemContext(root: string): LocalDesignSystemContext {
  const componentsAvailable =
    existsSync(designSystemDir(root)) && existsSync(componentsDbPath(root));
  const iconsAvailable = existsSync(designSystemDir(root)) && existsSync(iconsDbPath(root));
  const variablesAvailable = existsSync(variablesJsonPath(root));

  if (!componentsAvailable) {
    return {
      status: "needs-sync",
      source: "local-cache",
      componentsAvailable,
      iconsAvailable,
      variablesAvailable,
      setupAction: componentSetupAction(),
    };
  }

  return {
    status: "ready",
    source: "local-cache",
    componentsAvailable,
    iconsAvailable,
    variablesAvailable,
  };
}

function localComponentCacheStatus(
  root: string
): { status: "ready"; source: "local-cache" } | LocalAdapterNeedsSync<never> {
  if (existsSync(designSystemDir(root)) && existsSync(componentsDbPath(root))) {
    return { status: "ready", source: "local-cache" };
  }
  return {
    status: "needs-sync",
    source: "local-cache",
    results: [],
    setupAction: componentSetupAction(),
  };
}

function localIconCacheStatus(
  root: string
): { status: "ready"; source: "local-cache" } | LocalAdapterNeedsSync<never> {
  if (existsSync(designSystemDir(root)) && existsSync(iconsDbPath(root))) {
    return { status: "ready", source: "local-cache" };
  }
  return {
    status: "needs-sync",
    source: "local-cache",
    results: [],
    setupAction: {
      message: "Your design-system icons have not been synced yet.",
      tool: "kotikit_sync_ds",
      hint: "Sync the Figma design-system file to create design-system/icons.db.",
    },
  };
}

function componentSetupAction(): LocalCacheSetupAction {
  return {
    message: "Your design system has not been synced yet.",
    tool: "kotikit_sync_ds",
    hint: "Sync the Figma design-system file to create design-system/components.db.",
  };
}

function compactComponentRef(row: ComponentSearchResult): LocalComponentRef {
  return {
    name: row.name,
    path: row.path,
    key: row.key,
    fileKey: row.fileKey,
  };
}

function assertSafeDesignSystemPath(path: string): void {
  if (path.includes("..") || path.startsWith("/")) {
    throw new KotikitError(
      "That design-system path looks unsafe.",
      'Use a relative path returned by kotikit_search_design_system, for example "components/button.json".'
    );
  }
}
