import type { ReadResourceResult, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { loadBuiltInFlows } from "../../core/flows/catalog.js";
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
];

export function listFacadeResourceTemplates(): ResourceTemplate[] {
  return RESOURCE_TEMPLATES;
}

export async function readFacadeResource(
  uri: string,
  deps: FacadeResourceDependencies = {}
): Promise<ReadResourceResult> {
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
