import { z } from "zod";

export const FIGMA_WRITE_PREFLIGHT_SCHEMA_VERSION = "FigmaWritePreflight/v1";

export const FigmaWritePreflightSchema = z.strictObject({
  schemaVersion: z.literal(FIGMA_WRITE_PREFLIGHT_SCHEMA_VERSION),
  id: z.string().min(1),
  runId: z.string().min(1),
  transactionId: z.string().min(1),
  fileKey: z.string().min(1),
  pageId: z.string().min(1),
  pageName: z.string().min(1),
  sectionName: z.string().min(1).optional(),
  sourceNodeId: z.string().min(1).optional(),
  issuedAt: z.string().min(1),
});

export type FigmaWritePreflight = z.infer<typeof FigmaWritePreflightSchema>;
