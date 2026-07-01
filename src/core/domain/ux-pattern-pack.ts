import { z } from "zod";
import adminDataTable from "../ux-pattern-packs/admin-data-table.json" with { type: "json" };
import dashboardSummary from "../ux-pattern-packs/dashboard-summary.json" with { type: "json" };
import settingsForm from "../ux-pattern-packs/settings-form.json" with { type: "json" };

export const UXPatternPackStateSchema = z.strictObject({
  kind: z.enum([
    "filled",
    "loading",
    "empty",
    "no-results",
    "error",
    "permission",
    "success",
    "custom",
  ]),
  scope: z.enum(["page", "region", "component", "flow"]),
  affectedRegion: z.string().min(1).optional(),
  persistentRegions: z.array(z.string().min(1)).optional(),
  replacementBehavior: z.enum([
    "same-frame-variant",
    "replace-whole-page",
    "replace-region-content",
    "replace-table-body",
    "inline-feedback",
    "blocking-dialog",
  ]),
  requiredComponents: z.array(z.string().min(1)),
  primaryAction: z.string().min(1).optional(),
  secondaryAction: z.string().min(1).optional(),
  copy: z
    .strictObject({
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
    })
    .optional(),
  sourceRefs: z.array(z.string().url()),
});

const UXPatternPackEnvelopeDefaultsSchema = z.strictObject({
  confidence: z.enum(["observed", "inferred", "low"]),
  actor: z.string().min(1),
  primaryGoal: z.string().min(1),
  primaryTask: z.string().min(1),
  secondaryTasks: z.array(z.string().min(1)),
  dataModel: z.strictObject({
    primaryEntity: z.string().min(1),
    expectedVolume: z.enum(["zero", "one", "few", "many", "unknown"]),
    fields: z.array(z.string().min(1)),
  }),
  permissions: z.array(z.string().min(1)),
  edgeCases: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
});

export const UXPatternPackSchema = z.strictObject({
  schemaVersion: z.literal("UXPatternPack/v1"),
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  appliesTo: z.array(z.string().min(1)),
  intentKeywords: z.array(z.string().min(1)).optional(),
  envelopeDefaults: UXPatternPackEnvelopeDefaultsSchema.optional(),
  defaultStates: z.array(UXPatternPackStateSchema),
  componentRoles: z.array(z.string().min(1)),
  layoutRules: z.array(z.string().min(1)),
  qaRules: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().url()),
});

export type UXPatternPack = z.infer<typeof UXPatternPackSchema>;
export type UXPatternPackState = z.infer<typeof UXPatternPackStateSchema>;

export const adminDataTablePatternPack = UXPatternPackSchema.parse(adminDataTable);
export const dashboardSummaryPatternPack = UXPatternPackSchema.parse(dashboardSummary);
export const settingsFormPatternPack = UXPatternPackSchema.parse(settingsForm);
const genericScreenPatternPack = UXPatternPackSchema.parse({
  schemaVersion: "UXPatternPack/v1",
  id: "generic-screen",
  version: "1.0.0",
  title: "Generic screen",
  appliesTo: ["unknown"],
  defaultStates: [],
  componentRoles: [],
  layoutRules: [],
  qaRules: [],
  sourceRefs: ["https://www.nngroup.com/articles/task-analysis/"],
});

export const builtInPatternPacks = [
  adminDataTablePatternPack,
  dashboardSummaryPatternPack,
  settingsFormPatternPack,
  genericScreenPatternPack,
] as const;

export function selectPatternPack(archetype: string): UXPatternPack {
  return (
    builtInPatternPacks.find((pack) => pack.appliesTo.includes(archetype)) ??
    genericScreenPatternPack
  );
}
