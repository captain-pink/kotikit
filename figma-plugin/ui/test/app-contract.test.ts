import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = (): string =>
  readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf-8");

describe("plugin UI contract", () => {
  it("keeps the Figma plugin scoped to variable sync", () => {
    const source = appSource();

    expect(source).toContain("kotikit_sync_plugin_variables");
    expect(source).toContain("Sync Variables From Open File");
    expect(source).not.toContain("kotikit_doctor");
    expect(source).not.toContain("kotikit_design_review_report");
    expect(source).not.toContain("Load Review Report");
    expect(source).not.toContain("Checklist");
  });
});
