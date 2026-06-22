import { describe, expect, it } from "bun:test";
import type { FigmaNode } from "../sync/figma-types.js";
import { collectDesignReviewEvidence, parseFigmaReviewUrl } from "./design-review.js";

const node = (document: NonNullable<FigmaNode["document"]>): FigmaNode => ({
  document,
});

describe("design review evidence", () => {
  it("parses Figma design URLs without requiring draft pages", () => {
    const parsed = parseFigmaReviewUrl(
      "https://www.figma.com/design/abc123/My-file?node-id=12-34&t=token"
    );

    expect(parsed.fileKey).toBe("abc123");
    expect(parsed.nodeId).toBe("12:34");
    expect(parsed.figmaUrl).toBe("https://www.figma.com/design/abc123/review?node-id=12-34");
  });

  it("collects a bounded shallow evidence bundle and caches its fingerprint", async () => {
    const upserts: { sourceFingerprint: string; summary: unknown }[] = [];
    const evidence = await collectDesignReviewEvidence({
      client: {
        getNodes: async () => ({
          "12:34": node({
            id: "12:34",
            name: "Members",
            type: "FRAME",
            absoluteBoundingBox: { x: 10, y: 20, width: 1440, height: 900 },
            children: [
              { id: "1:1", name: "Header", type: "FRAME", absoluteBoundingBox: { x: 10, y: 20, width: 1440, height: 80 } },
              { id: "1:2", name: "Table", type: "FRAME", absoluteBoundingBox: { x: 10, y: 120, width: 1440, height: 600 } },
              { id: "1:3", name: "Footer", type: "FRAME", absoluteBoundingBox: { x: 10, y: 760, width: 1440, height: 160 } },
            ],
          }),
        }),
        getImageUrls: async () => ({ "12:34": "https://figma-images.example/members.png" }),
      },
      store: {
        upsertReviewTargetCache: (input) => {
          upserts.push({ sourceFingerprint: input.sourceFingerprint, summary: input.summary });
        },
      },
      target: {
        fileKey: "abc123",
        nodeId: "12:34",
        figmaUrl: "https://www.figma.com/design/abc123/review?node-id=12-34",
      },
      maxRegions: 2,
      now: "2026-06-22T10:00:00.000Z",
    });

    expect(evidence.target.targetName).toBe("Members");
    expect(evidence.evidence.tokenBudget.returnedRegions).toBe(2);
    expect(evidence.evidence.tokenBudget.truncatedRegions).toBe(1);
    expect(evidence.evidence.regions.map((region) => region.name)).toEqual(["Header", "Table"]);
    expect(evidence.evidence.image?.url).toBe("https://figma-images.example/members.png");
    expect(upserts[0]?.sourceFingerprint).toContain("Members");
  });

  it("returns a friendly evidence error when the target node cannot be read", async () => {
    await expect(
      collectDesignReviewEvidence({
        client: { getNodes: async () => ({}) },
        target: {
          fileKey: "abc123",
          nodeId: "12:34",
          figmaUrl: "https://www.figma.com/design/abc123/review?node-id=12-34",
        },
      })
    ).rejects.toThrow("couldn't read that Figma review target");
  });
});
