import type { z } from "zod";
import { KotikitError } from "../../util/result.js";

export type NodeKind = "deterministic" | "llm" | "interrupt" | "external-action" | "subgraph";

export type NodeSideEffect =
  | "none"
  | "filesystem"
  | "sqlite"
  | "figma-read"
  | "figma-write"
  | "comments-write";

export type NodeRunnerInput = {
  nodeId: string;
  params: unknown;
  state: unknown;
};

export type NodeRunner = (input: NodeRunnerInput) => Promise<unknown>;

export type NodeDefinition = {
  key: string;
  version: string;
  kind: NodeKind;
  paramsSchema: z.ZodType;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  stateReads: string[];
  stateWrites: string[];
  sideEffects: NodeSideEffect;
  requiredCapabilities: string[];
  run: NodeRunner;
};

export type NodeRegistry = {
  get(key: string): NodeDefinition;
  has(key: string): boolean;
  list(): NodeDefinition[];
};

export function createNodeRegistry(definitions: NodeDefinition[]): NodeRegistry {
  const nodes = new Map<string, NodeDefinition>();

  definitions.forEach((definition) => {
    if (nodes.has(definition.key)) {
      throw new KotikitError(
        `Node "${definition.key}" is registered more than once.`,
        "Each graph node key must be unique across the kotikit node registry."
      );
    }
    nodes.set(definition.key, definition);
  });

  return {
    get(key: string): NodeDefinition {
      const definition = nodes.get(key);
      if (definition === undefined) {
        throw new KotikitError(
          `Unknown kotikit graph node: ${key}.`,
          "Check the flow manifest uses only nodes shipped by this kotikit version."
        );
      }
      return definition;
    },
    has(key: string): boolean {
      return nodes.has(key);
    },
    list(): NodeDefinition[] {
      return Array.from(nodes.values());
    },
  };
}
