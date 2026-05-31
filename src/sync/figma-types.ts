import { z } from "zod";

// ─── Common building blocks ─────────────────────────────────────────────────

const FrameInfoSchema = z.object({
  nodeId: z.string().optional(),
  name: z.string().optional(),
  pageName: z.string().optional(),
}).passthrough();

const ComponentPropertyDefSchema = z.object({
  type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]),
  defaultValue: z.union([z.string(), z.boolean()]).optional(),
  variantOptions: z.array(z.string()).optional(),
}).passthrough();

// ─── GET /v1/files/:key ──────────────────────────────────────────────────────

export const FigmaPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  children: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

export const FigmaFileSchema = z.object({
  name: z.string().optional(),
  document: z.object({
    children: z.array(FigmaPageSchema).optional(),
  }).passthrough().optional(),
}).passthrough();
export type FigmaFile = z.infer<typeof FigmaFileSchema>;

// ─── GET /v1/files/:key/components ───────────────────────────────────────────

export const FigmaPublishedComponentSchema = z.object({
  key: z.string(),
  node_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  thumbnail_url: z.string().optional(),
  component_set_id: z.string().optional(),
  containing_frame: FrameInfoSchema.optional(),
}).passthrough();
export type FigmaPublishedComponent = z.infer<typeof FigmaPublishedComponentSchema>;

const FigmaComponentsResponseSchema = z.object({
  meta: z.object({
    components: z.array(FigmaPublishedComponentSchema),
  }),
}).passthrough();

// ─── GET /v1/files/:key/component_sets ───────────────────────────────────────

export const FigmaComponentSetSchema = z.object({
  key: z.string(),
  node_id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  defaultVariantId: z.string().optional(),
  componentPropertyDefinitions: z.record(z.string(), ComponentPropertyDefSchema).optional(),
}).passthrough();
export type FigmaComponentSet = z.infer<typeof FigmaComponentSetSchema>;

const FigmaComponentSetsResponseSchema = z.object({
  meta: z.object({
    component_sets: z.array(FigmaComponentSetSchema),
  }),
}).passthrough();

// ─── GET /v1/files/:key/styles ───────────────────────────────────────────────

export const FigmaStyleSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  style_type: z.enum(["FILL", "TEXT", "EFFECT", "GRID"]),
  node_id: z.string().optional(),
}).passthrough();
export type FigmaStyle = z.infer<typeof FigmaStyleSchema>;

const FigmaStylesResponseSchema = z.object({
  meta: z.object({
    styles: z.array(FigmaStyleSchema),
  }),
}).passthrough();

// ─── GET /v1/files/:key/variables/local ──────────────────────────────────────

export const FigmaLocalVariablesSchema = z.object({
  variables: z.record(z.string(), z.object({
    id: z.string(),
    name: z.string(),
    resolvedType: z.enum(["BOOLEAN", "FLOAT", "STRING", "COLOR"]),
    valuesByMode: z.record(z.string(), z.unknown()).optional(),
    description: z.string().optional(),
  }).passthrough()).optional(),
  variableCollections: z.record(z.string(), z.object({
    id: z.string(),
    name: z.string(),
    modes: z.array(z.object({ modeId: z.string(), name: z.string() })).optional(),
  }).passthrough()).optional(),
}).passthrough();
export type FigmaLocalVariables = z.infer<typeof FigmaLocalVariablesSchema>;

const FigmaVariablesResponseSchema = z.object({
  meta: FigmaLocalVariablesSchema,
}).passthrough();

// ─── GET /v1/files/:key/nodes ────────────────────────────────────────────────

export const FigmaNodeSchema = z.object({
  document: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    componentPropertyDefinitions: z.record(z.string(), ComponentPropertyDefSchema).optional(),
  }).passthrough().optional(),
}).passthrough();
export type FigmaNode = z.infer<typeof FigmaNodeSchema>;

const FigmaNodesResponseSchema = z.object({
  nodes: z.record(z.string(), z.union([FigmaNodeSchema, z.null()])),
}).passthrough();

// Re-export response schemas for the client
export {
  FigmaComponentsResponseSchema,
  FigmaComponentSetsResponseSchema,
  FigmaStylesResponseSchema,
  FigmaVariablesResponseSchema,
  FigmaNodesResponseSchema,
};

// ─── Document-tree walker type ───────────────────────────────────────────────
// Used when /components returns empty (unpublished libraries / free-plan files).
// Kept as a TypeScript interface rather than a Zod schema because we only need
// recursive walking — the schema validation happens at the FigmaFile level above.

export interface FigmaTreeNode {
  id?: string;
  name?: string;
  type?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  componentSetId?: string;
  description?: string;
  children?: FigmaTreeNode[];
}
