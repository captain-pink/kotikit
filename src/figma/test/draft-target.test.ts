import { describe, expect, it } from "bun:test";
import {
  buildKotikitSectionName,
  FigmaDraftTargetSchema,
  isDraftPageName,
  parseFigmaDesignUrl,
} from "../draft-target.js";

describe("parseFigmaDesignUrl", () => {
  it("extracts file key, node id, and normalized page URL from design URLs", () => {
    const parsed = parseFigmaDesignUrl(
      "https://www.figma.com/design/FILE123/Product-App?node-id=12-34&m=auto"
    );

    expect(parsed).toEqual({
      fileKey: "FILE123",
      nodeId: "12:34",
      pageUrl: "https://www.figma.com/design/FILE123/Product-App?node-id=12-34",
    });
  });

  it("extracts the branch key for branch URLs", () => {
    const parsed = parseFigmaDesignUrl(
      "https://www.figma.com/design/FILE123/branch/BRANCH456/Product-App?node-id=0-1"
    );

    expect(parsed.fileKey).toBe("BRANCH456");
    expect(parsed.nodeId).toBe("0:1");
  });

  it("rejects URLs without node-id", () => {
    expect(() => parseFigmaDesignUrl("https://www.figma.com/design/FILE123/Product-App")).toThrow(
      /page URL/
    );
  });

  it("rejects non-Figma design URLs", () => {
    expect(() => parseFigmaDesignUrl("https://example.com/design/FILE123/App?node-id=1-2")).toThrow(
      /Figma design URL/
    );
  });
});

describe("isDraftPageName", () => {
  it("accepts draft as a standalone word", () => {
    expect(isDraftPageName("Draft - Members")).toBe(true);
    expect(isDraftPageName("Kotikit Drafts")).toBe(true);
    expect(isDraftPageName("2026 draft review")).toBe(true);
  });

  it("rejects production-like names and unrelated words containing draft", () => {
    expect(isDraftPageName("Members")).toBe(false);
    expect(isDraftPageName("Ready for dev")).toBe(false);
    expect(isDraftPageName("redrafting notes")).toBe(false);
  });
});

describe("FigmaDraftTargetSchema", () => {
  it("parses a target with strict safety defaults", () => {
    const parsed = FigmaDraftTargetSchema.parse({
      fileKey: "file",
      pageId: "0:1",
      pageName: "Draft - Members",
      pageUrl: "https://www.figma.com/design/file/App?node-id=0-1",
      boundAt: "2026-06-22T00:00:00.000Z",
      source: "user-url",
      section: { name: "kotikit / members / 2026-06-22" },
    });

    expect(parsed.safety).toEqual({
      requireDraftPageName: true,
      allowPageCreation: false,
      requireKotikitSection: true,
    });
  });
});

describe("buildKotikitSectionName", () => {
  it("builds stable section names for single screens and flow screens", () => {
    expect(
      buildKotikitSectionName({
        scope: "members",
        screen: null,
        date: "2026-06-22",
      })
    ).toBe("kotikit / members / 2026-06-22");

    expect(
      buildKotikitSectionName({
        scope: "checkout-flow",
        screen: "cart",
        date: "2026-06-22",
      })
    ).toBe("kotikit / checkout-flow / cart / 2026-06-22");
  });
});
