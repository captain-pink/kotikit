import { z } from "zod";

export const AuditOutcomeSchema = z.enum([
  "synced-ok",
  "synced-mismatched",
  "design-only",
  "code-only",
]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditEntrySchema = z.object({
  name: z.string(),
  outcome: AuditOutcomeSchema,
  dsPath: z.string().nullable(),
  codePath: z.string().nullable(),
  variantDelta: z
    .object({
      dsOnly: z.array(z.string()),
      codeOnly: z.array(z.string()),
    })
    .optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditReportSchema = z.object({
  version: z.literal(1),
  ranAt: z.string(),
  summary: z.object({
    syncedOk: z.number().int().nonnegative(),
    syncedMismatched: z.number().int().nonnegative(),
    designOnly: z.number().int().nonnegative(),
    codeOnly: z.number().int().nonnegative(),
  }),
  entries: z.array(AuditEntrySchema),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;
