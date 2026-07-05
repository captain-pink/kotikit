import type { UIQualityGateReport } from "../schemas/artifact.js";

type EvidenceSnapshot = Record<string, unknown>;
type ExpectedContentItem = Record<string, unknown>;

const TEXT_NODE_FIELDS = ["text", "characters", "label", "value", "copy"] as const;

/** Checks that required blueprint text is visible in recorded Figma text evidence. */
export function checkExpectedContent(
  expectedContent: ExpectedContentItem[],
  evidenceSnapshots: EvidenceSnapshot[]
): UIQualityGateReport["checks"][number] {
  const requiredTexts = expectedContent.flatMap(requiredTextFrom);
  if (requiredTexts.length === 0) {
    return result([]);
  }
  const evidenceTexts = evidenceSnapshots.flatMap(textEvidenceFromSnapshot).map(normalizeText);
  const findings = requiredTexts
    .filter((text) => !textAppearsInEvidence(text, evidenceTexts))
    .map((text) => `Missing expected content: ${text}`);
  return result(findings);
}

function result(findings: string[]): UIQualityGateReport["checks"][number] {
  return {
    id: "spec-expected-content",
    name: "Spec expected content",
    status: findings.length > 0 ? "blocked" : "passed",
    ...(findings.length > 0 ? { findings } : {}),
    ...(findings.length > 0
      ? {
          recommendedAction:
            "Add the missing blueprint text or control labels to the generated Figma frame before completing QA.",
        }
      : {}),
  };
}

// Returns required blueprint text while respecting explicit optional content.
function requiredTextFrom(item: ExpectedContentItem): string[] {
  if (item.required === false) return [];
  const text = stringField(item, "text");
  return text === undefined ? [] : [text];
}

// Extracts scanner text from explicit text fields, not generic Figma node names.
function textEvidenceFromSnapshot(snapshot: EvidenceSnapshot): string[] {
  return [
    ...stringArray(snapshot.texts),
    ...recordArray(snapshot.textNodes).flatMap(textEvidenceFromNode),
  ];
}

function textEvidenceFromNode(node: Record<string, unknown>): string[] {
  return TEXT_NODE_FIELDS.flatMap((field) => {
    const text = stringField(node, field);
    return text === undefined ? [] : [text];
  });
}

function textAppearsInEvidence(text: string, evidenceTexts: string[]): boolean {
  const expected = normalizeText(text);
  return evidenceTexts.some((candidate) => candidate === expected || candidate.includes(expected));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}
