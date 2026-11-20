import type { CdpConnection, DebuggerApi, DebuggerSource, Json, TabInfo } from "./types"
import { ConsoleBuffer, EventBuffer, NetworkBuffer, type NetworkFinish } from "../buffers/ring"
import { RefRegistry } from "../refs/registry"
import { RpcFailure } from "../../../src/protocol/rpc"
import { errorMessage, record, text } from "../util/value"
import { devtoolsConflict, networkRefused, noTarget, timeout } from "../rpc/failure"
import * as page from "./domains/page"
import * as runtime from "./domains/runtime"
import * as net from "./domains/network"

export type SessionOptions = {
  api: DebuggerApi
  refs?: RefRegistry
  console?: ConsoleBuffer
  network?: NetworkBuffer
  events?: EventBuffer
  captureBodies?: boolean
  now?: () => number
  onEvent?: (event: { type: string; data: Json }) => void
}

export type NavigateOptions = {
  waitUntil?: page.WaitUntil
  timeoutMs?: number
}

export type NavigateOutcome = {
  url: string
  title: string
  status: number
}

type Pending = {
  seq: number
  requestId: string
  startedAt: number
  response?: net.ResponseInfo
  finish?: NetworkFinish
  bodyTried?: boolean
}

type Waiter = {
  resolve: () => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
  event: string
}

export type WaitHandle = {
  done: Promise<void>
  cancel: () => void
}

const ENABLE_DOMAINS = ["Page", "Runtime", "Network", "Log", "DOM", "Accessibility"]

export class CdpSession implements CdpConnection {
  private readonly api: DebuggerApi
  private readonly refs: RefRegistry
  private readonly consoleBuffer: ConsoleBuffer
  private readonly networkBuffer: NetworkBuffer
  private readonly events: EventBuffer
  private readonly captureBodies: boolean
  private readonly onEvent?: SessionOptions["onEvent"]
  private readonly now: () => number
  private listeners: (() => void)[] = []
  private waiters = new Map<string, Set<Waiter>>()
  private pending = new Map<string, Pending>()
  private active = new Set<string>()
  private currentTabId = 0
  private currentUrl?: string
  private currentTitle?: string
  private currentFrameId?: string
  private mainRequestId?: string
  private status?: number
  private attachedState = false
  private attachedAt = 0
  private wanted = false

  constructor(options: SessionOptions) {
    this.api = options.api
    this.refs = options.refs ?? new RefRegistry()
    this.consoleBuffer = options.console ?? new ConsoleBuffer()
    this.networkBuffer = options.network ?? new NetworkBuffer()
    this.events = options.events ?? new EventBuffer()
    this.captureBodies = options.captureBodies ?? true
    this.onEvent = options.onEvent
    this.now = options.now ?? Date.now
  }

  get tabId() {
    return this.currentTabId
  }

  get attached() {
    return this.attachedState
  }

  get url() {
    return this.currentUrl
  }

  get title() {
    return this.currentTitle
  }

  get frameId() {
    return this.currentFrameId
  }

  get mainStatus() {
    return this.status
  }

  get buffer() {
    return {
      console: this.consoleBuffer,
      network: this.networkBuffer,
      events: this.events,
    }
  }

  get tab(): TabInfo | undefined {
    if (this.currentTabId === 0) return undefined
    return {
      id: this.currentTabId,
      url: this.currentUrl,
      title: this.currentTitle,
      attached: this.attachedState,
    }
  }

  async attach(tabId: number): Promise<TabInfo> {
    if (this.attachedState && this.currentTabId === tabId) return this.tab ?? { id: tabId, attached: true }
    if (this.attachedState) await this.detach()
    this.currentTabId = tabId
    this.wanted = true
    try {
      await this.api.attach({ tabId }, "1.3")
    } catch (err) {
      const message = errorMessage(err)
      this.currentTabId = 0
      this.wanted = false
      this.attachedState = false
      if (/another debugger is already attached/i.test(message)) throw devtoolsConflict()
      throw noTarget(`attach_failed:${message}`)
    }
    this.attachedState = true
    this.attachedAt = this.now()
    this.listen()
    for (const domain of ENABLE_DOMAINS) {
      try {
        await this.command(`${domain}.enable`)
      } catch (err) {
        this.log("cdp.domain_failed", { domain, error: errorMessage(err) })
      }
    }
    await this.readPageInfo()
    this.log("cdp.attach", { tabId })
    return this.tab ?? { id: tabId, attached: true }
  }

