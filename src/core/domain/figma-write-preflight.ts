import type { FigmaDraftTarget } from "../../figma/draft-target.js";
import { nowIso } from "../../util/ids.js";
import { KotikitError } from "../../util/result.js";
import {
  FIGMA_WRITE_PREFLIGHT_SCHEMA_VERSION,
  type FigmaWritePreflight,
  FigmaWritePreflightSchema,
} from "../schemas/figma-write-preflight.js";
import type { KotikitGraphState } from "../schemas/graph-state.js";

type ActiveFigmaTransaction = NonNullable<KotikitGraphState["activeFigmaTransaction"]>;

/** Builds the page guard that an agent must confirm before one Figma write. */
export function buildFigmaWritePreflight(input: {
  runId: string;
  target: FigmaDraftTarget;
  active: ActiveFigmaTransaction;
  now?: () => string;
}): FigmaWritePreflight {
  return FigmaWritePreflightSchema.parse({
    schemaVersion: FIGMA_WRITE_PREFLIGHT_SCHEMA_VERSION,
    id: `figma-preflight:${input.runId}:${input.active.id}`,
    runId: input.runId,
    transactionId: input.active.id,
    fileKey: input.target.fileKey,
    pageId: input.target.pageId,
    pageName: input.target.pageName,
    ...(input.target.section?.name === undefined ? {} : { sectionName: input.target.section.name }),
    ...(input.target.sourceNode?.id === undefined
      ? {}
      : { sourceNodeId: input.target.sourceNode.id }),
    issuedAt: input.now?.() ?? nowIso(),
  });
}

/** Validates that recorded Figma metadata belongs to the prepared page guard. */
export function assertFigmaWritePreflight(input: {
  preflight: unknown;
  preflightId: string | undefined;
  metadata: Record<string, unknown>;
}): FigmaWritePreflight {
  const parsed = FigmaWritePreflightSchema.safeParse(input.preflight);
  if (!parsed.success) {
    throw new KotikitError(
      "Prepare a Figma write preflight before recording apply metadata.",
      "Call kotikit_prepare_figma_write for the active transaction, then apply that exact transaction in Figma."
    );
  }
  if (input.preflightId !== parsed.data.id) {
    throw new KotikitError(
      "The recorded Figma apply metadata does not match the active write preflight.",
      "Use the preflightId returned for the active transaction before recording apply metadata."
    );
  }
  if (input.metadata.transactionId !== parsed.data.transactionId) {
    throw new KotikitError(
      "The recorded Figma apply metadata belongs to a different transaction than the write preflight.",
      "Prepare and record only the active Figma transaction."
    );
  }
  assertMetadataTarget({
    expected: parsed.data,
    metadata: input.metadata,
  });
  return parsed.data;
}

/** Validates apply metadata against the run's bound target before state changes. */
export function assertFigmaMetadataMatchesTarget(input: {
  target: FigmaDraftTarget;
  metadata: Record<string, unknown>;
}): void {
  assertMetadataTarget({
    expected: {
      fileKey: input.target.fileKey,
      pageId: input.target.pageId,
      sectionName: input.target.section?.name,
    },
    metadata: input.metadata,
  });
}

// Keeps file, page, and Section mismatch messages consistent across guards.
function assertMetadataTarget(input: {
  expected: { fileKey: string; pageId: string; sectionName?: string };
  metadata: Record<string, unknown>;
}): void {
  if (input.metadata.fileKey !== input.expected.fileKey) {
    throw new KotikitError(
      "This applied Figma node belongs to a different Figma file than the bound draft target.",
      "Open the bound draft file before applying the design."
    );
  }
  if (input.metadata.pageId !== input.expected.pageId) {
    throw new KotikitError(
      "This applied Figma node is outside the bound draft page.",
      "Open the exact bound draft page before applying the design."
    );
  }
  if (
    input.expected.sectionName !== undefined &&
    input.metadata.sectionName !== input.expected.sectionName
  ) {
    throw new KotikitError(
      "This applied Figma node is outside the kotikit-owned draft section.",
      "Apply the design inside the Section recorded in the design plan."
    );
  }
}
