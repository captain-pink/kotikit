import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const docs = [
  "README.md",
  "docs/getting-started.md",
  "docs/workflows.md",
  "docs/figma.md",
  "docs/troubleshooting.md",
];

describe("UX quality docs", () => {
  it("does not recommend browser-debugged comment review", () => {
    const text = docs.map((path) => readFileSync(path, "utf-8")).join("\n");
    expect(text.toLowerCase()).not.toContain("chrome devtools");
  });

  it("keeps user docs focused on the current lightweight product surface", () => {
    const text = docs.map((path) => readFileSync(path, "utf-8")).join("\n");

    expect(text).toContain("create-screen");
    expect(text).toContain("review-screen");
    expect(text).toContain("design system");
    expect(text).toContain("draft page");
    expect(text).toContain("variables");
    expect(text).toContain("comments");

    expect(text).not.toContain("KOTIKIT_MIGRATION");
    expect(text).not.toContain("NEXT_STEPS");
    expect(text).not.toContain("DraftComponentLifecycle");
    expect(text).not.toContain("old review/comment posting");
    expect(text).not.toContain("design-to-code");
  });

  it("keeps top-level user docs compact enough to scan", () => {
    const maxLinesByDoc: Record<string, number> = {
      "README.md": 180,
      "docs/getting-started.md": 130,
      "docs/workflows.md": 130,
      "docs/figma.md": 130,
      "docs/troubleshooting.md": 130,
    };

    for (const [path, maxLines] of Object.entries(maxLinesByDoc)) {
      const lineCount = readFileSync(path, "utf-8").trimEnd().split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(maxLines);
    }
  });
});