  async detach(): Promise<void> {
    const tabId = this.currentTabId
    const wasAttached = this.attachedState
    this.cleanup()
    this.attachedState = false
    this.wanted = false
    this.currentTabId = 0
    this.currentUrl = undefined
    this.currentTitle = undefined
    this.currentFrameId = undefined
    this.mainRequestId = undefined
    this.status = undefined
    this.refs.invalidate()
    if (!wasAttached || tabId === 0) return
    try {
      await this.api.detach({ tabId })
    } catch (err) {
      if (!/not attached|no tab|already detached/i.test(errorMessage(err))) {
        this.log("cdp.detach_failed", { tabId, error: errorMessage(err) })
      }
    }
    this.log("cdp.detach", { tabId })
  }

  async ensure(): Promise<void> {
    if (!this.wanted || this.currentTabId === 0) throw noTarget()
    if (this.attachedState) {
      if (this.now() - this.attachedAt < 1000) return
      const live = await this.targetLive()
      if (live) return
      this.attachedState = false
      this.cleanup()
    }
    await this.attach(this.currentTabId)
  }

  async send(method: string, params: Json = {}): Promise<Json> {
    await this.ensure()
    return this.command(method, params)
  }

  async navigate(url: string, options: NavigateOptions = {}): Promise<NavigateOutcome> {
    const timeoutMs = options.timeoutMs ?? 15000
    const wait = this.arm(options.waitUntil ?? "load", timeoutMs)
    try {
      const result = await page.navigate(this, url)
      if (result.errorText) throw mapNavigationError(url, result.errorText)
    } catch (err) {
      wait.cancel()
      throw err
    }
    await wait.done
    const info = await this.readPageInfo()
    return { url: info.url ?? url, title: info.title ?? "", status: this.status ?? 200 }
  }

  async reload(ignoreCache = false, waitUntil: page.WaitUntil = "load", timeoutMs = 15000): Promise<NavigateOutcome> {
    const wait = this.arm(waitUntil, timeoutMs)
    try {
      await page.reload(this, ignoreCache)
    } catch (err) {
      wait.cancel()
      const message = errorMessage(err)
      if (message.includes("ERR_CONNECTION_REFUSED") || message.includes("ERR_NAME_NOT_RESOLVED")) {
        throw networkRefused(this.currentUrl ?? "", message)
      }
      throw err
    }
    await wait.done
    const info = await this.readPageInfo()
    return { url: info.url ?? "", title: info.title ?? "", status: this.status ?? 200 }
  }

  async screenshot(options: { format?: "png" | "jpeg"; quality?: number; fullPage?: boolean; clip?: Json } = {}) {
    try {
      const data = await page.captureScreenshot(this, options)
      if (data.length === 0) throw noTarget("screenshot_empty")
      return data
    } catch (err) {
      if (err instanceof RpcFailure) throw err
      throw noTarget(`screenshot_failed:${errorMessage(err)}`)
    }
  }

  async readPageInfo(): Promise<{ url?: string; title?: string }> {
    try {
      const tree = await page.frameTree(this)
      const url = page.mainFrameUrl(tree) ?? this.currentUrl
      const frameId = page.frameId(tree) ?? this.currentFrameId
      if (url) this.currentUrl = url
      if (frameId) this.currentFrameId = frameId
      const info = await page.navigationHistory(this)
      if (info.url) this.currentUrl = info.url
      if (info.title) this.currentTitle = info.title
      return { url: this.currentUrl, title: this.currentTitle }
    } catch (err) {
      this.log("cdp.page_info_failed", { error: errorMessage(err) })
      return { url: this.currentUrl, title: this.currentTitle }
    }
  }

