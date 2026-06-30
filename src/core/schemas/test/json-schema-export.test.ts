import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { ArtifactSchema, KOTIKIT_ARTIFACT_SCHEMA_ID } from "../artifact.js";
import { FlowDefinitionSchema, KOTIKIT_FLOW_SCHEMA_ID } from "../flow-definition.js";
import { KotikitGraphStateSchema } from "../graph-state.js";
import {
  exportKotikitJsonSchemas,
  findDisallowedJsonSchemaConstructs,
} from "../json-schema-export.js";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value as JsonObject;
}

function property(schema: JsonObject, name: string): JsonObject {
  const properties = asObject(schema.properties);
  return asObject(properties[name]);
}

describe("kotikit JSON Schema export", () => {
  it("exports flow definition json schema with stable id", () => {
    const { flow } = exportKotikitJsonSchemas();

    expect(flow.$id).toBe(KOTIKIT_FLOW_SCHEMA_ID);
    expect(flow.title).toBe("Kotikit Flow Definition");
    expect(flow.type).toBe("object");
    expect(flow.required).toEqual(
      expect.arrayContaining(["schemaVersion", "id", "version", "nodes", "edges", "start", "end"])
    );
    expect(property(flow, "nodes").type).toBe("array");
    expect(property(flow, "edges").items).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(() => FlowDefinitionSchema.parse(validFlowDefinition())).not.toThrow();
  });

  it("exports artifact json schema with stable id", () => {
    const { artifact, graphState } = exportKotikitJsonSchemas();

    expect(artifact.$id).toBe(KOTIKIT_ARTIFACT_SCHEMA_ID);
    expect(artifact.title).toBe("Kotikit Artifact");
    expect(artifact.type).toBe("object");
    expect(artifact.required).toEqual(
      expect.arrayContaining(["id", "runId", "type", "schemaVersion", "createdAt", "updatedAt"])
    );

    const artifactType = property(artifact, "type");
    expect(artifactType.enum).toEqual(
      expect.arrayContaining([
        "ui-composition-contract",
        "layout-contract",
        "variable-binding-plan",
        "draft-component-plan",
        "ui-quality-gate-report",
      ])
    );

    const graphStateProperties = asObject(graphState.properties);
    expect(graphStateProperties.uiComposition).toBeDefined();
    expect(graphStateProperties.layoutContract).toBeDefined();
    expect(graphStateProperties.variableBindingPlan).toBeDefined();
    expect(graphStateProperties.draftComponentPlan).toBeDefined();
    expect(graphStateProperties.uiQualityGate).toBeDefined();
    expect(graphState.required).not.toContain("uiComposition");
    expect(() => ArtifactSchema.parse(validArtifact())).not.toThrow();
    expect(() => KotikitGraphStateSchema.parse(validGraphState())).not.toThrow();
  });

  it("rejects malformed known artifact payloads", () => {
    expect(() =>
      ArtifactSchema.parse({
        ...validArtifact(),
        payload: { schemaVersion: "UICompositionContract/v1" },
      })
    ).toThrow();
  });

  it("rejects non json schema exported constructs", () => {
    const { flow, artifact, graphState } = exportKotikitJsonSchemas();

    expect(findDisallowedJsonSchemaConstructs(flow)).toEqual([]);
    expect(findDisallowedJsonSchemaConstructs(artifact)).toEqual([]);
    expect(findDisallowedJsonSchemaConstructs(graphState)).toEqual([]);
  });

  it("keeps checked-in json schema files in sync with exporter output", async () => {
    const { artifact, flow } = exportKotikitJsonSchemas();

    await expect(
      readJsonFile(new URL("../../../../schemas/kotikit-flow.schema.json", import.meta.url))
    ).resolves.toEqual(flow);
    await expect(
      readJsonFile(new URL("../../../../schemas/kotikit-artifact.schema.json", import.meta.url))
    ).resolves.toEqual(artifact);
  });
});

async function readJsonFile(path: URL): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function validFlowDefinition() {
  return {
    schemaVersion: 1,
    id: "create-screen",
    version: "1.0.0",
    title: "Create Screen",
    description: "Create a high-fidelity Figma screen draft.",
    stateSchema: "KotikitGraphState/v1",
    requiredCapabilities: ["designSystem.search.local"],
    nodes: [
      {
        id: "capture-minimal-intent",
        uses: "brief.captureMinimalIntent",
        params: { lane: "quick" },
      },
    ],
    edges: [],
    start: "capture-minimal-intent",
    end: ["capture-minimal-intent"],
    safetyProfile: "standard-design-draft",
  };
}

function validArtifact() {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "ui-composition-contract",
    schemaVersion: "UICompositionContract/v1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    sourceNode: {
      key: "ui.buildCompositionContract",
      version: "1.0.0",
    },
    payload: {
      schemaVersion: "UICompositionContract/v1",
      parts: [
        {
          id: "primary-action",
          name: "Primary action",
          role: "button",
          source: "existing-component",
          componentKey: "button-key",
        },
      ],
    },
  };
}

function validGraphState() {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-1",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "hash-1",
    status: "running",
    project: {
      root: "/tmp/kotikit",
      name: "kotikit",
    },
    artifacts: [],
    errors: [],
    uiComposition: {
      schemaVersion: "UICompositionContract/v1",
      parts: [
        {
          id: "primary-action",
          name: "Primary action",
          role: "button",
          source: "existing-component",
          componentKey: "button-key",
        },
      ],
    },
  };
}
