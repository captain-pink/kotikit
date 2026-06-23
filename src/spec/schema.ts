import { z } from "zod";
import { FigmaDraftTargetSchema } from "../figma/draft-target.js";
import { nowIso, uuid } from "../util/ids";

export const SCREEN_SPEC_SCHEMA_VERSION = 3;
export const FLOW_MANIFEST_SCHEMA_VERSION = 3;

// Helper: a field that is either the string "inherits" or an object with overrides
const InheritOr = <T extends z.ZodTypeAny>(overrides: T) =>
  z.union([z.literal("inherits"), z.object({ overrides })]);

// ─── Component resolution ───────────────────────────────────────────────────

export const ComponentVariablePolicySchema = z.enum([
  "require-existing-variables",
  "suggest-plugin-sync",
  "allow-literals-after-user-confirmation",
]);
export type ComponentVariablePolicy = z.infer<typeof ComponentVariablePolicySchema>;

export const ComponentResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing-ds"),
    status: z.enum(["approved"]).default("approved"),
    variablePolicy: ComponentVariablePolicySchema.default("require-existing-variables"),
  }),
  z.object({
    kind: z.literal("create-draft-component"),
    status: z.enum(["planned", "in-progress", "review", "approved"]).default("planned"),
    componentSpecRef: z.string().optional(),
    variablePolicy: ComponentVariablePolicySchema.default("require-existing-variables"),
  }),
  z.object({
    kind: z.literal("inline-draft"),
    status: z.enum(["planned", "approved"]).default("planned"),
    variablePolicy: ComponentVariablePolicySchema.default("require-existing-variables"),
  }),
]);
export type ComponentResolution = z.infer<typeof ComponentResolutionSchema>;

const ScreenComponentSchema = z
  .object({
    name: z.string(),
    dsKey: z.string().optional(),
    usage: z.string().optional(),
    resolution: ComponentResolutionSchema.optional(),
  })
  .transform((component) => ({
    ...component,
    ...(component.resolution !== undefined
      ? { resolution: component.resolution }
      : component.dsKey !== undefined
        ? {
            resolution: {
              kind: "existing-ds" as const,
              status: "approved" as const,
              variablePolicy: "require-existing-variables" as const,
            },
          }
        : {}),
  }));
export type ScreenComponent = z.infer<typeof ScreenComponentSchema>;

// ─── Screen Spec ─────────────────────────────────────────────────────────────

export const ScreenSpecSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .positive()
    .max(SCREEN_SPEC_SCHEMA_VERSION)
    .default(SCREEN_SPEC_SCHEMA_VERSION),
  id: z.string().uuid(),
  version: z.string().default("1.0.0"),
  status: z.enum(["draft", "active"]).default("draft"),
  title: z.string().min(1, "title is required"),
  type: z.literal("screen"),
  flowRef: z.string().optional(),
  figmaTarget: FigmaDraftTargetSchema.optional(),
  context: z.object({
    description: z.string().min(1, "context.description is required"),
    userTypes: z.array(z.string()).default([]),
    entryPoints: z.array(z.string()).default([]),
  }),
  requirements: z.object({
    functional: z.array(z.string()).default([]),
    states: z.record(z.string(), z.string()),
    responsive: InheritOr(z.object({ breakpoints: z.array(z.number().int().positive()) })),
    themes: InheritOr(z.object({ themes: z.array(z.string()) })),
  }),
  components: z.array(ScreenComponentSchema).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export type ScreenSpec = z.infer<typeof ScreenSpecSchema>;

// ─── Flow Manifest ────────────────────────────────────────────────────────────

export const FlowManifestSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .positive()
    .max(FLOW_MANIFEST_SCHEMA_VERSION)
    .default(FLOW_MANIFEST_SCHEMA_VERSION),
  id: z.string().uuid(),
  title: z.string().min(1, "title is required"),
  description: z.string().min(1, "description is required"),
  screens: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        title: z.string(),
      })
    )
    .min(1, "a flow must have at least one screen"),
  transitions: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        trigger: z.string(),
      })
    )
    .default([]),
  sharedState: z.array(z.string()).default([]),
  figmaTarget: FigmaDraftTargetSchema.optional(),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export type FlowManifest = z.infer<typeof FlowManifestSchema>;

// ─── Factories ────────────────────────────────────────────────────────────────

export function newScreenSpec(input: {
  title: string;
  description: string;
  flowRef?: string;
}): ScreenSpec {
  const now = nowIso();
  return ScreenSpecSchema.parse({
    schemaVersion: SCREEN_SPEC_SCHEMA_VERSION,
    id: uuid(),
    version: "1.0.0",
    status: "draft",
    title: input.title,
    type: "screen",
    flowRef: input.flowRef,
    context: {
      description: input.description,
      userTypes: [],
      entryPoints: [],
    },
    requirements: {
      functional: [],
      states: {},
      responsive: "inherits",
      themes: "inherits",
    },
    components: [],
    acceptanceCriteria: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  });
}

export function newFlowManifest(input: {
  title: string;
  description: string;
  screens: { id: string; path: string; title: string }[];
}): FlowManifest {
  const now = nowIso();
  return FlowManifestSchema.parse({
    schemaVersion: FLOW_MANIFEST_SCHEMA_VERSION,
    id: uuid(),
    title: input.title,
    description: input.description,
    screens: input.screens,
    transitions: [],
    sharedState: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  });
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

export function parseScreenSpec(raw: unknown): ScreenSpec {
  const result = ScreenSpecSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".") || "root").join(", ");
    throw new Error(
      `This spec file has an invalid format. Problem with: ${fields}. ` +
        `The file may have been edited manually and become malformed.`
    );
  }
  return result.data;
}

export function parseFlowManifest(raw: unknown): FlowManifest {
  const result = FlowManifestSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".") || "root").join(", ");
    throw new Error(
      `This flow manifest has an invalid format. Problem with: ${fields}. ` +
        `The file may have been edited manually and become malformed.`
    );
  }
  return result.data;
}
