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
import { pairRequest } from "./pair-message"
import { isAttachable, pickAttachTab, type ActiveTab } from "./attach"
import type { TabControl, TabSummary } from "../tools/context"
import { invalid, noTarget } from "../rpc/failure"
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
// Read every open tab and drive the agent onto a chosen one. Switching also
// activates the tab so auto-attach (which follows the active tab) agrees with
// the manual choice instead of immediately snapping back.
const tabControl: TabControl = {
  async list(): Promise<TabSummary[]> {
    const open = await chrome.tabs.query({})
    const tabs: TabSummary[] = []
    for (const tab of open) {
      if (typeof tab.id !== "number") continue
      tabs.push({
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title,
        active: tab.active === true,
        attached: session.attached && session.tabId === tab.id,
        attachable: isAttachable(tab.url),
      })
    }
    return tabs
  },
  async switchTo(tabId: number): Promise<TabSummary> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab || typeof tab.id !== "number") throw noTarget("tab_not_found")
    if (!isAttachable(tab.url)) throw invalid("tabId", "tab is a browser-internal page and cannot be driven")
    await chrome.tabs.update(tabId, { active: true })
    if (typeof tab.windowId === "number") {
      try {
        await chrome.windows.update(tab.windowId, { focused: true })
      } catch (err) {
        log({ type: "tab.focus_failed", data: { tabId, error: errorMessage(err) } })
      }
    }
    suppressAttachUntil = 0
    const info = await ensureTab(tabId)
    return { id: info.id, url: info.url, title: info.title, active: true, attached: info.attached, attachable: true }
  },
}

registerTools(router, {
  session,
  refs,
  console: consoleBuffer,
  network: networkBuffer,
  allowlist: () => store.allowlist(),
  paired: () => transport.connected,
  approval: approvals,
  tabs: tabControl,
  onEvent: log,
})

// Ensure the active tab is attached before every tool call so auto-attach does
// not depend on tab events firing: the agent gets the page it is looking at.
const dispatch = router.handle.bind(router)
router.handle = async (message: unknown) => {
  await ensureAutoAttach()
  return dispatch(message)
}

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
  if (state.settings.autoAttach) await syncActiveTab()
  else if (state.tab) await restoreTab(state.tab.tabId)
  await transport.start()
}

async function restoreTab(tabId: number) {
  await attachSafe(tabId, "tab.restore_failed")
}

async function attachSafe(tabId: number, tag: string) {
  try {
    await ensureTab(tabId)
  } catch (err) {
    if (err instanceof RpcFailure && err.kind === "DEVTOOLS_CONFLICT") {
      suppressAttachUntil = Date.now() + 60_000
      await store.patch({ ui: { lastError: "DEVTOOLS_CONFLICT" } })
      return
    }
    log({ type: tag, data: { tabId, error: errorMessage(err) } })
    await store.setTab(null)
  }
}

async function activeTab(): Promise<ActiveTab | null> {
  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const tabs = focused.length > 0 ? focused : await chrome.tabs.query({ active: true })
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue
    if (!isAttachable(tab.url)) continue
    return { tabId: tab.id, windowId: tab.windowId }
  }
  return null
}

/** Auto-attach to the active tab so the agent can drive every page unasked. */
async function syncActiveTab() {
  const state = await store.current()
  if (!state.settings.autoAttach) return
  if (Date.now() < suppressAttachUntil) return
  const decision = pickAttachTab({ autoAttach: true, selected: state.tab, active: await activeTab() })
  if (!decision) return
  await attachSafe(decision.tabId, "tab.auto_attach_failed")
}

/** Attach the active tab on demand, before serving a tool call. */
async function ensureAutoAttach() {
  const state = await store.current()
  if (!state.settings.autoAttach) return
  const active = await activeTab()
  if (!active) return
  if (session.attached && session.tabId === active.tabId) return
  await attachSafe(active.tabId, "tab.ensure_attach_failed")
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
  if (state.settings.autoAttach) {
    await syncActiveTab()
    return
  }
  if (!state.tab) return
  if (Date.now() < suppressAttachUntil) return
  await attachSafe(state.tab.tabId, "tab.keepalive_failed")
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
  if (type === "kilo.approval") {
    const decision = text(body.decision)
    if (decision !== "allow-once" && decision !== "allow-tab") return { ok: false, error: "decision" }
    const tabId = num(body.tabId) ?? (session.tabId > 0 ? session.tabId : undefined)
    return { ok: true, approval: approvals.grant(decision, tabId) }
  }
  if (type === "kilo.pair") {
    const request = pairRequest({ url: body.url, port: body.port, code: body.code, token: body.token })
    if (!request.ok) return { ok: false, error: request.error }
    pairUrl = request.url
    if ("token" in request) {
      await store.setPairing({
        extensionId: chrome.runtime.id,
        token: request.token,
        bridgeUrl: request.url,
        pairedAt: new Date().toISOString(),
      })
      await transport.reconnectNow()
    } else {
      // A stored pairing wins over the supplied code inside the transport
      // (it reuses `pairing.bridgeUrl` and sends `bridgeToken`), so a fresh code
      // would silently reconnect to the old bridge. Drop it first.
      await store.setPairing(null)
      await transport.pair(request.code)
    }
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
chrome.tabs.onActivated.addListener(() => {
  void syncActiveTab().catch((err: unknown) => {
    log({ type: "tab.activated_failed", data: { error: errorMessage(err) } })
  })
})
// A freshly activated tab is often still `about:blank` (a blocked scheme), so
// the activation handler skips it. Without this listener the later navigation
// to a real URL never re-triggers a pick and the tab is never auto-attached.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active) return
  if (changeInfo.url === undefined && changeInfo.status !== "complete") return
  void syncActiveTab().catch((err: unknown) => {
    log({ type: "tab.updated_failed", data: { error: errorMessage(err) } })
  })
})
// A brand-new tab is often still `pendingUrl` when `onActivated` fires, and a
// fresh navigation can land after it. Re-sync when the active tab settles so
// auto-attach does not miss the tab the user is looking at.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active) return
  if (changeInfo.status !== "complete" && changeInfo.url === undefined) return
  void syncActiveTab().catch((err: unknown) => {
    log({ type: "tab.updated_failed", data: { error: errorMessage(err) } })
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