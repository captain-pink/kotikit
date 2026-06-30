import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { KotikitError } from "../../util/result.js";
import { computeStableHash } from "../graph/graph-hash.js";
import { type FlowDefinition, FlowDefinitionSchema } from "../schemas/flow-definition.js";

const BUILT_IN_FLOW_FILES = [
  "first-run.flow.json",
  "create-screen.flow.json",
  "create-product-flow.flow.json",
  "improve-existing-design.flow.json",
  "review-comments.flow.json",
  "sync-design-system.flow.json",
  "resolve-missing-components.flow.json",
];

export type FlowCatalogConfig = {
  projectFlows?: {
    enabled?: boolean;
    directory?: string;
  };
  extensionFlows?: {
    directory?: string;
    allowlist?: ExtensionFlowAllowlistEntry[];
  };
};

export type ExtensionFlowAllowlistEntry = {
  id: string;
  source: string;
  version?: string;
  ref?: string;
  hash: string;
  capabilities: string[];
};

export async function loadBuiltInFlows(): Promise<FlowDefinition[]> {
  const flows = await Promise.all(
    BUILT_IN_FLOW_FILES.map((fileName) =>
      readFlowFile(new URL(`./built-in/${fileName}`, import.meta.url))
    )
  );
  assertUniqueFlowIds(flows);
  return flows;
}

export async function loadProjectFlows(
  root: string,
  config: FlowCatalogConfig
): Promise<FlowDefinition[]> {
  if (config.projectFlows?.enabled !== true) return [];
  return readFlowDirectory(config.projectFlows.directory ?? join(root, ".kotikit", "flows"));
}

export async function loadExtensionFlows(
  root: string,
  config: FlowCatalogConfig
): Promise<FlowDefinition[]> {
  const flows = await readFlowDirectory(
    config.extensionFlows?.directory ?? join(root, ".kotikit", "extensions", "flows")
  );
  if (flows.length === 0) return [];
  return flows.map((flow) => validateExtensionFlow(flow, config.extensionFlows?.allowlist ?? []));
}

export async function loadFlowCatalog(
  root: string,
  config: FlowCatalogConfig
): Promise<FlowDefinition[]> {
  const flows = [
    ...(await loadBuiltInFlows()),
    ...(await loadProjectFlows(root, config)),
    ...(await loadExtensionFlows(root, config)),
  ];
  assertUniqueFlowIds(flows);
  return flows;
}

async function readFlowDirectory(directory: string): Promise<FlowDefinition[]> {
  try {
    const entries = (await readdir(directory))
      .filter((entry) => entry.endsWith(".flow.json"))
      .sort();
    const flows = await Promise.all(entries.map((entry) => readFlowFile(join(directory, entry))));
    assertUniqueFlowIds(flows);
    return flows;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

async function readFlowFile(path: string | URL): Promise<FlowDefinition> {
  try {
    return FlowDefinitionSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new KotikitError(
        "This kotikit flow manifest contains invalid JSON.",
        "Fix the .flow.json file before enabling this flow."
      );
    }
    if (err instanceof z.ZodError) {
      throw new KotikitError(
        "This kotikit flow manifest has an invalid shape.",
        "Check the flow schema version, nodes, edges, start, end, and required capabilities."
      );
    }
    throw err;
  }
}

function validateExtensionFlow(
  flow: FlowDefinition,
  allowlist: ExtensionFlowAllowlistEntry[]
): FlowDefinition {
  const entry = allowlist.find((candidate) => candidate.id === flow.id);
  if (entry === undefined) {
    throw new KotikitError(
      `Extension flow "${flow.id}" is not allowlisted.`,
      "Add a project allowlist entry with source, version or ref, hash, and declared capabilities."
    );
  }
  if (
    entry.source.length === 0 ||
    entry.hash.length === 0 ||
    ((entry.version === undefined || entry.version.length === 0) &&
      (entry.ref === undefined || entry.ref.length === 0)) ||
    entry.capabilities.length === 0 ||
    entry.capabilities.some((capability) => capability.length === 0)
  ) {
    throw new KotikitError(
      `Extension flow "${flow.id}" has an incomplete allowlist entry.`,
      "Extension flow allowlists must include source, version or ref, hash, and declared capabilities."
    );
  }
  if (entry.hash !== computeStableHash(flow)) {
    throw new KotikitError(
      `Extension flow "${flow.id}" does not match its allowlisted hash.`,
      "Review the extension flow manifest before updating the allowlist hash."
    );
  }
  const forbiddenCapabilities = flow.requiredCapabilities.filter(
    (capability) => !entry.capabilities.includes(capability)
  );
  if (forbiddenCapabilities.length > 0) {
    throw new KotikitError(
      `Extension flow "${flow.id}" requires capabilities outside its allowlist: ${forbiddenCapabilities.join(
        ", "
      )}.`,
      "Only allow capabilities the project explicitly trusts for this extension flow."
    );
  }
  return flow;
}

function assertUniqueFlowIds(flows: FlowDefinition[]): void {
  const seen = new Set<string>();
  flows.forEach((flow) => {
    if (seen.has(flow.id)) {
      throw new KotikitError(
        `Flow "${flow.id}" is defined more than once.`,
        "Flow ids must be unique across built-in, project, and extension flows."
      );
    }
    seen.add(flow.id);
  });
}
