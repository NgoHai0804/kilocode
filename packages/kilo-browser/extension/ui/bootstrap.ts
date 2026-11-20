import { hostCapabilities } from "@kilo-webview/src/host/HostBridge"
import { BROWSER_V1_CAPABILITIES } from "@kilo-webview/src/host/capabilities"
import shikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import markdownWorkerUrl from "../../../ui/src/components/markdown-shiki.worker.ts?worker&url"
import dotlottieWasmUrl from "@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm?url"

function asset(path: string): string {
  return chrome.runtime.getURL(path.replace(/^\.?\//, ""))
}

const capabilities = hostCapabilities(BROWSER_V1_CAPABILITIES)

window.KILO_CAPABILITIES = capabilities
window.KILO_ASSET_BASE = chrome.runtime.getURL("")
window.ICONS_BASE_URI = chrome.runtime.getURL("icons")
window.KILO_SHIKI_WORKER_URI = asset(shikiWorkerUrl)
window.KILO_MARKDOWN_SHIKI_WORKER_URI = asset(markdownWorkerUrl)
window.KILO_DOTLOTTIE_WASM_URI = asset(dotlottieWasmUrl)
window.KILO_TOP_BAR = true
window.KILO_TOP_BAR_SURFACE = "sidebar_title"

await import("./main")
