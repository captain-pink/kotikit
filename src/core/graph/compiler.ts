import { z } from "zod";
import { KotikitError } from "../../util/result.js";
import {
  type FlowDefinition,
  FlowDefinitionSchema,
  type FlowNode,
} from "../schemas/flow-definition.js";
import { KOTIKIT_GRAPH_STATE_SCHEMA_VERSION } from "../schemas/graph-state.js";
import type { NodeDefinition, NodeRegistry } from "./node-registry.js";

export type FlowCompilePolicy = {
  allowedCapabilities: string[];
};

export type ResolvedFlowNode = {
  id: string;
  manifest: FlowNode;
  definition: NodeDefinition;
};

export type GraphHashInput = {
  flowId: string;
  flowVersion: string;
  stateSchemaVersion: string;
  safetyProfile: string;
  manifest: FlowDefinition;
  nodeVersions: Record<string, string>;
};

export type CompiledFlowDefinition = {
  flow: FlowDefinition;
  nodes: ResolvedFlowNode[];
  edges: FlowDefinition["edges"];
  start: string;
  end: string[];
  nodeVersions: Record<string, string>;
  graphHashInput: GraphHashInput;
  capabilities: string[];
  safetyProfile: string;
};

export function validateFlowDefinition(
  definition: FlowDefinition,
  registry: NodeRegistry,
  policy: FlowCompilePolicy
): CompiledFlowDefinition {
  const flow = parseFlowDefinition(definition);
  const nodeIds = new Set<string>();

  flow.nodes.forEach((node) => {
    if (nodeIds.has(node.id)) {
      throw new KotikitError(
        `Flow "${flow.id}" defines node "${node.id}" more than once.`,
        "Every node id in a flow manifest must be unique."
      );
    }
    nodeIds.add(node.id);
  });

  if (!nodeIds.has(flow.start)) {
    throw new KotikitError(
      `Flow "${flow.id}" starts at unknown node "${flow.start}".`,
      "Set start to one of the node ids declared in the flow manifest."
    );
  }

  flow.end.forEach((nodeId) => {
    if (!nodeIds.has(nodeId)) {
      throw new KotikitError(
        `Flow "${flow.id}" ends at unknown node "${nodeId}".`,
        "Every end node must be declared in the flow manifest."
      );
    }
  });

  flow.edges.forEach(([source, target]) => {
    if (!nodeIds.has(source)) {
      throw new KotikitError(
        `Flow "${flow.id}" has an edge from unknown node "${source}".`,
        "Every edge source must be declared in the flow manifest."
      );
    }
    if (!nodeIds.has(target)) {
      throw new KotikitError(
        `Flow "${flow.id}" has an edge to unknown node "${target}".`,
        "Every edge target must be declared in the flow manifest."
      );
    }
  });

  const resolvedNodes = flow.nodes.map((node) => {
    const definition = registry.get(node.uses);
    try {
      definition.paramsSchema.parse(node.params ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new KotikitError(
          `Flow "${flow.id}" has invalid params for node "${node.id}".`,
          "Check that this node's params match the schema declared by kotikit."
        );
      }
      throw err;
    }
    return { id: node.id, manifest: node, definition };
  });

  const nodesWithUndeclaredSideEffects = resolvedNodes.filter(
    ({ definition }) =>
      definition.sideEffects !== "none" && definition.requiredCapabilities.length === 0
  );
  if (nodesWithUndeclaredSideEffects.length > 0) {
    throw new KotikitError(
      `Flow "${flow.id}" uses side-effecting nodes without declared capabilities: ${nodesWithUndeclaredSideEffects
        .map(({ id }) => id)
        .join(", ")}.`,
      "Every filesystem, database, Figma, or comment-writing node must declare at least one explicit capability."
    );
  }

  const requiredCapabilities = collectCapabilities(flow, resolvedNodes);
  const forbiddenCapabilities = requiredCapabilities.filter(
    (capability) => !policy.allowedCapabilities.includes(capability)
  );

  if (forbiddenCapabilities.length > 0) {
    throw new KotikitError(
      `Flow "${flow.id}" requires capabilities that are not allowed: ${forbiddenCapabilities.join(
        ", "
      )}.`,
      "Enable the required capabilities in the flow policy or choose a safer flow."
    );
  }

  const reachable = reachableNodeIds(flow);
  const unreachable = flow.nodes.map((node) => node.id).filter((nodeId) => !reachable.has(nodeId));
  if (unreachable.length > 0) {
    throw new KotikitError(
      `Flow "${flow.id}" has unreachable nodes: ${unreachable.join(", ")}.`,
      "Connect every node to the start node or remove it from the manifest."
    );
  }

  const cycle = findCycle(flow);
  if (cycle.length > 0) {
    throw new KotikitError(
      `Flow "${flow.id}" contains a cycle: ${cycle.join(" -> ")}.`,
      "Remove the cycle or model repetition as an explicit runtime node before compiling the flow."
    );
  }

  const nodesWithOutgoingEdges = new Set(flow.edges.map(([source]) => source));
  const nonTerminalEndNodes = flow.end.filter((nodeId) => nodesWithOutgoingEdges.has(nodeId));
  if (nonTerminalEndNodes.length > 0) {
    throw new KotikitError(
      `Flow "${flow.id}" lists non-terminal end nodes: ${nonTerminalEndNodes.join(", ")}.`,
      "Only nodes with no outgoing edges can be listed in the flow manifest end array."
    );
  }

  const terminalNodes = terminalNodeIds(flow);
  const undeclaredTerminalNodes = Array.from(terminalNodes).filter(
    (nodeId) => !flow.end.includes(nodeId)
  );
  if (undeclaredTerminalNodes.length > 0) {
    throw new KotikitError(
      `Flow "${flow.id}" has terminal nodes not listed in end: ${undeclaredTerminalNodes.join(
        ", "
      )}.`,
      "List every terminal node in the flow manifest end array."
    );
  }

  const nodeVersions = Object.fromEntries(
    resolvedNodes.map(({ definition }) => [definition.key, definition.version])
  );

  return {
    flow,
    nodes: resolvedNodes,
    edges: flow.edges,
    start: flow.start,
    end: flow.end,
    nodeVersions,
    graphHashInput: {
      flowId: flow.id,
      flowVersion: flow.version,
      stateSchemaVersion: KOTIKIT_GRAPH_STATE_SCHEMA_VERSION,
      safetyProfile: flow.safetyProfile,
      manifest: flow,
      nodeVersions,
    },
    capabilities: requiredCapabilities,
    safetyProfile: flow.safetyProfile,
  };
}

