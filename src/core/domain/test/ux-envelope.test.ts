import { describe, expect, it } from "bun:test";
import { buildStateMatrix, buildUxEnvelope, classifyScreenArchetype } from "../ux-envelope.js";
import { adminDataTablePatternPack } from "../ux-pattern-pack.js";

describe("UX envelope planning", () => {
  it("classifies explicit table fallback prompts as data-table screens", () => {
    expect(classifyScreenArchetype("Create members table page")).toBe("admin-data-table");
  });

  it("does not classify admin dashboard wording alone as an admin data table", () => {
    expect(classifyScreenArchetype("Create an admin dashboard for mocked metrics")).not.toBe(
      "admin-data-table"
    );
  });

  it("builds a source-grounded UX envelope for explicit table prompts", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create members table page",
      screen: {
        title: "Members Table",
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

  it("keeps blueprint traits generic unless a pattern pack is explicitly selected", () => {
    const envelope = buildUxEnvelope({
      userIntent:
        "Create a mocked Events Experience. Domain references include admin and onboarding words.",
      screen: {
        title: "Events Experience",
        requiredUiParts: ["Event stream", "Detail panel"],
        states: ["filled", "loading", "error"],
        traits: {
          regions: [{ id: "activity", name: "Activity", kind: "timeline" }],
          stateScopes: [{ id: "page", name: "Page", kind: "page" }],
          repeatedPatterns: [{ id: "events", name: "Event items", kind: "events" }],
        },
      },
    });

    expect(envelope).toMatchObject({
      screenArchetype: "unknown",
      confidence: "low",
      primaryGoal: "Events Experience",
      traits: {
        regions: [expect.objectContaining({ kind: "timeline", name: "Activity" })],
        repeatedPatterns: [expect.objectContaining({ kind: "events" })],
      },
    });
  });

  it("uses an explicitly selected local pattern pack id", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create the supplied mock screen blueprint.",
      screen: {
        title: "Members Table",
        requiredUiParts: ["members table"],
        traits: {
          patternPackIds: ["admin-data-table"],
        },
      },
    });

    expect(envelope).toMatchObject({
      screenArchetype: "admin-data-table",
      patternPackIds: ["admin-data-table"],
    });
  });

  it("plans table states as region states instead of cards", () => {
    const matrix = buildStateMatrix({
      envelope: buildUxEnvelope({
        userIntent: "Create members table page",
        screen: {
          title: "Members Table",
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

  it("keeps unknown screen archetypes on generic requested states instead of admin-table defaults", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create a celebratory onboarding welcome screen",
      screen: { title: "Welcome", states: ["filled", "loading", "error"] },
    });
    const matrix = buildStateMatrix({ envelope });

    expect(envelope).toMatchObject({
      screenArchetype: "unknown",
      actor: "Designer",
      primaryGoal: "Welcome",
      primaryTask: "Draft UI",
      edgeCases: ["filled", "loading", "error"],
    });
    expect(matrix.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "filled", scope: "page" }),
        expect.objectContaining({ kind: "loading", scope: "page" }),
        expect.objectContaining({ kind: "error", scope: "page" }),
      ])
    );
  });
});
