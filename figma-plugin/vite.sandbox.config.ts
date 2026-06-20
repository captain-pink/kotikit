import { defineConfig } from "vite";
import { fileURLToPath } from "url";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("code.ts", import.meta.url)),
      name: "KotikitPluginSandbox",
      formats: ["iife"],
      fileName: () => "code.js",
    },
  },
});
