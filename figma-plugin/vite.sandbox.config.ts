import type { OutputAsset, OutputBundle, OutputChunk } from "rollup";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const FORBIDDEN_SANDBOX_SYNTAX = [
  { label: "Object or array spread", pattern: /\.{3}/ },
  { label: "Optional chaining", pattern: /\?\.[a-zA-Z([]/ },
  { label: "Logical nullish assignment", pattern: /\?\?=/ },
  { label: "Logical AND assignment", pattern: /&&=/ },
  { label: "Logical OR assignment", pattern: /\|\|=/ },
  { label: "Nullish coalescing", pattern: /\?\?(?!=)/ },
  { label: "Private class fields", pattern: /#[a-zA-Z_]/ },
];

const codeFromOutput = (output: OutputAsset | OutputChunk): string =>
  output.type === "chunk" ? output.code : "";

const sandboxSyntaxGuard = () => ({
  name: "kotikit-sandbox-syntax-guard",
  generateBundle(_options: unknown, bundle: OutputBundle): void {
    const code = Object.values(bundle).map(codeFromOutput).join("\n");
    const violation = FORBIDDEN_SANDBOX_SYNTAX.find((entry) => entry.pattern.test(code));
    if (violation === undefined) return;
    throw new Error(`Figma sandbox bundle contains unsupported syntax: ${violation.label}.`);
  },
});

export default defineConfig({
  plugins: [sandboxSyntaxGuard()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es6",
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("code.ts", import.meta.url)),
      name: "KotikitPluginSandbox",
      formats: ["iife"],
      fileName: () => "code.js",
    },
  },
});
