import { describe, expect, it } from "bun:test";
import { resolveFigmaDraftTargetFromUrl } from "./draft-target-resolver.js";

const pageClient = (input: { id?: string; name?: string; type?: string }) => ({
  getNodes: async () => ({
    [input.id ?? "0:1"]: {
      document: {
        id: input.id ?? "0:1",
        name: input.name ?? "Draft - Members",
        type: input.type ?? "CANVAS",
      },
    },
  }),
});

describe("resolveFigmaDraftTargetFromUrl", () => {
  it("resolves a page URL into a draft target with a section name", async () => {
    const target = await resolveFigmaDraftTargetFromUrl({
      client: pageClient({ id: "0:1", name: "Draft - Members" }),
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=0-1",
      scope: "members",
      screen: null,
      now: () => "2026-06-22T10:00:00.000Z",
    });

    expect(target).toEqual({
      fileKey: "FILE123",
      pageId: "0:1",
      pageName: "Draft - Members",
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=0-1",
      boundAt: "2026-06-22T10:00:00.000Z",
      source: "user-url",
      section: { name: "kotikit / members / 2026-06-22" },
      safety: {
        requireDraftPageName: true,
        allowPageCreation: false,
        requireKotikitSection: true,
      },
    });
  });

  it("rejects non-draft pages", async () => {
    await expect(resolveFigmaDraftTargetFromUrl({
      client: pageClient({ name: "Production - Members" }),
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=0-1",
      scope: "members",
      screen: null,
      now: () => "2026-06-22T10:00:00.000Z",
    })).rejects.toThrow(/Draft/);
  });

  it("rejects child node URLs instead of guessing the containing page", async () => {
    await expect(resolveFigmaDraftTargetFromUrl({
      client: pageClient({ id: "1:2", name: "Members frame", type: "FRAME" }),
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=1-2",
      scope: "members",
      screen: null,
      now: () => "2026-06-22T10:00:00.000Z",
    })).rejects.toThrow(/page itself/);
  });
});
