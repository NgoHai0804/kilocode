import "../util/promise"
import { ALARM_NAME, createSocket, debuggerApi, defineAlarm, storage } from "../chrome/api"
import { Store } from "../storage/store"
import { CdpSession } from "../cdp/session"
import { RefRegistry } from "../refs/registry"
import { ConsoleBuffer, NetworkBuffer } from "../buffers/ring"
import { Router } from "../rpc/router"
import { registerTools } from "../tools"
import { BridgeTransport, type ConnectionState } from "../transport/ws"
import { ApprovalRegistry } from "../approval/registry"
import { RpcFailure } from "../../../src/protocol/rpc"
import type { Json, TabInfo } from "../cdp/types"
import { errorMessage, num, record, text } from "../util/value"

const store = new Store(storage)
const refs = new RefRegistry()
const approvals = new ApprovalRegistry()
const consoleBuffer = new ConsoleBuffer()
const networkBuffer = new NetworkBuffer()
const session = new CdpSession({
  api: debuggerApi,
  refs,
  console: consoleBuffer,
  network: networkBuffer,
  onEvent: log,
})
const router = new Router({ onEvent: log })
const transport = new BridgeTransport({
  router,
  loadPairing: async () => (await store.current()).pairing,
  savePairing: async (pairing) => {
    await store.setPairing(pairing)
  },
  clearPairing: async () => {
    await store.setPairing(null)
  },
  bridgeUrl: async () => {
    if (pairUrl) return pairUrl
    const state = await store.current()
    return state.settings.bridgePort ? `ws://127.0.0.1:${state.settings.bridgePort}/ws` : undefined
  },
  createSocket,
  extensionId: chrome.runtime.id,
  extensionVersion: chrome.runtime.getManifest().version,
  autoReconnect: true,
  onState: handleState,
  onEvent: log,
})
registerTools(router, {
  session,
  refs,
  console: consoleBuffer,
  network: networkBuffer,
  allowlist: () => store.allowlist(),
  paired: () => transport.connected,
  approval: approvals,
  onEvent: log,
})

let booting: Promise<void> | undefined
let suppressAttachUntil = 0
let pairUrl: string | undefined

function boot(): Promise<void> {
  booting ??= doBoot()
  return booting
}

function bootSafe() {
  void boot().catch((err: unknown) => {
    log({ type: "boot.failed", data: { error: errorMessage(err) } })
  })
}

async function doBoot() {
  const state = await store.load()
  try {
    await defineAlarm(0.5)
  } catch (err) {
    log({ type: "alarm.failed", data: { error: errorMessage(err) } })
  }
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (err) {
    log({ type: "sidepanel.failed", data: { error: errorMessage(err) } })
  }
  if (state.tab) await restoreTab(state.tab.tabId)
  await transport.start()
}

async function restoreTab(tabId: number) {
  try {
    await ensureTab(tabId)
  } catch (err) {
    if (err instanceof RpcFailure && err.kind === "DEVTOOLS_CONFLICT") {
      suppressAttachUntil = Date.now() + 60_000
      await store.patch({ ui: { lastError: "DEVTOOLS_CONFLICT" } })
      return
    }
    log({ type: "tab.restore_failed", data: { tabId, error: errorMessage(err) } })
    await store.setTab(null)
  }
}

async function ensureTab(tabId: number): Promise<TabInfo> {
  if (session.attached && session.tabId === tabId) {
    return session.tab ?? { id: tabId, attached: true }
  }
  const tab = await chrome.tabs.get(tabId)
  if (tab.id === undefined) throw new Error("tab has no id")
  const info = await session.attach(tabId)
  await store.setTab({ tabId, windowId: tab.windowId })
  return info
}

