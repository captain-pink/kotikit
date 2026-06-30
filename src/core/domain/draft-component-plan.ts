import type { DraftComponentPlan } from "../schemas/artifact.js";

export function buildDraftComponentPlan(missingParts: string[]): DraftComponentPlan {
  return {
    schemaVersion: "DraftComponentPlan/v1",
    sectionName: "Kotikit Draft Components",
    components: missingParts.map((part) => ({
      id: `draft-${slug(part)}`,
      name: part,
      reason: "No existing design-system component matched this meaningful UI part.",
      states: ["default", "hover", "disabled"],
      requiredParts: requiredPartsFor(part),
    })),
  };
}

function requiredPartsFor(part: string): string[] {
  const normalized = part.toLowerCase();
  if (normalized.includes("table")) return ["container", "header row", "data row", "cell"];
  if (normalized.includes("list")) return ["container", "item row", "cell"];
  return ["container", "label", "state"];
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "component"
  );
}
