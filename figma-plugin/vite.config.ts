import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
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
