import { z } from "zod";

export const KOTIKIT_FLOW_SCHEMA_ID = "https://kotikit.dev/schemas/kotikit-flow.schema.json";
const FLOW_DEFINITION_SCHEMA_VERSION = 1;

const FlowIdSchema = z.string().min(1);
const FlowNodeIdSchema = z.string().min(1);
const CapabilitySchema = z.string().min(1);

const FlowNodeSchema = z.strictObject({
  id: FlowNodeIdSchema,
  uses: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  interrupt: z.enum(["ask-user", "external-action"]).optional(),
});

const FlowEdgeSchema = z.array(FlowNodeIdSchema).length(2);

export const FlowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(FLOW_DEFINITION_SCHEMA_VERSION),
  id: FlowIdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  stateSchema: z.literal("KotikitGraphState/v1"),
  requiredCapabilities: z.array(CapabilitySchema),
  nodes: z.array(FlowNodeSchema).min(1),
  edges: z.array(FlowEdgeSchema),
  start: FlowNodeIdSchema,
  end: z.array(FlowNodeIdSchema).min(1),
  safetyProfile: z.string().min(1),
});

export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
