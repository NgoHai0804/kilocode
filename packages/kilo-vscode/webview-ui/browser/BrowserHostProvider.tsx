/**
 * Browser host adapter.
 *
 * Connects the shared chat/settings UI to the local `kilo-browser` bridge over
 * a single WebSocket. The bridge RPC is intentionally minimal for now: the UI
 * can render its empty/connecting states until US-12 wires the host methods.
 */

import { createSignal, onCleanup, onMount, type ParentComponent } from "solid-js"
import { ClipboardProvider } from "@kilocode/kilo-ui/context/clipboard"
import { HostProvider } from "../src/host/HostProvider"
import {
  hostCapabilities,
  type HostBridge,
  type HostCapabilities,
  type HostClipboard,
} from "../src/host/HostBridge"
import { BROWSER_V1_CAPABILITIES } from "../src/host/capabilities"
import type { ExtensionMessage, WebviewMessage } from "../src/types/messages"
import { post } from "../src/utils/webview-message"
import {
  BRIDGE_ERROR_EVENT,
  BRIDGE_PAIR_REQUIRED_EVENT,
  BRIDGE_STATE_EVENT,
  BROWSER_PORT_KEY,
  BROWSER_TOKEN_KEY,
  browserStorage,
  clearPairing,
  isPairResetCode,
  matchBridgeError,
  type ConnectionStatus,
} from "./pairing"
import { DIFF_PREVIEW_KEY } from "./viewer-api"

const PORT_KEY = BROWSER_PORT_KEY
const TOKEN_KEY = BROWSER_TOKEN_KEY
const STATE_KEY = "kilo.browser.ui.state"
const CONFIG_EVENT = "kilo:bridge-config"
const QUEUE_LIMIT = 256
const SUBPROTOCOL = "kilo-browser.v1"

type UiOutbound = { kind: "ui"; id: string; message: WebviewMessage }

type KiloWindow = Window & {
  KILO_CAPABILITIES?: Partial<HostCapabilities>
  KILO_BRIDGE_PORT?: number | string
  KILO_BRIDGE_TOKEN?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parsePort(raw: string | null): number | undefined {
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

function readPort(globals: KiloWindow): number | undefined {
  return parsePort(localStorage.getItem(PORT_KEY)) ?? parsePort(String(globals.KILO_BRIDGE_PORT ?? ""))
}

function readToken(globals: KiloWindow): string | undefined {
  return localStorage.getItem(TOKEN_KEY) ?? globals.KILO_BRIDGE_TOKEN ?? undefined
}

function readState<T>(): T | undefined {
  const raw = localStorage.getItem(STATE_KEY)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn("[Kilo Browser] could not read UI state", err)
    return undefined
  }
}

function writeState<T>(state: T): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch (err) {
    console.warn("[Kilo Browser] could not persist UI state", err)
  }
}

function parseInbound(raw: string): ExtensionMessage | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (err) {
    console.warn("[Kilo Browser] ignored malformed bridge message", err)
    return undefined
  }
  if (!record(value) || value.kind !== "ui" || !record(value.message)) return undefined
  if (typeof value.message.type !== "string") return undefined
  return value.message as unknown as ExtensionMessage
}

function errorCodeOf(message: ExtensionMessage): string | undefined {
  const value = message as { code?: unknown; message?: unknown; error?: { name?: unknown } }
  if (typeof value.code === "string") {
    const info = matchBridgeError(value.code)
    if (info) return info.code
  }
  if (typeof value.message === "string") {
    const info = matchBridgeError(value.message)
    if (info) return info.code
  }
  if (typeof value.error?.name === "string") {
    const info = matchBridgeError(value.error.name)
    if (info) return info.code
  }
  return undefined
}

type ChromeTabs = { create(options: { url: string }): Promise<unknown> }
type ChromeLike = { tabs?: ChromeTabs; runtime?: { getURL?: (path: string) => string } }

function chromeApi(): ChromeLike | undefined {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome
}

/**
 * Build a `chrome-extension://` URL for a read-only viewer page.
 *
 * Falls back to a root-relative path when `chrome.runtime` is unavailable so
 * the helper stays harmless outside a real extension page.
 */
