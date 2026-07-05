import type { ReadResourceResult, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadBuiltInFlows } from "../../core/flows/catalog.js";
import {
  CanvasIntentInputSchema,
  ExistingDesignInventoryInputSchema,
  FlowBlueprintInputSchema,
  ScreenBlueprintInputSchema,
} from "../../core/schemas/blueprint.js";
import type { FlowDefinition } from "../../core/schemas/flow-definition.js";
import { KotikitError } from "../../util/result.js";
import type { FacadeRuntime } from "./tools.js";

export type FacadeResourceDependencies = {
  runtime?: FacadeRuntime;
  loadFlows?: () => Promise<FlowDefinition[]>;
};

const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    uriTemplate: "kotikit://runs/{runId}",
    name: "kotikit-run",
    title: "Kotikit Run",
    description: "Compact metadata for a kotikit flow run.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://runs/{runId}/state",
    name: "kotikit-run-state",
    title: "Kotikit Run State",
    description: "Persisted graph state for a kotikit flow run.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://artifacts/{artifactId}",
    name: "kotikit-artifact",
    title: "Kotikit Artifact",
    description: "A persisted artifact produced by a kotikit flow.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://flows/{flowId}",
    name: "kotikit-flow",
    title: "Kotikit Flow",
    description: "A kotikit flow manifest.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://schemas/screen-blueprint-input",
    name: "kotikit-screen-blueprint-input-schema",
    title: "Kotikit Screen Blueprint Input Schema",
    description: "JSON Schema for screenBlueprint input accepted by kotikit_start.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://schemas/flow-blueprint-input",
    name: "kotikit-flow-blueprint-input-schema",
    title: "Kotikit Flow Blueprint Input Schema",
    description: "JSON Schema for flowBlueprint input accepted by kotikit_start.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://schemas/canvas-intent-input",
    name: "kotikit-canvas-intent-input-schema",
    title: "Kotikit Canvas Intent Input Schema",
    description: "JSON Schema for canvasIntent input accepted by kotikit_start.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kotikit://schemas/existing-design-inventory-input",
    name: "kotikit-existing-design-inventory-input-schema",
    title: "Kotikit Existing Design Inventory Input Schema",
    description: "JSON Schema for existingDesignInventory input accepted by kotikit_start.",
    mimeType: "application/json",
  },
];

const SCHEMA_RESOURCES = {
  "screen-blueprint-input": {
    title: "Kotikit Screen Blueprint Input",
    schema: ScreenBlueprintInputSchema,
  },
  "flow-blueprint-input": {
    title: "Kotikit Flow Blueprint Input",
    schema: FlowBlueprintInputSchema,
  },
  "canvas-intent-input": {
    title: "Kotikit Canvas Intent Input",
    schema: CanvasIntentInputSchema,
  },
  "existing-design-inventory-input": {
    title: "Kotikit Existing Design Inventory Input",
    schema: ExistingDesignInventoryInputSchema,
  },
} satisfies Record<string, { title: string; schema: z.ZodType }>;

export function listFacadeResourceTemplates(): ResourceTemplate[] {
  return RESOURCE_TEMPLATES;
}

export async function readFacadeResource(
  uri: string,
  deps: FacadeResourceDependencies = {}
): Promise<ReadResourceResult> {
  const schemaId = matchResource(uri, /^kotikit:\/\/schemas\/([^/]+)$/);
  if (schemaId !== null) {
    return jsonResource(uri, schemaJsonResource(uri, schemaId));
  }

  const flowId = matchResource(uri, /^kotikit:\/\/flows\/([^/]+)$/);
  if (flowId !== null) {
    const flow = findFlow(await (deps.loadFlows ?? loadBuiltInFlows)(), flowId);
    return jsonResource(uri, flow);
  }

  const artifactId = matchResource(uri, /^kotikit:\/\/artifacts\/([^/]+)$/);
  if (artifactId !== null) {
    const runtime = requireRuntime(deps.runtime);
    return jsonResource(uri, await runtime.getArtifact(artifactId));
  }

  const runStateId = matchResource(uri, /^kotikit:\/\/runs\/([^/]+)\/state$/);
  if (runStateId !== null) {
    const runtime = requireRuntime(deps.runtime);
    return jsonResource(uri, await runtime.getRunState(runStateId));
  }

  const runId = matchResource(uri, /^kotikit:\/\/runs\/([^/]+)$/);
  if (runId !== null) {
    const runtime = requireRuntime(deps.runtime);
    const state = await runtime.getRunState(runId);
    return jsonResource(uri, {
      runId: state.runId,
      flowId: state.flowId,
      flowVersion: state.flowVersion,
      graphHash: state.graphHash,
      status: state.status,
      pendingQuestion: state.pendingQuestion,
      pendingApproval: state.pendingApproval,
      artifacts: state.artifacts,
      errors: state.errors,
    });
  }

  throw new KotikitError(
    `Unknown kotikit resource: ${uri}.`,
    "Use resources/templates/list to inspect available kotikit resource URI templates."
  );
}

function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

// Builds a JSON Schema payload from the same Zod contract used by tool input validation.
function schemaJsonResource(uri: string, schemaId: string): Record<string, unknown> {
  const resource = schemaResourceFor(schemaId);
  if (resource === undefined) {
    throw new KotikitError(
      `Unknown kotikit schema resource: ${schemaId}.`,
      "Use resources/templates/list to inspect available kotikit schema resources."
    );
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: uri,
    title: resource.title,
    ...(z.toJSONSchema(resource.schema) as Record<string, unknown>),
  };
}

// Finds the schema resource descriptor for a stable kotikit://schemas id.
function schemaResourceFor(
  schemaId: string
): (typeof SCHEMA_RESOURCES)[keyof typeof SCHEMA_RESOURCES] | undefined {
  return SCHEMA_RESOURCES[schemaId as keyof typeof SCHEMA_RESOURCES];
}

function matchResource(uri: string, pattern: RegExp): string | null {
  const match = pattern.exec(uri);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

function findFlow(flows: FlowDefinition[], flowId: string): FlowDefinition {
  const flow = flows.find((candidate) => candidate.id === flowId);
  if (flow === undefined) {
    throw new KotikitError(
      `Unknown kotikit flow: ${flowId}.`,
      "Use kotikit_flow_list to see the available flows."
    );
  }
  return flow;
}

function requireRuntime(runtime: FacadeRuntime | undefined): FacadeRuntime {
  if (runtime === undefined) {
    throw new KotikitError(
      "The kotikit graph runtime is not wired for this MCP session yet.",
      "Run and artifact resources become available after the graph runtime migration is wired."
    );
  }
  return runtime;
}
