import { describe, expect, it } from "bun:test";
import { verifyFigmaEvidenceAgainstApplyPacket } from "../figma-evidence.js";

describe("verifyFigmaEvidenceAgainstApplyPacket", () => {
  it("explains when a planned DS component was hand-built as text", () => {
    expect(() =>
      verifyFigmaEvidenceAgainstApplyPacket({
        packet: {
          uiComposition: {
            parts: [
              {
                id: "content-heading",
                name: "content heading",
                source: "existing-component",
                componentKey: "heading-key",
              },
            ],
          },
          iconRequirements: [],
        },
        evidenceSnapshots: [
          {
            schemaVersion: "FigmaEvidenceSnapshot/v1",
            parts: [
              {
                partId: "content-heading",
                id: "3:3746",
                name: "Page title",
                kind: "TEXT",
                visible: true,
                opacity: 1,
                insideRoot: true,
                bounds: { x: 300, y: 48, width: 240, height: 44 },
              },
            ],
          },
        ],
      })
    ).toThrow(
      'Figma evidence found "Page title" as TEXT for "content heading", but expected a visible INSTANCE of local design-system component key "heading-key".'
    );
  });

  it("reads componentInstances from the compact scanner output", () => {
    expect(() =>
      verifyFigmaEvidenceAgainstApplyPacket({
        packet: {
          uiComposition: {
            parts: [
              {
                id: "content-heading",
                name: "content heading",
                source: "existing-component",
                componentKey: "heading-key",
              },
            ],
          },
          iconRequirements: [],
        },
        evidenceSnapshots: [
          {
            schemaVersion: "FigmaEvidenceSnapshot/v1",
            componentInstances: [
              {
                partId: "content-heading",
                id: "3:4000",
                name: "Content heading",
                kind: "INSTANCE",
                componentSource: "existing-component",
                componentRefs: ["heading-key"],
                visible: true,
                opacity: 1,
                insideRoot: true,
                bounds: { x: 300, y: 48, width: 360, height: 72 },
              },
            ],
          },
        ],
      })
    ).not.toThrow();
  });
});
