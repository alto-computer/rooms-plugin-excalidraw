import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const fonts = fileURLToPath(new URL("./node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url));

/** Copies Excalidraw's fonts into the build: plugins can't load anything from the network. */
const copyFonts = (): Plugin => ({
  name: "copy-excalidraw-fonts",
  apply: "build",
  writeBundle(opts) {
    cpSync(fonts, `${opts.dir}/fonts`, { recursive: true });
  },
});

// Rooms serves the plugin from /_plugins/excalidraw/, so every URL in the build is relative.
export default defineConfig({
  base: "./",
  plugins: [react(), copyFonts()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", modulePreload: false, chunkSizeWarningLimit: 4000 },
  test: { environment: "jsdom" },
});