export function compileFlowDefinition(
  definition: FlowDefinition,
  registry: NodeRegistry,
  policy: FlowCompilePolicy
): CompiledFlowDefinition {
  return validateFlowDefinition(definition, registry, policy);
}

function parseFlowDefinition(definition: FlowDefinition): FlowDefinition {
  try {
    return FlowDefinitionSchema.parse(definition);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new KotikitError(
        "This flow manifest has an invalid shape.",
        "Check the flow manifest schema version, nodes, edges, start, end, and required capabilities."
      );
    }
    throw err;
  }
}

function collectCapabilities(flow: FlowDefinition, nodes: ResolvedFlowNode[]): string[] {
  const capabilities = new Set(flow.requiredCapabilities);
  nodes.forEach(({ definition }) => {
    definition.requiredCapabilities.forEach((capability) => {
      capabilities.add(capability);
    });
  });
  return Array.from(capabilities).sort();
}

function reachableNodeIds(flow: FlowDefinition): Set<string> {
  const adjacency = new Map<string, string[]>();
  flow.nodes.forEach((node) => {
    adjacency.set(node.id, []);
  });
  flow.edges.forEach(([source, target]) => {
    adjacency.get(source)?.push(target);
  });

  const reachable = new Set<string>();
  const pending = [flow.start];

  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    adjacency.get(nodeId)?.forEach((target) => {
      pending.push(target);
    });
  }

  return reachable;
}

function findCycle(flow: FlowDefinition): string[] {
  const adjacency = new Map<string, string[]>();
  flow.nodes.forEach((node) => {
    adjacency.set(node.id, []);
  });
  flow.edges.forEach(([source, target]) => {
    adjacency.get(source)?.push(target);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  function visit(nodeId: string): string[] {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId];
    }

    if (visited.has(nodeId)) {
      return [];
    }

    visiting.add(nodeId);
    path.push(nodeId);

    for (const target of adjacency.get(nodeId) ?? []) {
      const cycle = visit(target);
      if (cycle.length > 0) {
        return cycle;
      }
    }

    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return [];
  }

  for (const node of flow.nodes) {
    const cycle = visit(node.id);
    if (cycle.length > 0) {
      return cycle;
    }
  }

  return [];
}

function terminalNodeIds(flow: FlowDefinition): Set<string> {
  const nodesWithOutgoingEdges = new Set(flow.edges.map(([source]) => source));
  return new Set(
    flow.nodes.map((node) => node.id).filter((nodeId) => !nodesWithOutgoingEdges.has(nodeId))
  );
}
