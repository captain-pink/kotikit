import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasStorybook } from "../storybook-detect.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-storybook-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("hasStorybook", () => {
  it("empty project root → false", async () => {
    const root = mkTmp();
    expect(await hasStorybook(root)).toBe(false);
  });

  it(".storybook directory exists → true", async () => {
    const root = mkTmp();
    mkdirSync(join(root, ".storybook"), { recursive: true });
    writeFileSync(join(root, ".storybook", "main.ts"), "export default {};");
    expect(await hasStorybook(root)).toBe(true);
  });

  it("package.json with 'storybook' devDep → true", async () => {
    const root = mkTmp();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { storybook: "^8.0.0" } })
    );
    expect(await hasStorybook(root)).toBe(true);
  });

  it("package.json with @storybook/* package → true", async () => {
    const root = mkTmp();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { "@storybook/react": "^8.0.0" } })
    );
    expect(await hasStorybook(root)).toBe(true);
  });

  it("package.json with storybook as production dep → true", async () => {
    const root = mkTmp();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { storybook: "^8.0.0" } })
    );
    expect(await hasStorybook(root)).toBe(true);
  });

  it("malformed package.json → false (no throw)", async () => {
    const root = mkTmp();
    writeFileSync(join(root, "package.json"), "not valid json {{{");
    expect(await hasStorybook(root)).toBe(false);
  });

  it("package.json without storybook → false", async () => {
    const root = mkTmp();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { react: "^19.0.0", vitest: "^3.0.0" } })
    );
    expect(await hasStorybook(root)).toBe(false);
  });

  it("no .storybook/ and no package.json → false", async () => {
    const root = mkTmp();
    expect(await hasStorybook(root)).toBe(false);
  });
});
