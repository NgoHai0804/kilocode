/**
 * VS Code API host adapter
 * Provides access to the VS Code webview API for posting messages.
 *
 * The shared UI reads the host through `useHost()`; `useVSCode()` remains as a
 * compatibility alias for the existing components that still call
 * `postMessage`/`onMessage` directly.
 */

import { onCleanup, ParentComponent, createSignal } from "solid-js"
import type { VSCodeAPI, WebviewMessage, ExtensionMessage } from "../types/messages"
import { ClipboardProvider } from "@kilocode/kilo-ui/context/clipboard"
import { edge } from "../sidebar-position"
import { protect } from "../utils/webview-message"
import { HostProvider, useHost } from "../host/HostProvider"
import { ALL_HOST_CAPABILITIES, type HostBridge } from "../host/HostBridge"

// Get the VS Code API (only available in webview context)
let vscodeApi: VSCodeAPI | undefined

export function getVSCodeAPI(): VSCodeAPI {
  if (!vscodeApi) {
    // In VS Code webview, acquireVsCodeApi is available globally
    if (typeof acquireVsCodeApi === "function") {
      vscodeApi = acquireVsCodeApi()
    } else {
      // Mock for development/testing outside VS Code
      console.warn("[Kilo New] Running outside VS Code, using mock API")
      vscodeApi = {
        postMessage: (msg) => console.log("[Kilo New] Mock postMessage:", msg),
        getState: () => undefined,
        setState: () => {},
      }
    }
  }
  return vscodeApi
}

// Every capability is available in the VS Code host.
const VSCODE_CAPABILITIES = ALL_HOST_CAPABILITIES
// Compatibility shape used by existing components.
interface VSCodeContextValue {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  getState: <T>() => T | undefined
  setState: <T>(state: T) => void
  sidebarSide: () => "left" | "right" | undefined
  active: () => boolean
  getModelSelectorExpanded: () => boolean
  setModelSelectorExpanded: (value: boolean) => void
}

export const VSCodeProvider: ParentComponent = (props) => {
  const release = protect()
  const api = getVSCodeAPI()
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const copies = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()
  const initial = document.documentElement.dataset.sidebar
  const saved = (api.getState() as { sidebarSide?: unknown } | undefined)?.sidebarSide
  const [side, setSide] = createSignal<"left" | "right" | undefined>(
    initial === "left" || initial === "right" ? (saved === "left" || saved === "right" ? saved : initial) : undefined,
  )

  const position = (event: PointerEvent) => {
    const next = edge(event, window)
    if (!next || next === side()) return
    setSide(next)
    api.setState({ ...(api.getState() as Record<string, unknown> | undefined), sidebarSide: next })
  }

  if (side()) {
    window.addEventListener("pointerover", position, true)
    window.addEventListener("pointermove", position, true)
  }

  // Model-selector expand/collapse preference. Stored in extension globalState
  // so it is shared across webviews (sidebar + agent-manager panel); a local
  // signal mirrors it for synchronous reads.
  const [expanded, setExpanded] = createSignal(true)
  const [active, setActive] = createSignal(false)

  // Listen for messages from the extension
  const messageListener = (event: MessageEvent) => {
    const message = event.data as ExtensionMessage
    if (message.type === "clipboardWriteResult") {
      const copy = copies.get(message.id)
      if (!copy) return
      copies.delete(message.id)
      if (message.ok) {
        copy.resolve()
        return
      }
      copy.reject(new Error(message.error ?? "Failed to write to clipboard"))
      return
    }
    if (message.type === "modelSelectorExpandedLoaded") setExpanded(message.value)
    if (message.type === "webviewActiveChanged") setActive(message.active)
    handlers.forEach((handler) => handler(message))
  }

  window.addEventListener("message", messageListener)
  const reportFocus = () => api.postMessage({ type: "webviewFocusChanged", focused: document.hasFocus() })
  window.addEventListener("focus", reportFocus)
  window.addEventListener("blur", reportFocus)
  reportFocus()
  api.postMessage({ type: "requestModelSelectorExpanded" })

  onCleanup(() => {
    release()
    window.removeEventListener("message", messageListener)
    window.removeEventListener("focus", reportFocus)
    window.removeEventListener("blur", reportFocus)
    window.removeEventListener("pointerover", position, true)
    window.removeEventListener("pointermove", position, true)
    handlers.clear()
    copies.clear()
  })

  const host: HostBridge = {
    kind: "vscode",
    capabilities: VSCODE_CAPABILITIES,
    post: (message: WebviewMessage) => {
      api.postMessage(message)
    },
    subscribe: (handler: (message: ExtensionMessage) => void) => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    getState: <T,>() => api.getState() as T | undefined,
    setState: <T,>(state: T) => api.setState(state),
    sidebarSide: side,
    active,
    clipboard: {
      readText: () => {
        if (!navigator.clipboard?.readText) return Promise.reject(new Error("Clipboard read is unavailable"))
        return navigator.clipboard.readText()
      },
      writeText: (text) =>
        new Promise((resolve, reject) => {
          const id = crypto.randomUUID()
          copies.set(id, { resolve, reject })
          api.postMessage({ type: "copyToClipboard", id, text })
          setTimeout(() => {
            if (!copies.delete(id)) return
            reject(new Error("Clipboard write timed out"))
          }, 5000)
        }),
    },
    openExternal: async (url: string) => {
      api.postMessage({ type: "openExternal", url })
    },
    openFile: async (path: string) => {
      api.postMessage({ type: "openFile", filePath: path })
    },
    modelSelectorExpanded: expanded,
    setModelSelectorExpanded: (value: boolean) => {
      setExpanded(value)
      api.postMessage({ type: "persistModelSelectorExpanded", value })
    },
  }

  return (
    <HostProvider host={host}>
      <ClipboardProvider write={(text) => host.clipboard.writeText(text)}>{props.children}</ClipboardProvider>
    </HostProvider>
  )
}

export function useVSCode(): VSCodeContextValue {
  const host = useHost()
  return {
    postMessage: (message: WebviewMessage) => host.post(message),
    onMessage: (handler: (message: ExtensionMessage) => void) => host.subscribe(handler),
    getState: <T,>() => host.getState<T>(),
    setState: <T,>(state: T) => host.setState(state),
    sidebarSide: host.sidebarSide,
    active: host.active,
    getModelSelectorExpanded: () => host.modelSelectorExpanded?.() ?? true,
    setModelSelectorExpanded: (value: boolean) => host.setModelSelectorExpanded?.(value),
  }
}
