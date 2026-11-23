import { hostCapabilities } from "@kilo-webview/src/host/HostBridge"
import { BROWSER_V1_CAPABILITIES } from "@kilo-webview/src/host/capabilities"
import { installVscodeTheme } from "@kilo-webview/browser/vscode-theme"
import shikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import markdownWorkerUrl from "../../../ui/src/components/markdown-shiki.worker.ts?worker&url"
import dotlottieWasmUrl from "@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm?url"

function asset(path: string): string {
  // Vite emits `?url`/`?worker&url` assets as absolute URLs resolved against the
  // importing chunk (e.g. `chrome-extension://<id>/ui-dist/assets/x.wasm`). Only
  // rewrite relative paths; prefixing an already-absolute URL doubles the origin.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path
  return chrome.runtime.getURL(path.replace(/^\.?\//, ""))
}

// Chrome dispatches `ResizeObserver loop completed with undelivered notifications.`
// as a window error when an observed node is resized again inside a ResizeObserver
// callback (the diff viewer measures and then rewrites line/annotation sizes). It is
// benign, cannot be prevented from outside the observer, and is not actionable, so
// drop it instead of surfacing it as an unhandled error in the panel console.
window.addEventListener(
  "error",
  (event) => {
    if (event.message?.includes("ResizeObserver loop")) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  },
  true,
)

const capabilities = hostCapabilities(BROWSER_V1_CAPABILITIES)

window.KILO_CAPABILITIES = capabilities
window.KILO_ASSET_BASE = chrome.runtime.getURL("")
window.ICONS_BASE_URI = chrome.runtime.getURL("icons")
window.KILO_SHIKI_WORKER_URI = asset(shikiWorkerUrl)
window.KILO_MARKDOWN_SHIKI_WORKER_URI = asset(markdownWorkerUrl)
window.KILO_DOTLOTTIE_WASM_URI = asset(dotlottieWasmUrl)
window.KILO_TOP_BAR = document.body.dataset.kiloPage !== "settings"
window.KILO_TOP_BAR_SURFACE = "sidebar_title"

installVscodeTheme()

await import("./main")
