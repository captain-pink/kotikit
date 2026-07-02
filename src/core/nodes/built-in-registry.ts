import {
  createNodeRegistry,
  type NodeDefinition,
  type NodeRegistry,
} from "../graph/node-registry.js";
import { briefNodeDefinitions } from "./brief/index.js";
import { designSystemNodeDefinitions } from "./design-system/index.js";
import { draftNodeDefinitions } from "./draft/index.js";
import { feedbackNodeDefinitions } from "./feedback/index.js";
import { figmaNodeDefinitions } from "./figma/index.js";
import { qaNodeDefinitions } from "./qa/index.js";
import { uiCompositionNodeDefinitions } from "./ui-composition/index.js";
import { uxNodeDefinitions } from "./ux/index.js";

export function createBuiltInNodeRegistry(): NodeRegistry {
  return createNodeRegistry(builtInNodeDefinitions());
}

export function builtInNodeDefinitions(): NodeDefinition[] {
  return [
    ...briefNodeDefinitions,
    ...uxNodeDefinitions,
    ...designSystemNodeDefinitions,
    ...uiCompositionNodeDefinitions,
    ...draftNodeDefinitions,
    ...figmaNodeDefinitions,
    ...feedbackNodeDefinitions,
    ...qaNodeDefinitions,
  ];
}
