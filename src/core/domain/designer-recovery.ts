import { z } from "zod";

const DesignerRecoverySchema = z.strictObject({
  schemaVersion: z.literal("DesignerRecovery/v1"),
  problem: z.string().min(1),
  why: z.string().min(1),
  recommendedAction: z.string().min(1),
  actions: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
      })
    )
    .min(1)
    .max(3),
  artifactRefs: z.array(z.string().min(1)).optional(),
  technicalDetailsRef: z.string().min(1).optional(),
});

export type DesignerRecovery = z.infer<typeof DesignerRecoverySchema>;

export function createDesignerRecovery(
  input: Omit<DesignerRecovery, "schemaVersion">
): DesignerRecovery {
  return DesignerRecoverySchema.parse({
    schemaVersion: "DesignerRecovery/v1",
    ...input,
  });
}
