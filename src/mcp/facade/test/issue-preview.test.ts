import { describe, expect, it } from "bun:test";
import { buildIssuePreview } from "../issue-preview.js";

describe("buildIssuePreview", () => {
  it("builds a bug issue URL from a generalized maintainer brief", () => {
    const result = buildIssuePreview({
      kind: "bug",
      summary: "Figma apply recovery fails after rejected metadata",
      userGoal: "Create a multi-state admin screen with a local design system.",
      observedProblem: "The workflow could not recover after apply metadata was rejected.",
      desiredBehavior:
        "Kotikit should keep the active transaction repairable and explain the next recovery step.",
      impact: "The designer had to restart the flow and repeat context.",
      workflowArea: "figma-apply",
      diagnostics: {
        kotikitVersion: "0.1.0",
        runtime: "bun",
        platform: "darwin",
        arch: "arm64",
        run: {
          status: "waiting-for-figma",
          flowId: "create-screen",
          flowVersion: "1.0.0",
          graphHash: "hash",
          artifactCounts: { "design-brief": 1, "figma-apply-report": 1 },
        },
        doctor: [{ id: "design-system", status: "ok" }],
      },
    });

    expect(result.title).toBe("Bug: Figma apply recovery fails after rejected metadata");
    expect(
      result.githubIssueUrl.startsWith("https://github.com/captain-pink/kotikit/issues/new?")
    ).toBe(true);
    expect(result.githubIssueUrl).toContain("labels=bug");
    expect(result.bodyPreview).toContain("## User goal");
    expect(result.bodyPreview).toContain("## Sanitized diagnostics");
    expect(result.bodyPreview).toContain("Flow: create-screen@1.0.0");
    expect(result.bodyPreview).toContain("Artifact counts: design-brief=1, figma-apply-report=1");
    expect(result.redactions).toContain("raw project/product/customer details");
    expect(result.warnings).toEqual([]);
  });

  it("builds a feature request URL with minimal diagnostics", () => {
    const result = buildIssuePreview({
      kind: "feature",
      summary: "Show a clearer recovery action when Figma apply fails",
      userGoal: "Improve recovery guidance for design draft creation.",
      desiredBehavior: "Kotikit should explain the next action in product language.",
      workflowArea: "figma-apply",
    });

    expect(result.title).toBe("Feature: Show a clearer recovery action when Figma apply fails");
    expect(result.githubIssueUrl).toContain("labels=feature");
    expect(result.bodyPreview).toContain("## Suggested behavior");
    expect(result.bodyPreview).not.toContain("## Sanitized diagnostics");
  });

  it("redacts sensitive terms and obvious secret-bearing values", () => {
    const result = buildIssuePreview({
      kind: "bug",
      summary: "Acme Payroll onboarding broke for Jane Doe",
      userGoal:
        "Create an Acme Payroll onboarding screen from /Users/alice/work/acme using customer Jane Doe.",
      observedProblem:
        "The assistant tried to reuse https://www.figma.com/design/ABC123/Payroll?node-id=1-2 and exposed figd_secret_123.",
      desiredBehavior: "Keep the report generalized for Acme Payroll.",
      workflowArea: "planning",
      sensitiveTerms: ["Acme Payroll", "Acme", "Jane Doe"],
      diagnostics: {
        runtime: "bun",
        platform: "darwin",
        arch: "arm64",
        run: {
          status: "done",
          flowId: "create-screen",
          flowVersion: "1.0.0",
          graphHash: "ABC123",
          artifactCounts: { "design-brief": 1 },
        },
      },
    });

    const combined = `${result.title}\n${result.bodyPreview}\n${decodeURIComponent(
      result.githubIssueUrl
    )}`;
    expect(combined).not.toContain("Acme");
    expect(combined).not.toContain("Jane Doe");
    expect(combined).not.toContain("/Users/alice");
    expect(combined).not.toContain("figd_secret");
    expect(combined).not.toContain("ABC123");
    expect(result.redactions).toEqual(
      expect.arrayContaining([
        "assistant-provided sensitive terms",
        "absolute paths",
        "figma urls",
        "token-like values",
      ])
    );
  });
});
