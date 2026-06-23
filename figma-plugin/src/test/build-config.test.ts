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
    expect(pkg.scripts.build).toMatch(
      /vite build --config vite\.sandbox\.config\.ts && vite build/
    );
  });

  it("configures the sandbox entry as an IIFE bundle", () => {
    const config = readFileSync(pluginPath("vite.sandbox.config.ts"), "utf-8");

    expect(config).toContain('target: "es6"');
    expect(config).toContain('entry: fileURLToPath(new URL("code.ts", import.meta.url))');
    expect(config).toContain('formats: ["iife"]');
    expect(config).toContain('fileName: () => "code.js"');
    expect(config).toContain("sandboxSyntaxGuard");
    expect(config).toContain("Object or array spread");
  });

  it("aligns sandbox TypeScript settings with the conservative runtime target", () => {
    const config = JSON.parse(readFileSync(pluginPath("tsconfig.code.json"), "utf-8")) as {
      compilerOptions: { module?: string; lib?: string[] };
    };

    expect(config.compilerOptions.module).toBe("ES2015");
    expect(config.compilerOptions.lib).toEqual(["ES2015", "ES2017"]);
  });

  it("uses dynamic-page document access for safer page-scoped writes", () => {
    const manifest = JSON.parse(readFileSync(pluginPath("manifest.json"), "utf-8")) as {
      documentAccess?: string;
    };

    expect(manifest.documentAccess).toBe("dynamic-page");
  });
});
