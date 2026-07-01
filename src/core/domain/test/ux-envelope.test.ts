import { describe, expect, it } from "bun:test";
import { buildStateMatrix, buildUxEnvelope, classifyScreenArchetype } from "../ux-envelope.js";
import { adminDataTablePatternPack } from "../ux-pattern-pack.js";

describe("UX envelope planning", () => {
  it("classifies admin members as a data-table screen", () => {
    expect(classifyScreenArchetype("Create Admin members page")).toBe("admin-data-table");
  });

  it("builds a source-grounded UX envelope", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create Admin members page",
      screen: {
        title: "Admin Members",
        requiredUiParts: ["members table", "invite member button"],
        states: ["filled", "loading", "empty", "error"],
      },
    });

    expect(envelope).toMatchObject({
      schemaVersion: "UXEnvelope/v1",
      screenArchetype: "admin-data-table",
      actor: "Workspace admin",
      primaryTask: "Manage members",
    });
    expect(envelope.sourceRefs).toContain("https://www.nngroup.com/articles/task-analysis/");
  });

  it("plans table states as region states instead of cards", () => {
    const matrix = buildStateMatrix({
      envelope: buildUxEnvelope({
        userIntent: "Create Admin members page",
        screen: {
          title: "Admin Members",
          requiredUiParts: ["members table"],
          states: ["filled", "loading", "empty", "no-results", "error", "permission"],
        },
      }),
      patternPack: adminDataTablePatternPack,
    });

    expect(matrix.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loading",
          scope: "region",
          replacementBehavior: "replace-table-body",
        }),
        expect.objectContaining({
          kind: "empty",
          scope: "region",
          replacementBehavior: "replace-region-content",
        }),
        expect.objectContaining({
          kind: "error",
          scope: "region",
          primaryAction: "Retry",
        }),
      ])
    );
  });

  it("keeps unknown screen archetypes on a generic fallback instead of admin-table defaults", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create a celebratory onboarding welcome screen",
      screen: { title: "Welcome" },
    });
    const matrix = buildStateMatrix({ envelope });

    expect(envelope).toMatchObject({
      screenArchetype: "unknown",
      actor: "Designer",
      primaryGoal: "Welcome",
      primaryTask: "Draft UI",
      edgeCases: [],
    });
    expect(matrix.states).toEqual([]);
  });
});
