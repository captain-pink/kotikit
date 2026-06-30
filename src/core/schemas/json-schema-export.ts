import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { ArtifactSchema, KOTIKIT_ARTIFACT_SCHEMA_ID } from "./artifact.js";
import { FlowDefinitionSchema, KOTIKIT_FLOW_SCHEMA_ID } from "./flow-definition.js";
import { KOTIKIT_GRAPH_STATE_SCHEMA_ID, KotikitGraphStateSchema } from "./graph-state.js";

type JsonObject = Record<string, unknown>;

export type KotikitJsonSchemas = {
  flow: JsonObject;
  artifact: JsonObject;
  graphState: JsonObject;
};

const DISALLOWED_JSON_SCHEMA_CONSTRUCTS = new Set([
  "bigint",
  "custom",
  "date",
  "function",
  "map",
  "nan",
  "pipe",
  "promise",
  "set",
  "symbol",
  "transform",
  "undefined",
  "void",
]);

function exportJsonSchema(schema: z.ZodType, id: string, title: string): JsonObject {
  const exported = z.toJSONSchema(schema) as JsonObject;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    title,
    ...exported,
  };
}

export function exportKotikitJsonSchemas(): KotikitJsonSchemas {
  return {
    flow: exportJsonSchema(FlowDefinitionSchema, KOTIKIT_FLOW_SCHEMA_ID, "Kotikit Flow Definition"),
    artifact: exportJsonSchema(ArtifactSchema, KOTIKIT_ARTIFACT_SCHEMA_ID, "Kotikit Artifact"),
    graphState: exportJsonSchema(
      KotikitGraphStateSchema,
      KOTIKIT_GRAPH_STATE_SCHEMA_ID,
      "Kotikit Graph State"
    ),
  };
}

export function findDisallowedJsonSchemaConstructs(schema: unknown): string[] {
  const found = new Set<string>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value !== "object" || value === null) {
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      if (DISALLOWED_JSON_SCHEMA_CONSTRUCTS.has(key.toLowerCase())) {
        found.add(key);
      }
      if (key === "type" && typeof child === "string") {
        const normalizedType = child.toLowerCase();
        if (DISALLOWED_JSON_SCHEMA_CONSTRUCTS.has(normalizedType)) {
          found.add(child);
        }
      }
      visit(child);
    });
  }

  visit(schema);
  return Array.from(found).sort();
}

export async function writeKotikitJsonSchemaFiles(
  outputDir: URL = new URL("../../../schemas/", import.meta.url)
): Promise<void> {
  const { artifact, flow } = exportKotikitJsonSchemas();

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(new URL("kotikit-flow.schema.json", outputDir), `${JSON.stringify(flow, null, 2)}\n`),
    writeFile(
      new URL("kotikit-artifact.schema.json", outputDir),
      `${JSON.stringify(artifact, null, 2)}\n`
    ),
  ]);
}

if (import.meta.main) {
  await writeKotikitJsonSchemaFiles();
}