  private async command(method: string, params: Json = {}): Promise<Json> {
    if (this.currentTabId === 0) throw noTarget()
    try {
      const result = await this.api.sendCommand({ tabId: this.currentTabId }, method, params)
      return record(result) ?? {}
    } catch (err) {
      const message = errorMessage(err)
      if (/another debugger is already attached/i.test(message)) throw devtoolsConflict()
      if (/no tab|not attached|target closed|detached/i.test(message)) throw noTarget(message)
      throw err
    }
  }

  private async targetLive(): Promise<boolean> {
    try {
      const targets = await this.api.getTargets()
      return targets.some((target) => target.tabId === this.currentTabId && target.attached === true)
    } catch (err) {
      this.log("cdp.targets_failed", { error: errorMessage(err) })
      return false
    }
  }

  private listen() {
    this.cleanup()
    this.listeners.push(
      this.api.onEvent((source, method, params) => {
        if (source.tabId !== this.currentTabId) return
        this.handleEvent(method, record(params) ?? {})
      }),
    )
    this.listeners.push(
      this.api.onDetach((source, reason) => {
        if (source.tabId !== this.currentTabId) return
        this.handleDetach(reason)
      }),
    )
  }

  private cleanup() {
    for (const remove of this.listeners) remove()
    this.listeners = []
    for (const set of this.waiters.values()) {
      for (const waiter of set) {
        clearTimeout(waiter.timer)
        waiter.resolve()
      }
    }
    this.waiters.clear()
    this.pending.clear()
    this.active.clear()
  }

  private handleDetach(reason: string) {
    const tabId = this.currentTabId
    this.cleanup()
    this.attachedState = false
    this.wanted = false
    this.currentTabId = 0
    this.refs.invalidate()
    this.log("cdp.detached", { tabId, reason })
  }

  private handleEvent(method: string, params: Json) {
    this.events.push(method, params)
    if (method === "Page.frameNavigated") {
      const frame = record(params.frame)
      if (frame && text(frame.parentId) === undefined) {
        this.currentUrl = text(frame.url) ?? this.currentUrl
        this.currentFrameId = text(frame.id) ?? this.currentFrameId
        this.mainRequestId = undefined
        this.status = undefined
        this.pending.clear()
        this.active.clear()
        this.refs.invalidate()
      }
      return
    }
    if (method === "Page.loadEventFired") {
      this.emit("load")
      return
    }
    if (method === "Page.domContentEventFired") {
      this.emit("domcontentloaded")
      return
    }
    if (method === "Page.lifecycleEvent") {
      const name = text(params.name)
      if (name === "load") this.emit("load")
      if (name === "DOMContentLoaded") this.emit("domcontentloaded")
      return
    }
    if (method === "Runtime.consoleAPICalled") {
      this.consoleBuffer.push(runtime.consoleEntry(params))
      return
    }
    if (method === "Runtime.exceptionThrown") {
      this.consoleBuffer.push(runtime.exceptionEntry(params))
      return
    }
    if (method === "Log.entryAdded") {
      const entry = runtime.logEntry(params)
      if (entry) this.consoleBuffer.push(entry)
      return
    }
    if (method === "Network.requestWillBeSent") {
      this.requestStarted(params)
      return
    }
    if (method === "Network.responseReceived") {
      this.responseReceived(params)
      return
    }
    if (method === "Network.loadingFinished") {
      this.loadingFinished(params)
      return
    }
    if (method === "Network.loadingFailed") {
      this.loadingFailed(params)
    }
  }

  private requestStarted(params: Json) {
    const start = net.requestStart(params)
    if (!start) return
    const seq = this.networkBuffer.begin(start)
    this.pending.set(start.requestId, { seq, requestId: start.requestId, startedAt: start.timestamp })
    this.active.add(start.requestId)
    if (text(params.type) === "Document") {
      this.mainRequestId = start.requestId
      this.status = undefined
    }
  }

  private responseReceived(params: Json) {
    const requestId = text(params.requestId)
    if (!requestId) return
    const pending = this.pending.get(requestId)
    if (!pending) return
    pending.response = net.responseInfo(params)
    if (requestId === this.mainRequestId && pending.response) {
      this.status = pending.response.status
      if (pending.response.status >= 400) {
        this.log("network.main_failed", { status: pending.response.status, url: this.currentUrl })
      }
    }
  }

