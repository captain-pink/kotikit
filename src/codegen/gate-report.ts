import type { GateResult, GateRunReport } from "./gate-output.js";

/**
 * Render a GateRunReport as plain text suitable for an MCP tool's text reply.
 *
 * Example output (all-pass):
 *   "Gates: 4 of 4 passed (tsc, eslint, prettier, vitest)."
 *
 * Example output (one fail):
 *   "Gates: 3 of 4 passed (tsc, prettier, vitest). 1 failed (eslint).
 *
 *    eslint:
 *      src/components/checkout-flow/Cart.tsx:14:3  error  Form labels must have associated controls  jsx-a11y/label-has-associated-control
 *      src/components/checkout-flow/Cart.tsx:22:9  error  Buttons must have discernible text         jsx-a11y/button-has-name"
 */
export function formatGateReport(report: GateRunReport): string {
  const passed = report.results.filter((r) => r.passed);
  const failed = report.results.filter((r) => !r.passed);

  const summaryParts: string[] = [];
  summaryParts.push(
    `Gates: ${passed.length} of ${report.results.length} passed (${passed.map((r) => r.gate).join(", ") || "none"}).`
  );
  if (failed.length > 0) {
    summaryParts.push(`${failed.length} failed (${failed.map((r) => r.gate).join(", ")}).`);
  }
  const summary = summaryParts.join(" ");

  if (failed.length === 0) return summary;

  const details: string[] = [summary, ""];
  for (const result of failed) {
    details.push(`${result.gate}:`);
    if (result.failures.length === 0) {
      details.push(`  exited with code ${result.exitCode}, no parsed failures. Raw output:`);
      const raw = result.raw.trim();
      if (raw) {
        for (const ln of raw.split("\n").slice(0, 20)) details.push(`  ${ln}`);
      }
    } else {
      for (const f of result.failures) {
        details.push(`  ${formatFailure(f)}`);
      }
    }
    details.push("");
  }
  return details.join("\n").trimEnd();
}

function formatFailure(f: GateResult["failures"][number]): string {
  const loc = f.file
    ? f.line != null && f.column != null
      ? `${f.file}:${f.line}:${f.column}`
      : f.file
    : "(unknown)";
  const rule = f.rule ? `  ${f.rule}` : "";
  return `${loc}  error  ${f.message}${rule}`;
}
