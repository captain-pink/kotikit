import { describe, expect, it } from "bun:test";
import type { FigmaDraftTarget } from "../../../../figma/draft-target.js";
import type {
  CanvasPlan,
  FigmaTransactionPlan,
  LayoutContract,
  VariableBindingPlan,
} from "../../../schemas/artifact.js";
import { buildFigmaApplyPacket } from "../apply-packet.js";

describe("buildFigmaApplyPacket", () => {
  it("carries validated blueprint UI parts and expected content into the packet", () => {
    const blueprintRequirements = {
      requiredUiParts: [
        { id: "reports-table", name: "Reports table", role: "data table", regionId: "reports" },
      ],
      expectedContent: [
        { kind: "column-label" as const, text: "Title", required: true },
        { kind: "column-label" as const, text: "Data source", required: true },
      ],
    };
    const packet = buildFigmaApplyPacket({
      target: draftTarget(),
      screenTitle: "Mock Reports",
      blueprintRequirements,
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "reports-table",
            name: "Reports table",
            role: "data table",
            source: "screen-draft",
            draftComponentId: "reports-table",
          },
        ],
      },
      layoutContract: layoutContract(),
      variableBindingPlan: variableBindingPlan(),
      canvasPlan: canvasPlan(),
      transactionPlan: transactionPlan(),
    });

    expect(packet.blueprintRequirements).toEqual(blueprintRequirements);
  });

  it("passes through explicit icon affordances from the UI composition contract", () => {
    const packet = buildFigmaApplyPacket({
      target: draftTarget(),
      screenTitle: "Members",
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "invite-member-button",
            name: "Invite member",
            role: "primary-action",
            source: "existing-component",
            componentKey: "button-key",
            iconAffordances: [
              {
                id: "invite-member-icon",
                semantic: "add-user",
                source: "local-design-system",
                iconKey: "icon-add-user-key",
                required: true,
                reason: "The primary action benefits from a leading action icon.",
              },
            ],
          },
        ],
      },
      layoutContract: layoutContract(),
      variableBindingPlan: variableBindingPlan(),
      canvasPlan: canvasPlan(),
      transactionPlan: transactionPlan(),
    });

    expect(packet.iconRequirements).toEqual([
      {
        id: "invite-member-icon",
        semantic: "add-user",
        source: "local-design-system",
        iconKey: "icon-add-user-key",
        required: true,
        reason: "The primary action benefits from a leading action icon.",
        partId: "invite-member-button",
      },
    ]);
  });

  it("does not infer icon requirements from part names, roles, or placement labels", () => {
    const packet = buildFigmaApplyPacket({
      target: draftTarget(),
      screenTitle: "Members",
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "search-input",
            name: "Search members",
            role: "search",
            placement: "top-bar",
            source: "existing-component",
            componentKey: "search-key",
          },
          {
            id: "invite-member-button",
            name: "Invite member primary action",
            role: "primary-action",
            source: "existing-component",
            componentKey: "button-key",
          },
        ],
      },
      layoutContract: layoutContract(),
      variableBindingPlan: variableBindingPlan(),
      canvasPlan: canvasPlan(),
      transactionPlan: transactionPlan(),
    });

    expect(packet.iconRequirements).toEqual([]);
  });

  it("requires lightweight screenshot review for visible Figma transactions", () => {
    const packet = buildFigmaApplyPacket({
      target: draftTarget(),
      screenTitle: "Members",
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "search-input",
            name: "Search members",
            role: "search",
            placement: "top-bar",
            source: "existing-component",
            componentKey: "search-key",
          },
        ],
      },
      layoutContract: layoutContract(),
      variableBindingPlan: variableBindingPlan(),
      canvasPlan: canvasPlan(),
      transactionPlan: transactionPlan(),
    });

    expect(packet.visualReview).toMatchObject({
      required: true,
      method: "screenshot",
      instructions: expect.stringContaining("screenshot"),
    });
    expect(packet.metadata).toMatchObject({ requiresScreenshotReview: true });
  });

  it("describes visible existing-component proof and compact scanner output", () => {
    const packet = buildFigmaApplyPacket({
      target: draftTarget(),
      screenTitle: "Members",
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "content-heading",
            name: "content heading",
            role: "content",
            source: "existing-component",
            componentKey: "heading-key",
          },
        ],
      },
      layoutContract: layoutContract(),
      variableBindingPlan: variableBindingPlan(),
      canvasPlan: canvasPlan(),
      transactionPlan: transactionPlan(),
    });

    expect(packet.evidenceChecklist.existingComponents).toEqual([
      {
        partId: "content-heading",
        partName: "content heading",
        componentKey: "heading-key",
        expectedNodeKind: "INSTANCE",
        mustBeVisible: true,
        evidenceOnlyAllowed: false,
      },
    ]);
    expect(packet.evidenceChecklist.scannerOutput).toMatchObject({
      schemaVersion: "FigmaEvidenceSnapshot/v1",
      arrays: ["parts", "componentInstances", "layoutFrames", "icons"],
    });
  });
});

function draftTarget(): FigmaDraftTarget {
  return {
    fileKey: "FILE",
    pageId: "1:2",
    pageName: "Draft - Members",
    pageUrl: "https://www.figma.com/design/FILE/Name?node-id=1-2",
    boundAt: "2026-06-30T00:00:00.000Z",
    source: "user-url" as const,
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    safety: {
      requireDraftPageName: true,
      allowPageCreation: false,
      requireKotikitSection: true,
    },
  };
}

function layoutContract(): LayoutContract {
  return {
    schemaVersion: "LayoutContract/v1" as const,
    strategy: "auto-layout" as const,
    frames: [
      { id: "root", name: "Root", mode: "auto-layout" as const, direction: "vertical" as const },
    ],
  };
}

function variableBindingPlan(): VariableBindingPlan {
  return {
    schemaVersion: "VariableBindingPlan/v1" as const,
    bindings: [],
  };
}

function canvasPlan(): CanvasPlan {
  return {
    schemaVersion: "CanvasPlan/v1" as const,
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    coordinateSpace: "section-relative" as const,
    screenSize: { width: 1440, height: 900 },
    minGap: 160,
    sectionStyle: {
      background: {
        color: "AED0FF",
        opacity: 0.1,
      },
    },
    zones: [
      {
        id: "zone-screen-states",
        kind: "screen-states" as const,
        label: "Screen states",
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
    ],
    placements: [
      {
        id: "state-filled",
        kind: "screen-state" as const,
        stateId: "filled",
        label: "Members / Filled",
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        parentZoneId: "zone-screen-states",
        transactionId: "txn-state-filled",
      },
    ],
    strategy: {
      primaryFirst: true,
      creationOrder: ["state-filled"],
      designerNotes: ["Create one screen at the planned placement."],
    },
  };
}

function transactionPlan(): FigmaTransactionPlan {
  return {
    schemaVersion: "FigmaTransactionPlan/v1" as const,
    mode: "incremental-official-figma-mcp" as const,
    transactions: [
      {
        id: "txn-state-filled",
        order: 1,
        kind: "create-screen-state" as const,
        label: "Members / Filled",
        placementId: "state-filled",
        stateId: "filled",
        status: "pending" as const,
        requiredMetadata: [
          "node-id",
          "bounds",
          "auto-layout",
          "component-refs",
          "component-source",
          "icon-refs",
          "variable-refs",
        ],
      },
    ],
  };
}
