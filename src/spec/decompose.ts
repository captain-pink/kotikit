import {
  newScreenSpec,
  newFlowManifest,
  ScreenSpecSchema,
  type ScreenSpec,
  type FlowManifest,
} from "./schema.js";

// ─── Draft shapes ─────────────────────────────────────────────────────────────

export interface ScreenDraft {
  slug: string;
  title: string;
  description: string;
  functional: string[];
  states: Record<string, string>;
  components?: { name: string; dsKey?: string; usage?: string }[];
  acceptanceCriteria?: string[];
  userTypes?: string[];
  entryPoints?: string[];
}

export interface FlowDraft {
  scope: string;
  title: string;
  description: string;
  screens: ScreenDraft[];
  transitions: { from: string; to: string; trigger: string }[];
  sharedState: string[];
}

export interface SingleDraft {
  scope: string;
  screen: ScreenDraft;
}

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isMultiScreen(d: FlowDraft | SingleDraft): d is FlowDraft {
  return (
    typeof d === "object" &&
    d !== null &&
    "screens" in d &&
    Array.isArray((d as { screens?: unknown }).screens) &&
    typeof (d as { scope?: unknown }).scope === "string" &&
    (d as { scope: string }).scope.trim().length > 0
  );
}

export function isSingleScreen(d: FlowDraft | SingleDraft): d is SingleDraft {
  return (
    typeof d === "object" &&
    d !== null &&
    "screen" in d &&
    typeof (d as { scope?: unknown }).scope === "string" &&
    (d as { scope: string }).scope.trim().length > 0
  );
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
  const manifest = newFlowManifest({
    title: draft.title,
    description: draft.description,
    screens: draft.screens.map((s) => ({
      id: s.slug,
      path: `${s.slug}.spec.json`,
      title: s.title,
    })),
  });

  const specs = draft.screens.map((screen) => {
    const base = newScreenSpec({
      title: screen.title,
      description: screen.description,
      flowRef: `${draft.scope}/flow.json`,
    });

    // Deep-merge the extra fields from the screen draft
    const merged = {
      ...base,
      flowRef: `${draft.scope}/flow.json`,
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
  const screen = draft.screen;

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