  private loadingFinished(params: Json) {
    const requestId = text(params.requestId)
    if (!requestId) return
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.active.delete(requestId)
    const end = net.responseTimestamp(params) ?? this.now()
    const finish = this.finishFor(pending, end)
    pending.finish = finish
    this.networkBuffer.finish(pending.seq, finish)
    this.pending.delete(requestId)
    if (!this.captureBodies || !pending.response || !net.isTextMime(pending.response.mimeType)) return
    void this.captureBody(pending)
  }

  private loadingFailed(params: Json) {
    const requestId = text(params.requestId)
    if (!requestId) return
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.active.delete(requestId)
    const failed = net.loadingFailed(params)
    const end = net.responseTimestamp(params) ?? this.now()
    this.networkBuffer.fail(pending.seq, failed.errorText, end - pending.startedAt)
    this.pending.delete(requestId)
  }

  private finishFor(pending: Pending, end: number): NetworkFinish {
    return {
      status: pending.response?.status ?? 0,
      statusText: pending.response?.statusText,
      mimeType: pending.response?.mimeType,
      durationMs: Math.max(0, end - pending.startedAt),
      headers: pending.response?.headers,
    }
  }

  private async captureBody(pending: Pending) {
    if (pending.bodyTried) return
    pending.bodyTried = true
    try {
      const body = await net.responseBody(this, pending.requestId)
      if (body === undefined || !pending.finish) return
      this.networkBuffer.finish(pending.seq, { ...pending.finish, body })
    } catch (err) {
      this.log("network.body_failed", { requestId: pending.requestId, error: errorMessage(err) })
    }
  }

  private arm(waitUntil: page.WaitUntil, timeoutMs: number): WaitHandle {
    if (waitUntil === "networkidle") {
      const load = this.expect("load", timeoutMs)
      const done = load.done.then(async () => {
        await this.waitIdle(timeoutMs)
      })
      return { done, cancel: load.cancel }
    }
    return this.expect(waitUntil, timeoutMs)
  }

  private expect(event: string, timeoutMs: number): WaitHandle {
    const deferred = Promise.withResolvers<void>()
    let settled = false
    const waiter: Waiter = {
      resolve: () => {
        if (settled) return
        settled = true
        deferred.resolve()
      },
      reject: (err) => {
        if (settled) return
        settled = true
        deferred.reject(err)
      },
      timer: setTimeout(() => {
        this.removeWaiter(event, waiter)
        waiter.reject(timeout(`browser.${event}`, timeoutMs))
      }, timeoutMs),
      event,
    }
    const set = this.waiters.get(event) ?? new Set<Waiter>()
    set.add(waiter)
    this.waiters.set(event, set)
    return {
      done: deferred.promise,
      cancel: () => {
        if (settled) return
        settled = true
        clearTimeout(waiter.timer)
        this.removeWaiter(event, waiter)
        deferred.resolve()
      },
    }
  }

  private emit(event: string) {
    const set = this.waiters.get(event)
    if (!set) return
    this.waiters.delete(event)
    for (const waiter of set) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
  }

  private removeWaiter(event: string, waiter: Waiter) {
    const set = this.waiters.get(event)
    if (!set) return
    set.delete(waiter)
    if (set.size === 0) this.waiters.delete(event)
  }

  private async waitIdle(timeoutMs: number) {
    const deadline = this.now() + timeoutMs
    while (this.now() < deadline) {
      if (this.active.size === 0) {
        await delay(250)
        if (this.active.size === 0) return
      } else {
        await delay(50)
      }
    }
    throw timeout("browser.networkidle", timeoutMs)
  }

  private log(type: string, data: Json) {
    this.onEvent?.({ type, data })
  }
}

function mapNavigationError(url: string, errorText: string): RpcFailure {
  if (errorText.includes("ERR_CONNECTION_REFUSED") || errorText.includes("ERR_NAME_NOT_RESOLVED")) {
    return networkRefused(url, errorText)
  }
  if (errorText.includes("ERR_ABORTED")) return new RpcFailure("CANCELLED", { url, reason: errorText })
  return noTarget(`navigation:${errorText}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
