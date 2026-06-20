import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const pluginPath = (path: string): string =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url));

describe("Figma plugin build config", () => {
  it("runs a dedicated sandbox bundle before the UI build", () => {
    const pkg = JSON.parse(readFileSync(pluginPath("package.json"), "utf-8")) as {
      scripts: { build?: string };
    };

    expect(pkg.scripts.build).toContain("tsc -p tsconfig.code.json --noEmit");
    expect(pkg.scripts.build).toContain("vite build --config vite.sandbox.config.ts");
    expect(pkg.scripts.build).toMatch(/vite build --config vite\.sandbox\.config\.ts && vite build/);
  });

  it("configures the sandbox entry as an IIFE bundle", () => {
    const config = readFileSync(pluginPath("vite.sandbox.config.ts"), "utf-8");

    expect(config).toContain("entry: fileURLToPath(new URL(\"code.ts\", import.meta.url))");
    expect(config).toContain("formats: [\"iife\"]");
    expect(config).toContain("fileName: () => \"code.js\"");
  });
});
