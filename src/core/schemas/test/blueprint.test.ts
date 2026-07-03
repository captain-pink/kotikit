import { describe, expect, it } from "bun:test";
import {
  CanvasIntentInputSchema,
  ExistingDesignInventoryInputSchema,
  FlowBlueprintInputSchema,
  primaryScreenFromFlowBlueprint,
  ScreenBlueprintInputSchema,
} from "../blueprint.js";

describe("blueprint input schemas", () => {
  it("parses a screen blueprint with semantic UI parts", () => {
    const parsed = ScreenBlueprintInputSchema.parse({
      schemaVersion: "ScreenBlueprintInput/v1",
      id: "events",
      title: "Events Experience",
      productDomain: "Mock Operations",
      requiredUiParts: [
        {
          id: "event-stream",
          name: "Event stream",
          role: "timeline",
          regionId: "activity",
          variableRoles: [{ property: "text", semanticRole: "timeline label" }],
        },
        {
          id: "detail-panel",
          name: "Detail panel",
          role: "context panel",
        },
      ],
      traits: {
        regions: [{ id: "activity", name: "Activity", kind: "timeline" }],
        stateScopes: [{ id: "screen", name: "Screen", kind: "page" }],
        repeatedPatterns: [{ id: "events", name: "Event items", kind: "events" }],
      },
    });

    expect(parsed.title).toBe("Events Experience");
    expect(parsed.productDomain).toBe("Mock Operations");
    expect(parsed.requiredUiParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "event-stream",
          role: "timeline",
          variableRoles: [{ property: "text", semanticRole: "timeline label" }],
        }),
      ])
    );
    expect(parsed.traits?.regions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "timeline" })])
    );
    expect(parsed.traits?.repeatedPatterns).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "events" })])
    );
  });

  it("rejects duplicate screen blueprint part ids", () => {
    expect(() =>
      ScreenBlueprintInputSchema.parse({
        schemaVersion: "ScreenBlueprintInput/v1",
        title: "Events Experience",
        requiredUiParts: [
          { id: "duplicate", name: "Timeline" },
          { id: "duplicate", name: "Detail panel" },
        ],
      })
    ).toThrow("Duplicate blueprint UI part id");
  });

  it("selects the explicit primary screen from a flow blueprint", () => {
    const flow = FlowBlueprintInputSchema.parse({
      schemaVersion: "FlowBlueprintInput/v1",
      title: "Mock Events Flow",
      primaryScreenId: "detail",
      screens: [
        {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "events",
          title: "Events Experience",
          requiredUiParts: [{ id: "timeline", name: "Timeline" }],
        },
        {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "detail",
          title: "Event Detail",
          requiredUiParts: [{ id: "summary", name: "Summary" }],
        },
      ],
    });

    expect(primaryScreenFromFlowBlueprint(flow)).toMatchObject({
      id: "detail",
      title: "Event Detail",
    });
  });

  it("requires replacement canvas targets to identify a node", () => {
    expect(() =>
      CanvasIntentInputSchema.parse({
        mode: "replace-existing-frame",
        targetFrame: { name: "Existing Events Frame" },
      })
    ).toThrow("nodeId");
  });

  it("parses compact existing design inventory for non-kotikit Figma pages", () => {
    expect(
      ExistingDesignInventoryInputSchema.parse({
        schemaVersion: "ExistingDesignInventoryInput/v1",
        source: "figma-scan",
        fileKey: "FILE",
        pageId: "1:2",
        pageName: "Mock Existing Page",
        targets: [
          {
            nodeId: "12:34",
            name: "Events Frame",
            kind: "frame",
            role: "primary screen",
            screenId: "events",
            bounds: { x: 0, y: 0, width: 1280, height: 720 },
            detectedTraits: {
              regions: [{ id: "activity", name: "Activity", kind: "timeline" }],
              repeatedPatterns: [{ id: "event-items", name: "Event items", kind: "events" }],
            },
            componentRefs: ["local-card-key"],
            variableRefs: ["local-color-bg"],
          },
        ],
      })
    ).toMatchObject({
      source: "figma-scan",
      targets: [expect.objectContaining({ nodeId: "12:34", screenId: "events" })],
    });
  });
});