function viewerUrl(page: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) query.set(key, value)
  }
  const api = chromeApi()
  const path = `ui-dist/${page}`
  const base = api?.runtime?.getURL ? api.runtime.getURL(path) : `/${path}`
  const suffix = query.toString()
  return suffix.length > 0 ? `${base}?${suffix}` : base
}

/** Stash a permission diff so the standalone diff viewer can render it. */
function stashDiffPreview(payload: unknown): boolean {
  try {
    localStorage.setItem(DIFF_PREVIEW_KEY, JSON.stringify(payload))
    return true
  } catch (err) {
    console.warn("[Kilo Browser] could not store diff preview", err)
    return false
  }
}

export const BrowserHostProvider: ParentComponent = (props) => {
  const globals = window as KiloWindow
  const storage = browserStorage()
  const listeners = new Set<(message: ExtensionMessage) => void>()
  const queue: UiOutbound[] = []
  const [side] = createSignal<"left" | "right" | undefined>(undefined)
  const [active, setActive] = createSignal(document.hasFocus())
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let disposed = false

  const emitState = (status: ConnectionStatus, detail: Record<string, unknown> = {}) => {
    window.dispatchEvent(new CustomEvent(BRIDGE_STATE_EVENT, { detail: { status, ...detail } }))
  }

  const dispatch = (message: ExtensionMessage) => {
    const errorCode = errorCodeOf(message)
    if (errorCode) window.dispatchEvent(new CustomEvent(BRIDGE_ERROR_EVENT, { detail: { code: errorCode } }))
    for (const listener of listeners) {
      try {
        listener(message)
      } catch (err) {
        console.error("[Kilo Browser] host listener failed", err)
      }
    }
    // Mirror VS Code: extension messages also arrive as `window` message events
    // so components that listen with `window.addEventListener("message")` (the
    // app router, task header, migration) keep working against the browser host.
    post(message)
  }

  const openTab = (url: string, action: string): boolean => {
    const tabs = chromeApi()?.tabs
    if (!tabs) return false
    tabs.create({ url }).then(
      () => dispatch({ type: "browserOpenResult", action, ok: true }),
      (err: unknown) => {
        console.warn("[Kilo Browser] could not open tab", err)
        dispatch({ type: "browserOpenResult", action, ok: false, error: "tab_create_failed" })
      },
    )
    return true
  }

  const openLink = (url: string): boolean => {
    if (!/^https?:\/\//i.test(url)) {
      dispatch({ type: "browserOpenResult", action: "openExternal", ok: false, error: "blocked_scheme" })
      return true
    }
    return openTab(url, "openExternal")
  }

  const handledLocally = (message: WebviewMessage): boolean => {
    switch (message.type) {
      case "openSettingsPanel":
        // Only one UI surface can hold the bridge socket at a time, so the
        // shared settings view navigates inside this page instead of opening a
        // second tab that could not connect.
        dispatch({ type: "navigate", view: "settings", ...(message.tab ? { tab: message.tab } : {}) })
        return true
      case "openProfilePanel":
        dispatch({ type: "navigate", view: "profile" })
        return true
      case "openFile":
        return openTab(
          viewerUrl("file.html", {
            path: message.filePath,
            session: message.sessionID,
            line: message.line === undefined ? undefined : String(message.line),
          }),
          "openFile",
        )
      case "openDiffVirtual":
        if (!stashDiffPreview(message.diff)) return false
        return openTab(viewerUrl("diff.html", { preview: "1", style: message.initialDiffStyle }), "openDiffVirtual")
      case "openWebLink":
      case "openExternal":
        return openLink(message.url)
      default:
        return false
    }
  }

  const send = (message: WebviewMessage) => {
    if (handledLocally(message)) return
    const outbound: UiOutbound = { kind: "ui", id: crypto.randomUUID(), message }
    const live = socket?.readyState === WebSocket.OPEN
    if (live) {
      socket?.send(JSON.stringify(outbound))
      return
    }
    if (queue.length >= QUEUE_LIMIT) {
      queue.shift()
      console.warn("[Kilo Browser] bridge queue full, dropping oldest UI message")
    }
    queue.push(outbound)
  }

  const endpoint = (): { url: string; token: string } | undefined => {
    const port = readPort(globals)
    const token = readToken(globals)
    if (!port || !token) return undefined
    return { url: `ws://127.0.0.1:${port}/ws?role=ui`, token }
  }

  const schedule = () => {
    if (disposed || retry || !endpoint()) return
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
    const delay = Math.min(1000 * 2 ** Math.min(attempts, 5), 30_000)
    attempts += 1
    retry = setTimeout(() => {
      retry = undefined
      connect()
    }, delay)
  }

  const connect = () => {
    if (disposed) return
    const target = endpoint()
    if (!target) return
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return

    const ws = new WebSocket(target.url, [SUBPROTOCOL, `token.${target.token}`])
    socket = ws

    ws.addEventListener("open", () => {
      attempts = 0
      for (const outbound of queue.splice(0)) ws.send(JSON.stringify(outbound))
      send({ type: "webviewReady" })
      emitState("connected", { port: readPort(globals) })
    })

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      const message = parseInbound(event.data)
      if (message) dispatch(message)
    })

    ws.addEventListener("error", () => {
      console.warn("[Kilo Browser] bridge socket error")
    })

    ws.addEventListener("close", (event) => {
      if (socket !== ws) return
      socket = undefined
      if (isPairResetCode(event.code)) {
        clearPairing(storage)
        window.dispatchEvent(new CustomEvent(BRIDGE_PAIR_REQUIRED_EVENT, { detail: { code: event.code } }))
        emitState("disconnected", { code: event.code, reason: event.reason })
        return
      }
      if (!disposed) {
        console.warn("[Kilo Browser] bridge disconnected", event.code, event.reason)
        emitState("reconnecting", { code: event.code, reason: event.reason })
      }
      schedule()
    })
  }

  const reconnect = () => {
    socket?.close()
    socket = undefined
    if (retry) {
      clearTimeout(retry)
      retry = undefined
    }
    attempts = 0
    connect()
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") connect()
  }

  const onFocus = () => setActive(true)
  const onBlur = () => setActive(false)

  onMount(() => {
    connect()
    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    window.addEventListener(CONFIG_EVENT, reconnect)
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => {
      disposed = true
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
      window.removeEventListener(CONFIG_EVENT, reconnect)
      document.removeEventListener("visibilitychange", onVisibility)
      if (retry) clearTimeout(retry)
      socket?.close()
      socket = undefined
      listeners.clear()
      queue.length = 0
    })
  })

  const clipboard: HostClipboard = {
    readText: () => {
      if (!navigator.clipboard?.readText) return Promise.reject(new Error("Clipboard read is unavailable"))
      return navigator.clipboard.readText()
    },
    writeText: (text) => {
      if (!navigator.clipboard?.writeText) return Promise.reject(new Error("Clipboard write is unavailable"))
      return navigator.clipboard.writeText(text)
    },
  }

  const capabilities = {
    ...hostCapabilities(BROWSER_V1_CAPABILITIES),
    ...(globals.KILO_CAPABILITIES ?? {}),
  }

  const host: HostBridge = {
    kind: "browser",
    capabilities,
    post: send,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: <T,>() => readState<T>(),
    setState: <T,>(state: T) => writeState(state),
    sidebarSide: side,
    active,
    clipboard,
    openExternal: async (url: string) => {
      if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs can be opened")
      if (!openTab(url, "openExternal")) throw new Error("Unable to open the URL")
    },
    openFile: async (path: string) => {
      if (!openTab(viewerUrl("file.html", { path }), "openFile")) throw new Error("Unable to open the file viewer")
    },
    openDiff: async (input: { path: string; before: string; after: string }) => {
      if (!stashDiffPreview({ file: input.path, before: input.before, after: input.after })) {
        throw new Error("Unable to prepare the diff viewer")
      }
      if (!openTab(viewerUrl("diff.html", { preview: "1" }), "openDiff")) throw new Error("Unable to open the diff viewer")
    },
    modelSelectorExpanded: () => readState<{ modelSelectorExpanded?: boolean }>()?.modelSelectorExpanded ?? true,
    setModelSelectorExpanded: (value: boolean) => {
      const state = readState<Record<string, unknown>>() ?? {}
      writeState({ ...state, modelSelectorExpanded: value })
    },
  }

  return (
    <HostProvider host={host}>
      <ClipboardProvider write={(text) => host.clipboard.writeText(text)}>{props.children}</ClipboardProvider>
    </HostProvider>
  )
}
