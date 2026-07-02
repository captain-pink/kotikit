import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const docs = [
  "README.md",
  "docs/workflows.md",
  "docs/figma.md",
  "docs/tools.md",
  "docs/troubleshooting.md",
  "KOTIKIT_MIGRATION.md",
];

describe("UX quality docs", () => {
  it("does not recommend browser-debugged comment review", () => {
    const text = docs.map((path) => readFileSync(path, "utf-8")).join("\n");
    expect(text.toLowerCase()).not.toContain("chrome devtools");
  });

  it("documents state matrices and draft lifecycle", () => {
    const text = docs.map((path) => readFileSync(path, "utf-8")).join("\n");
    expect(text).toContain("StateMatrix");
    expect(text).toContain("DraftComponentLifecycle");
    expect(text).toContain("context durability");
    expect(text).toContain("designer recovery");
    expect(text).toContain("no built-in product-flow, old review/comment posting, memory");
    expect(text).toContain("lightweight post-screen feedback");
  });
});
