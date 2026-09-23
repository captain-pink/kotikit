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

  it("keeps detailed low-confidence intent out of built-in pattern packs", () => {
    const userIntent =
      "Design a mocked Reports catalog with columns Title, Data source, Chart type, Owner, and Updated plus a sidebar, tabs, search, filters, and an empty state.";
    const envelope = buildUxEnvelope({
      userIntent,
      screen: {
        title: "Product Screen",
        confidence: "low",
        requiredUiParts: ["page shell", "content heading", "primary action"],
        states: ["loading", "empty", "error", "filled"],
      },
    });
    const matrix = buildStateMatrix({ envelope });

    expect(envelope).toMatchObject({
      screenArchetype: "unknown",
      confidence: "low",
      primaryGoal: userIntent,
      primaryTask: "Draft UI",
      dataModel: { primaryEntity: "unknown", fields: [] },
    });
    expect(matrix.states).toEqual([]);
    expect(JSON.stringify({ envelope, matrix })).not.toMatch(/members|invite/i);
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

  it("keeps distinct blueprint states when their kinds both normalize to custom", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create a mocked order board",
      explicitBlueprint: true,
      screen: { title: "Orders", states: ["archived", "pending-review", "filled"] },
    });
    const matrix = buildStateMatrix({
      envelope,
      requestedStates: [
        { id: "archived-orders", name: "Archived orders", kind: "archived" },
        { id: "pending-review", name: "Pending review", kind: "pending-review" },
        { id: "live-orders", name: "Live orders", kind: "filled" },
      ],
    });

    expect(matrix.states.map(({ id, label, kind, copy }) => ({ id, label, kind, copy }))).toEqual([
      {
        id: "archived-orders",
        label: "Archived orders",
        kind: "custom",
        copy: { title: "Archived orders" },
      },
      {
        id: "pending-review",
        label: "Pending review",
        kind: "custom",
        copy: { title: "Pending review" },
      },
      { id: "live-orders", label: "Live orders", kind: "filled", copy: { title: "Live orders" } },
    ]);
  });

  it("does not replace explicit blueprint states with pattern-pack defaults", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create the supplied mocked orders table",
      explicitBlueprint: true,
      screen: {
        title: "Orders",
        states: ["archived", "filled"],
        traits: { patternPackIds: ["admin-data-table"] },
      },
    });
    const matrix = buildStateMatrix({
      envelope,
      requestedStates: [{ kind: "archived" }, { kind: "filled" }],
      patternPack: adminDataTablePatternPack,
    });

    expect(envelope.edgeCases).toEqual(["archived", "filled"]);
    expect(matrix.states.map((state) => [state.label, state.kind])).toEqual([
      ["Archived", "custom"],
      ["Filled", "filled"],
    ]);
  });

  it("refuses duplicate explicit state ids instead of silently renaming them", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create a mocked order board",
      explicitBlueprint: true,
      screen: { title: "Orders", states: ["review", "approved"] },
    });

    expect(() =>
      buildStateMatrix({
        envelope,
        requestedStates: [
          { id: "review", kind: "pending-review" },
          { id: "review", kind: "approved" },
        ],
      })
    ).toThrow("Duplicate blueprint state id");
  });
});
