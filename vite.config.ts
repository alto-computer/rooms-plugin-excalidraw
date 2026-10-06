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

/**
 * Excalidraw lists a CDN (esm.sh) after each bundled font. The plugin's CSP refuses it, and the
 * ~230 refusals (one per font face) are logged on every panel open. Only the bundled fonts stay.
 */
const FONT_FALLBACK = /\w+\.push\(new URL\(\w+,\w+\.ASSETS_FALLBACK_URL\)\),/;
const dropFontCdn = (): Plugin => ({
  name: "drop-excalidraw-font-cdn",
  apply: "build",
  transform(code, id) {
    if (!id.includes("@excalidraw/excalidraw") || !code.includes("ASSETS_FALLBACK_URL")) return;
    if (!FONT_FALLBACK.test(code)) this.error("Excalidraw's font CDN fallback changed: update dropFontCdn");
    return { code: code.replace(FONT_FALLBACK, ""), map: null };
  },
});

/**
 * What Excalidraw asks for only once it mounts (its UI font, English strings, file helpers):
 * preloaded from index.html so it arrives with the main chunk, not a round trip later. Of the
 * file helpers only the <input>-based ones: a sandboxed frame has no File System Access.
 */
const EARLY = /^assets\/(Assistant-(Regular|Medium|Bold)-.*\.woff2|(en|roundRect|file-open|file-save|directory-open)-.*\.js)$/;
const preloadEarly = (): Plugin => ({
  name: "preload-excalidraw-early",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(_html, ctx) {
      return Object.values(ctx.bundle ?? {})
        .filter((out) => EARLY.test(out.fileName) && !(out.type === "chunk" && /show\w+Picker/.test(out.code)))
        .map(({ fileName: f }) => ({
          tag: "link",
          attrs: f.endsWith(".js")
            ? { rel: "modulepreload", crossorigin: true, href: `./${f}` }
            : { rel: "preload", as: "font", type: "font/woff2", crossorigin: true, href: `./${f}` },
          injectTo: "head" as const,
        }));
    },
  },
});

// Rooms serves the plugin from /_plugins/excalidraw/, so every URL in the build is relative.
// modulePreload fetches a chunk's imports with it instead of one level at a time; no polyfill,
// since it would use fetch, which the plugin's CSP refuses.
export default defineConfig({
  base: "./",
  plugins: [react(), dropFontCdn(), copyFonts(), preloadEarly()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", modulePreload: { polyfill: false }, chunkSizeWarningLimit: 4000 },
  test: { environment: "jsdom", setupFiles: ["src/test-setup.ts"], server: { deps: { inline: ["@excalidraw/excalidraw"] } } },
});
