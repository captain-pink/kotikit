import { z } from "zod";
import { KotikitError } from "../util/result.js";
import {
  ComponentResolutionSchema,
  type FlowManifest,
  newFlowManifest,
  newScreenSpec,
  type ScreenSpec,
  ScreenSpecSchema,
} from "./schema.js";

// ─── Draft shapes ─────────────────────────────────────────────────────────────

const ScreenComponentDraftSchema = z.object({
  name: z.string().min(1, "component name is required"),
  dsKey: z.string().min(1, "dsKey must not be empty").optional(),
  usage: z.string().optional(),
  resolution: ComponentResolutionSchema.optional(),
});

const ScreenDraftSchema = z.object({
  slug: z.string().min(1, "screen slug is required"),
  title: z.string().min(1, "screen title is required"),
  description: z.string().min(1, "screen description is required"),
  functional: z.array(z.string()),
  states: z.record(z.string(), z.string()),
  components: z.array(ScreenComponentDraftSchema).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  userTypes: z.array(z.string()).optional(),
  entryPoints: z.array(z.string()).optional(),
});

const FlowTransitionDraftSchema = z.object({
  from: z.string().min(1, "transition source is required"),
  to: z.string().min(1, "transition target is required"),
  trigger: z.string().min(1, "transition trigger is required"),
});

const FlowDraftSchema = z.object({
  scope: z.string().min(1, "scope is required"),
  title: z.string().min(1, "flow title is required"),
  description: z.string().min(1, "flow description is required"),
  screens: z.array(ScreenDraftSchema).min(1, "a flow must have at least one screen"),
  transitions: z.array(FlowTransitionDraftSchema).default([]),
  sharedState: z.array(z.string()).default([]),
});

const SingleDraftSchema = z.object({
  scope: z.string().min(1, "scope is required"),
  screen: ScreenDraftSchema,
});

export type FlowDraft = z.infer<typeof FlowDraftSchema>;
export type SingleDraft = z.infer<typeof SingleDraftSchema>;

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isMultiScreen(d: unknown): d is FlowDraft {
  if (typeof d !== "object" || d === null) return false;
  const maybeDraft = d as { scope?: unknown; screens?: unknown };
  return (
    Array.isArray(maybeDraft.screens) &&
    typeof maybeDraft.scope === "string" &&
    maybeDraft.scope.trim().length > 0
  );
}

export function isSingleScreen(d: unknown): d is SingleDraft {
  if (typeof d !== "object" || d === null) return false;
  const maybeDraft = d as { scope?: unknown; screen?: unknown };
  return (
    maybeDraft.screen !== undefined &&
    typeof maybeDraft.scope === "string" &&
    maybeDraft.scope.trim().length > 0
  );
}

function formatDraftIssues(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "draft"))];
  return fields.join(", ");
}

function draftShapeError(error: z.ZodError): KotikitError {
  return new KotikitError(
    "That draft doesn't match a kotikit draft shape.",
    `Problem with: ${formatDraftIssues(error)}. For one screen, pass { scope, screen: { slug, title, description, functional, states } }. For a flow, pass { scope, title, description, screens, transitions, sharedState }.`
  );
}

function parseSingleDraft(draft: SingleDraft): SingleDraft {
  const result = SingleDraftSchema.safeParse(draft);
  if (!result.success) {
    throw draftShapeError(result.error);
  }
  return result.data;
}

function parseFlowDraft(draft: FlowDraft): FlowDraft {
  const result = FlowDraftSchema.safeParse(draft);
  if (!result.success) {
    throw draftShapeError(result.error);
  }
  return result.data;
}

// ─── Materializers ────────────────────────────────────────────────────────────

/**
 * Convert a FlowDraft into a validated FlowManifest + array of ScreenSpecs.
 * Pure function — no disk I/O.
 */
export function materializeFlow(draft: FlowDraft): {
  manifest: FlowManifest;
  specs: { screenSlug: string; spec: ScreenSpec }[];
} {
  const parsed = parseFlowDraft(draft);
  const manifest = newFlowManifest({
    title: parsed.title,
    description: parsed.description,
    screens: parsed.screens.map((s) => ({
      id: s.slug,
      path: `${s.slug}.spec.json`,
      title: s.title,
    })),
  });

  const specs = parsed.screens.map((screen) => {
    const base = newScreenSpec({
      title: screen.title,
      description: screen.description,
      flowRef: `${parsed.scope}/flow.json`,
    });

    // Deep-merge the extra fields from the screen draft
    const merged = {
      ...base,
      flowRef: `${parsed.scope}/flow.json`,
      context: {
        ...base.context,
        userTypes: screen.userTypes ?? [],
        entryPoints: screen.entryPoints ?? [],
      },
      requirements: {
        ...base.requirements,
        functional: screen.functional,
        states: screen.states,
      },
      components: screen.components ?? [],
      acceptanceCriteria: screen.acceptanceCriteria ?? [],
    };

    // Re-validate to ensure clean typed output
    const spec = ScreenSpecSchema.parse(merged);

    return { screenSlug: screen.slug, spec };
  });

  return { manifest, specs };
}

/**
 * Convert a SingleDraft into a validated ScreenSpec.
 * Pure function — no disk I/O.
 */
export function materializeSingle(draft: SingleDraft): { spec: ScreenSpec } {
  const screen = parseSingleDraft(draft).screen;

  const base = newScreenSpec({
    title: screen.title,
    description: screen.description,
    flowRef: undefined,
  });

  const merged = {
    ...base,
    context: {
      ...base.context,
      userTypes: screen.userTypes ?? [],
      entryPoints: screen.entryPoints ?? [],
    },
    requirements: {
      ...base.requirements,
      functional: screen.functional,
      states: screen.states,
    },
    components: screen.components ?? [],
    acceptanceCriteria: screen.acceptanceCriteria ?? [],
  };

  const spec = ScreenSpecSchema.parse(merged);

  return { spec };
}
