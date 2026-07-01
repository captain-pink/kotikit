import { z } from "zod";
import {
  createNodeRegistry,
  type NodeDefinition,
  type NodeRegistry,
} from "../graph/node-registry.js";
import { briefNodeDefinitions } from "./brief/index.js";
import { commentNodeDefinitions } from "./comments/index.js";
import { designSystemNodeDefinitions } from "./design-system/index.js";
import { draftNodeDefinitions } from "./draft/index.js";
import { draftComponentNodeDefinitions } from "./draft-components/index.js";
import { figmaNodeDefinitions } from "./figma/index.js";
import { flowNodeDefinitions } from "./flow/index.js";
import { memoryNodeDefinitions } from "./memory/index.js";
import { qaNodeDefinitions } from "./qa/index.js";
import { reviewNodeDefinitions } from "./review/index.js";
import { uiCompositionNodeDefinitions } from "./ui-composition/index.js";
import { uxNodeDefinitions } from "./ux/index.js";

export function createBuiltInNodeRegistry(): NodeRegistry {
  return createNodeRegistry(builtInNodeDefinitions());
}

export function builtInNodeDefinitions(): NodeDefinition[] {
  return [
    ...briefNodeDefinitions,
    ...uxNodeDefinitions,
    ...commentNodeDefinitions,
    ...flowNodeDefinitions,
    ...designSystemNodeDefinitions,
    ...uiCompositionNodeDefinitions,
    ...draftComponentNodeDefinitions,
    ...draftNodeDefinitions,
    ...figmaNodeDefinitions,
    ...qaNodeDefinitions,
    ...reviewNodeDefinitions,
    ...memoryNodeDefinitions,
    ...futureNodeStubs,
  ];
}

const futureNodeStubs: NodeDefinition[] = [
  stub("setup.runDoctor", ["setup.doctor"]),
  stub("setup.detectFigmaRemoteMcp", ["setup.detect"]),
  stub("setup.detectLocalCache", ["setup.detect"]),
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
