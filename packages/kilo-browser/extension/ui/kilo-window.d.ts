import type { HostCapabilities } from "@kilo-webview/src/host/HostBridge"

declare global {
  interface Window {
    KILO_CAPABILITIES?: Partial<HostCapabilities>
    KILO_ASSET_BASE?: string
    ICONS_BASE_URI?: string
    KILO_SHIKI_WORKER_URI?: string
    KILO_MARKDOWN_SHIKI_WORKER_URI?: string
    KILO_DOTLOTTIE_WASM_URI?: string
    KILO_TOP_BAR?: boolean
    KILO_TOP_BAR_SURFACE?: string
    KILO_SETTINGS?: { tab?: string; projectId?: string }
  }
}

export {}
