import { describe, expect, it } from "bun:test";
import type { GateRunReport } from "./gate-output.js";
import { formatGateReport } from "./gate-report.js";

function passReport(): GateRunReport {
  return {
    ranAt: "2026-05-29T10:00:00.000Z",
    totalDurationMs: 1000,
    passed: true,
    results: [
      { gate: "tsc", passed: true, exitCode: 0, durationMs: 500, failures: [], raw: "" },
      { gate: "eslint", passed: true, exitCode: 0, durationMs: 200, failures: [], raw: "" },
      { gate: "prettier", passed: true, exitCode: 0, durationMs: 150, failures: [], raw: "" },
      { gate: "vitest", passed: true, exitCode: 0, durationMs: 150, failures: [], raw: "" },
    ],
  };
}

function mixedReport(): GateRunReport {
  return {
    ranAt: "2026-05-29T10:00:00.000Z",
    totalDurationMs: 2000,
    passed: false,
    results: [
      { gate: "tsc", passed: true, exitCode: 0, durationMs: 500, failures: [], raw: "" },
      {
        gate: "eslint",
        passed: false,
        exitCode: 1,
        durationMs: 400,
        failures: [
          {
            file: "src/components/checkout-flow/Cart.tsx",
            line: 14,
            column: 3,
            message: "Form labels must have associated controls",
            rule: "jsx-a11y/label-has-associated-control",
          },
          {
            file: "src/components/checkout-flow/Cart.tsx",
            line: 22,
            column: 9,
            message: "Buttons must have discernible text",
            rule: "jsx-a11y/button-has-name",
          },
        ],
        raw: "",
      },
      { gate: "prettier", passed: true, exitCode: 0, durationMs: 150, failures: [], raw: "" },
      { gate: "vitest", passed: true, exitCode: 0, durationMs: 950, failures: [], raw: "" },
    ],
  };
}

describe("formatGateReport", () => {
  it("all pass: clean one-line summary", () => {
    const text = formatGateReport(passReport());
    expect(text).toContain("4 of 4 passed");
    expect(text).toContain("tsc");
    expect(text).toContain("vitest");
    expect(text).not.toContain("failed");
  });

  it("mixed: summary line + failure block per failing gate", () => {
    const text = formatGateReport(mixedReport());
    expect(text).toContain("3 of 4 passed");
    expect(text).toContain("1 failed");
    expect(text).toContain("eslint:");
    expect(text).toContain("Cart.tsx:14:3");
    expect(text).toContain("jsx-a11y/label-has-associated-control");
    expect(text).toContain("Cart.tsx:22:9");
  });

  it("failure with no parsed failures falls back to raw output", () => {
    const report: GateRunReport = {
      ranAt: "x",
      totalDurationMs: 0,
      passed: false,
      results: [
        {
          gate: "tsc",
          passed: false,
          exitCode: 2,
          durationMs: 100,
          failures: [],
          raw: "Cannot find module 'foo'.",
        },
      ],
    };
    const text = formatGateReport(report);
    expect(text).toContain("exited with code 2");
    expect(text).toContain("Cannot find module 'foo'.");
  });

  it("no-results edge case", () => {
    const report: GateRunReport = {
      ranAt: "x",
      totalDurationMs: 0,
      passed: true,
      results: [],
    };
    const text = formatGateReport(report);
    expect(text).toContain("0 of 0 passed");
  });

  it("failure without line/column shows the file only", () => {
    const report: GateRunReport = {
      ranAt: "x",
      totalDurationMs: 0,
      passed: false,
      results: [
        {
          gate: "prettier",
          passed: false,
          exitCode: 1,
          durationMs: 50,
          failures: [{ file: "src/Cart.tsx", message: "Code style issues found by prettier" }],
          raw: "",
        },
      ],
    };
    const text = formatGateReport(report);
    expect(text).toContain("src/Cart.tsx");
    expect(text).toContain("Code style issues found by prettier");
    expect(text).not.toContain(":undefined");
  });
});
