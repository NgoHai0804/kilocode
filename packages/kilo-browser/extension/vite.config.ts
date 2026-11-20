import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, "ui")
const webview = path.resolve(here, "../../kilo-vscode/webview-ui")

export default defineConfig({
  root,
  base: "./",
  publicDir: false,
  plugins: [solid()],
  resolve: {
    alias: [
      { find: "@kilo-webview-entry", replacement: path.join(webview, "browser/index.tsx") },
      { find: "@kilo-webview-settings", replacement: path.join(webview, "browser/settings.tsx") },
      { find: "@kilo-webview-file", replacement: path.join(webview, "browser/file-viewer.tsx") },
      { find: "@kilo-webview-diff", replacement: path.join(webview, "browser/diff-viewer.tsx") },
      { find: "@kilo-webview", replacement: webview },
    ],
    conditions: ["browser", "solid", "module", "import"],
    dedupe: ["solid-js", "solid-js/web", "solid-js/store", "@pierre/diffs"],
  },
  build: {
    target: "chrome116",
    outDir: "../dist/ui-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.join(root, "sidepanel.html"),
        settings: path.join(root, "settings.html"),
        file: path.join(root, "file.html"),
        diff: path.join(root, "diff.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    host: "127.0.0.1",
    port: 3019,
  },
})
