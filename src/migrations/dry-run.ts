import { relative } from "node:path";
import {
  inspectProjectSchemaVersions,
  type SchemaArtifactFinding,
  type SchemaArtifactStatus,
  type SchemaInventory,
} from "./schema-inventory.js";

export interface MigrationDryRunReport {
  root: string;
  ok: boolean;
  wouldUpdate: number;
  blocking: number;
  inventory: SchemaInventory;
}

const statusLabel = (status: SchemaArtifactStatus): string => {
  if (status === "legacy-or-older") return "older";
  if (status === "future") return "future";
  if (status === "unreadable") return "unreadable";
  return "current";
};

const relativePath = (root: string, path: string): string =>
  relative(root, path).replaceAll("\\", "/");

const formatSchemaFinding = (root: string, finding: SchemaArtifactFinding): string => {
  const schemaVersion =
    finding.schemaVersion === null
      ? "no usable schemaVersion"
      : `schemaVersion ${finding.schemaVersion}`;
  return (
    `${statusLabel(finding.status)} ${finding.kind}: ${relativePath(root, finding.path)} ` +
    `(${schemaVersion}; latest ${finding.latestVersion}; ${finding.reason})`
  );
};

export const formatSchemaInventoryDetails = (
  root: string,
  inventory: SchemaInventory,
  maxFindings = 5
): string[] => {
  const nonCurrent = inventory.findings.filter((finding) => finding.status !== "current");
  const summary =
    `Checked ${inventory.checked} kotikit JSON artifact(s): ` +
    `${inventory.current} current, ${inventory.legacyOrOlder} older, ` +
    `${inventory.future} future, ${inventory.unreadable} unreadable.`;
  const findingLines = nonCurrent
    .slice(0, maxFindings)
    .map((finding) => formatSchemaFinding(root, finding));
  const remaining = nonCurrent.length - findingLines.length;
  return [
    summary,
    ...findingLines,
    ...(remaining > 0 ? [`${remaining} more schema finding(s) omitted.`] : []),
  ];
};

export async function runMigrationDryRun(root: string): Promise<MigrationDryRunReport> {
  const inventory = await inspectProjectSchemaVersions(root);
  const blocking = inventory.future + inventory.unreadable;
  return {
    root,
    ok: blocking === 0,
    wouldUpdate: inventory.legacyOrOlder,
    blocking,
    inventory,
  };
}

export function formatMigrationDryRunReport(report: MigrationDryRunReport): string {
  const title = report.ok
    ? "kotikit migrate --dry-run: ok"
    : "kotikit migrate --dry-run: action needed";
  const lines = [
    title,
    `Root: ${report.root}`,
    "",
    `Checked: ${report.inventory.checked} kotikit JSON artifact(s)`,
    `Current: ${report.inventory.current}`,
    `Would update lazily: ${report.wouldUpdate} older readable file(s)`,
    `Future-version files: ${report.inventory.future}`,
    `Unreadable files: ${report.inventory.unreadable}`,
  ];

  const nonCurrent = report.inventory.findings.filter((finding) => finding.status !== "current");
  if (nonCurrent.length > 0) {
    lines.push(
      "",
      "Files:",
      ...nonCurrent
        .slice(0, 20)
        .map((finding) => `  - ${formatSchemaFinding(report.root, finding)}`)
    );
    if (nonCurrent.length > 20) {
      lines.push(`  - ${nonCurrent.length - 20} more schema finding(s) omitted.`);
    }
  }

  if (report.blocking > 0) {
    lines.push(
      "",
      "Blocking issues:",
      "- Future-version files require updating kotikit before editing.",
      "- Unreadable files must be valid JSON before kotikit can inspect them."
    );
  }

  lines.push("", "No files changed.");
  return `${lines.join("\n")}\n`;
}
