import { describe, expect, it } from "bun:test";
import type { GateResult, GateRunReport } from "./gate-output.js";

describe("gate-output types", () => {
  it("a literal GateResult value satisfies the interface", () => {
    const result: GateResult = {
      gate: "tsc",
      passed: true,
      exitCode: 0,
      durationMs: 123,
      failures: [],
      raw: "",
    };
    expect(result.gate).toBe("tsc");
    expect(result.passed).toBe(true);
  });

  it("GateResult with failures populated", () => {
    const result: GateResult = {
      gate: "eslint",
      passed: false,
      exitCode: 1,
      durationMs: 250,
      failures: [
        {
          file: "src/components/Cart.tsx",
          line: 14,
          column: 3,
          rule: "jsx-a11y/label-has-associated-control",
          message: "Form labels must have associated controls",
        },
      ],
      raw: "src/components/Cart.tsx:14:3 error ...",
    };
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rule).toBe("jsx-a11y/label-has-associated-control");
  });

  it("a literal GateRunReport satisfies the interface", () => {
    const report: GateRunReport = {
      ranAt: "2026-05-29T10:00:00.000Z",
      totalDurationMs: 1234,
      passed: true,
      results: [
        { gate: "tsc", passed: true, exitCode: 0, durationMs: 500, failures: [], raw: "" },
        { gate: "eslint", passed: true, exitCode: 0, durationMs: 400, failures: [], raw: "" },
        { gate: "prettier", passed: true, exitCode: 0, durationMs: 200, failures: [], raw: "" },
        { gate: "vitest", passed: true, exitCode: 0, durationMs: 134, failures: [], raw: "" },
      ],
    };
    expect(report.results).toHaveLength(4);
    expect(report.passed).toBe(true);
  });

  it("an all-required-pass report sets passed: true", () => {
    const report: GateRunReport = {
      ranAt: "2026-05-29T10:00:00.000Z",
      totalDurationMs: 100,
      passed: true,
      results: [{ gate: "tsc", passed: true, exitCode: 0, durationMs: 100, failures: [], raw: "" }],
    };
    expect(report.passed).toBe(true);
  });
});