async function keepalive() {
  transport.checkHeartbeat()
  const state = await store.current()
  if (state.settings.autoReconnect && shouldConnect()) {
    try {
      await transport.connect()
    } catch (err) {
      log({ type: "ws.connect_failed", data: { error: errorMessage(err) } })
    }
  }
  if (!state.tab) return
  if (Date.now() < suppressAttachUntil) return
  try {
    await ensureTab(state.tab.tabId)
  } catch (err) {
    if (err instanceof RpcFailure && err.kind === "DEVTOOLS_CONFLICT") {
      suppressAttachUntil = Date.now() + 60_000
      await store.patch({ ui: { lastError: "DEVTOOLS_CONFLICT" } })
      return
    }
    log({ type: "tab.keepalive_failed", data: { tabId: state.tab.tabId, error: errorMessage(err) } })
    await store.setTab(null)
  }
}

function shouldConnect() {
  return (
    transport.state !== "connecting" &&
    transport.state !== "pairing" &&
    transport.state !== "connected" &&
    transport.state !== "blocked"
  )
}

async function handleTabRemoved(tabId: number) {
  const state = await store.current()
  if (session.tabId === tabId) await session.detach()
  if (state.tab?.tabId === tabId) await store.setTab(null)
}

async function handleMessage(message: unknown): Promise<Json> {
  const body = record(message)
  if (!body) return { ok: false, error: "invalid_message" }
  const type = text(body.type)
  if (type === "kilo.status") {
    return {
      ok: true,
      state: transport.state,
      paired: transport.connected,
      tab: session.tab ?? null,
      cdp: session.attached,
    }
  }
  if (type === "kilo.attach") {
    const tabId = num(body.tabId)
    if (tabId === undefined) return { ok: false, error: "tabId" }
    const info = await ensureTab(tabId)
    return { ok: true, tab: info }
  }
  if (type === "kilo.detach") {
    await session.detach()
    await store.setTab(null)
    return { ok: true }
  }
  if (type === "kilo.approval") {
    const decision = text(body.decision)
    if (decision !== "allow-once" && decision !== "allow-tab") return { ok: false, error: "decision" }
    const tabId = num(body.tabId) ?? (session.tabId > 0 ? session.tabId : undefined)
    return { ok: true, approval: approvals.grant(decision, tabId) }
  }
  if (type === "kilo.pair") {
    const code = text(body.code)
    if (!code) return { ok: false, error: "code" }
    const url = text(body.url)
    const port = num(body.port)
    if (url) pairUrl = url
    else if (port !== undefined) pairUrl = `ws://127.0.0.1:${port}/ws`
    await transport.pair(code)
    return { ok: true, state: transport.state }
  }
  if (type === "kilo.keepalive") {
    await keepalive()
    return { ok: true }
  }
  return { ok: false, error: "unsupported" }
}

function handleState(state: ConnectionState, detail: Json = {}) {
  if (state === "blocked") {
    const reason = text(detail.reason) ?? "blocked"
    void store.patch({ ui: { lastError: reason } })
  }
  if (state === "connected") void store.patch({ ui: { lastError: null } })
}

function log(event: { type: string; data: Json }) {
  console.debug(JSON.stringify({ ts: new Date().toISOString(), source: "kilo-browser", ...event }))
  if (event.type === "cdp.detached") void store.setTab(null)
}

chrome.runtime.onInstalled.addListener(() => {
  bootSafe()
})
chrome.runtime.onStartup.addListener(() => {
  bootSafe()
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return
  void keepalive().catch((err: unknown) => {
    log({ type: "keepalive.failed", data: { error: errorMessage(err) } })
  })
})
chrome.tabs.onRemoved.addListener((tabId) => {
  void handleTabRemoved(tabId).catch((err: unknown) => {
    log({ type: "tab.remove_failed", data: { tabId, error: errorMessage(err) } })
  })
})
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false
  void handleMessage(message).then(sendResponse, (err: unknown) => {
    sendResponse({ ok: false, error: errorMessage(err) })
  })
  return true
})

bootSafe()