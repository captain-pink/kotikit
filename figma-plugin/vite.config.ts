import { existsSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const renameUiHtml = (): Plugin => ({
  name: "kotikit-ui-html-output",
  closeBundle() {
    const indexPath = fileURLToPath(new URL("dist/index.html", import.meta.url));
    const uiPath = fileURLToPath(new URL("dist/ui.html", import.meta.url));
    if (!existsSync(indexPath)) return;
    if (existsSync(uiPath)) rmSync(uiPath);
    renameSync(indexPath, uiPath);
  },
});

export default defineConfig({
  plugins: [react(), viteSingleFile(), renameUiHtml()],
  root: "ui",
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: {
      input: "ui/index.html",
      output: { entryFileNames: "ui.js", assetFileNames: "ui.[ext]" },
    },
  },
});
