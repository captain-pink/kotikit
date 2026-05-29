import { z } from "zod";

export const CodePlanStepKindSchema = z.enum([
  "scaffold-component",     // create the screen-level component file
  "compose-states",         // add loading/empty/error/filled state branches
  "compose-interactions",   // wire event handlers, validation
  "compose-accessibility",  // explicit a11y attrs / focus management
  "compose-responsive",     // breakpoint behavior
  "generate-test",          // emit the *.test.tsx
]);
export type CodePlanStepKind = z.infer<typeof CodePlanStepKindSchema>;

export const CodePlanStepSchema = z.object({
  kind: CodePlanStepKindSchema,
  title: z.string(),
  notes: z.array(z.string()).default([]),
});
export type CodePlanStep = z.infer<typeof CodePlanStepSchema>;

export const CodePlanSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  screen: z.string().optional(),      // omitted for single-screen scopes
  componentName: z.string(),          // PascalCase
  targetPath: z.string(),             // relative-to-project-root path
  testPath: z.string().optional(),    // omitted when tests off
  dsComponentRefs: z
    .array(
      z.object({
        name: z.string(),
        dsKey: z.string().optional(),
      })
    )
    .default([]),
  steps: z.array(CodePlanStepSchema).min(1),
  createdAt: z.string(),
});
export type CodePlan = z.infer<typeof CodePlanSchema>;

export function parseCodePlan(raw: unknown): CodePlan {
  const result = CodePlanSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues
      .map((i) => i.path.join(".") || "root")
      .join(", ");
    throw new Error(
      `This code plan has an invalid format. Problem with: ${fields}.`
    );
  }
  return result.data;
}
