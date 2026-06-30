import { z } from "zod";
import {
  createNodeRegistry,
  type NodeDefinition,
  type NodeRegistry,
} from "../graph/node-registry.js";
import { briefNodeDefinitions } from "./brief/index.js";
import { designSystemNodeDefinitions } from "./design-system/index.js";
import { draftNodeDefinitions } from "./draft/index.js";
import { draftComponentNodeDefinitions } from "./draft-components/index.js";
import { figmaNodeDefinitions } from "./figma/index.js";
import { flowNodeDefinitions } from "./flow/index.js";
import { qaNodeDefinitions } from "./qa/index.js";
import { uiCompositionNodeDefinitions } from "./ui-composition/index.js";

export function createBuiltInNodeRegistry(): NodeRegistry {
  return createNodeRegistry(builtInNodeDefinitions());
}

export function builtInNodeDefinitions(): NodeDefinition[] {
  return [
    ...briefNodeDefinitions,
    ...flowNodeDefinitions,
    ...designSystemNodeDefinitions,
    ...uiCompositionNodeDefinitions,
    ...draftComponentNodeDefinitions,
    ...draftNodeDefinitions,
    ...figmaNodeDefinitions,
    ...qaNodeDefinitions,
    ...futureNodeStubs,
  ];
}

const futureNodeStubs: NodeDefinition[] = [
  stub("setup.runDoctor", ["setup.doctor"]),
  stub("setup.detectFigmaRemoteMcp", ["setup.detect"]),
  stub("setup.detectLocalCache", ["setup.detect"]),
  stub("review.collectEvidence", ["review.write"]),
  stub("review.compareToDesignSystem", ["review.write"]),
  stub("review.groupFindings", ["review.write"]),
  stub("review.createRevisionPlan", ["review.write"]),
  stub("review.askApproval", ["review.write"]),
  stub("review.applyApprovedRevisions", ["figma.write.remote"]),
  stub("memory.promotePreference", ["memory.write"]),
];

function stub(key: string, capabilities: string[]): NodeDefinition {
  return {
    key,
    version: "1.0.0",
    kind: "deterministic",
    paramsSchema: z.record(z.string(), z.unknown()),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: [],
    stateWrites: [],
    sideEffects: "none",
    requiredCapabilities: capabilities,
    run: async () => ({}),
  };
}
