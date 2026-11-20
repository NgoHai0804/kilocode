import path from "node:path"
import { chmod, mkdir } from "node:fs/promises"
import { timingSafeEqual } from "node:crypto"
import type { BrowserConfig } from "../config/schema"
import { BRIDGE_VERSION, PROTOCOL_VERSION } from "../protocol/version"
import { Pairing } from "./pairing"
import { WsHub, type WsData } from "./ws"
import { UiHost } from "./ui"
import { UiHub } from "./ui-ws"
import { executeTool, handle, type HttpBridge, type ToolCall } from "./http"
import type { BridgeEvent, KiloBackend } from "./kilo"
import { createLogger, type JsonlLogger, type LogEvent } from "../log/jsonl"
import { cleanupArtifacts, ensureSession, ensureTemplates, type SessionNote } from "./memory"
import { checkJail } from "../policy/jail"
import { capDiff, diffFromEvent, type UiDiffFile } from "./ui-files"
import { ApprovalGate } from "./approval"
import { RateLimiter } from "./rate"

export const RUNTIME_FILE = "runtime.json"

export type ServerOptions = {
  workspace: string
  config: BrowserConfig
  kilo: KiloBackend
  home?: string
  pairTtlMs?: number
  token?: string
}

export type RuntimeInfo = {
  httpUrl: string
  wsUrl: string
  token: string
  kiloUrl: string
  pid: number
  startedAt: string
  protocolVersion: string
  bridgeVersion: string
}

export class BridgeServer implements HttpBridge {
  readonly workspace: string
  readonly config: BrowserConfig
  readonly kilo: KiloBackend
  readonly hub: WsHub
  readonly pairing: Pairing
  readonly logger: JsonlLogger
  readonly approvals: ApprovalGate
  readonly ui: UiHub
  readonly uiHost: UiHost
  startedAt = Date.now()
  closing = false
  private server?: ReturnType<typeof Bun.serve<WsData>>
  private stopEvents?: () => void
  private currentTab?: unknown
  private lastActivity = Date.now()
  private idleTimer?: ReturnType<typeof setInterval>
  private readonly claimLimiter = new RateLimiter({ max: 12, windowMs: 60_000 })
  private readonly diffs = new Map<string, UiDiffFile[]>()
  private readonly closedDeferred = Promise.withResolvers<void>()
  constructor(options: ServerOptions) {
    this.workspace = path.resolve(options.workspace)
    this.config = options.config
    this.kilo = options.kilo
    this.pairing = new Pairing({ ttlMs: options.pairTtlMs ?? 120_000, token: options.token })
    this.approvals = new ApprovalGate({
      onEvent: (event) => {
        const data = event.type === "permission.asked"
          ? {
              requestID: event.data.requestID,
              tool: event.data.tool,
              method: event.data.method,
              origin: event.data.origin,
              previewBytes: typeof event.data.preview === "string" ? event.data.preview.length : 0,
              expiresInMs: event.data.expiresInMs,
            }
          : event.data
        this.logEvent({ event: event.type, level: "info", data })
      },
    })
    this.logger = createLogger({
      file: path.resolve(this.workspace, this.config.logging.file),
      maxBytes: this.config.logging.maxBytes,
      keep: this.config.logging.keep,
      level: this.config.logging.level,
      redaction: this.config.redaction,
    })
    this.hub = new WsHub({
      config: this.config,
      pairing: this.pairing,
      onEvent: (event) => {
        this.touch()
        this.logEvent({ event: event.type, level: "debug", data: event.data })
      },
      onClosed: () => {
        this.currentTab = undefined
      },
    })
    this.uiHost = new UiHost({
      workspace: this.workspace,
      kilo: this.kilo,
      home: options.home,
      log: (event) => this.logEvent(event),
    })
    this.ui = new UiHub({
      config: this.config,
      pairing: this.pairing,
      onEvent: (event) => {
        this.touch()
        this.logEvent({ event: event.type, level: "debug", data: event.data })
      },
      onOpen: () => this.uiHost.ready(),
      onClose: () => this.uiHost.close(),
    })
    this.ui.handler = (message) => this.uiHost.handle(message)
    this.uiHost.bind((message) => this.ui.send(message))
  }

  get closed() {
    return this.closedDeferred.promise
  }

  touch() {
    this.lastActivity = Date.now()
  }

  get url() {
    if (!this.server) throw new Error("bridge not started")
    return `http://${this.config.bridge.host}:${this.server.port}`
  }

  get wsUrl() {
    return `${this.url.replace(/^http/, "ws")}/ws`
  }

  get port() {
    if (!this.server) throw new Error("bridge not started")
    return this.server.port
  }

  get pairCode() {
    return this.pairing.code
  }

  get runtimePath() {
    return path.join(this.workspace, ".kilo", "kilo-browser", RUNTIME_FILE)
  }

  token() {
    return this.pairing.currentToken
  }

  pairingOpen() {
    return this.pairing.pairingOpen
  }

  paired() {
    return this.pairing.paired
  }

  claim(input: { pairCode?: string; extensionId: string }) {
    return this.pairing.issue(input)
  }

  limitClaim(key: string) {
    return this.claimLimiter.allow(key)
  }

  tab() {
    return this.currentTab
  }

  setTab(tab: unknown) {
    this.currentTab = tab
  }

  sessionDiff(sessionID: string) {
    return this.diffs.get(sessionID)
  }

  authorized(request: Request) {
    const header = request.headers.get("authorization") ?? ""
    const match = /^Bearer\s+(.+)$/i.exec(header)
    if (!match?.[1]) return false
    const a = Buffer.from(match[1])
    const b = Buffer.from(this.token())
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  async start() {
    if (this.server) return this
    this.startedAt = Date.now()
    this.lastActivity = this.startedAt
    this.closing = false
    if (this.config.memory.enabled) await ensureTemplates(this.workspace)
    await cleanupArtifacts(this.workspace, { retentionDays: this.config.jail.retentionDays })
    const self = this
    this.server = Bun.serve<WsData>({
      hostname: this.config.bridge.host,
      port: this.config.bridge.port,
      fetch(request, server) {
        const url = new URL(request.url)
        if (url.pathname === "/ws") {
          if (url.searchParams.get("role") === "ui") return self.ui.upgrade(request, server)
          return self.hub.upgrade(request, server)
        }
        return handle(request, self, server.requestIP(request)?.address ?? undefined)
      },
      websocket: {
        open(ws) {
          if (ws.data.role === "ui") self.ui.open(ws)
          else self.hub.open(ws)
        },
        message(ws, message) {
          if (ws.data.role === "ui") self.ui.message(ws, message)
          else self.hub.message(ws, message)
        },
        close(ws, code, reason) {
          if (ws.data.role === "ui") self.ui.close(ws, code, reason)
          else self.hub.close(ws, code, reason)
        },
        pong(ws) {
          if (ws.data.role === "ui") self.ui.pong()
          else self.hub.pong()
        },
        maxPayloadLength: Math.max(self.config.bridge.maxPayloadBytes * 2, 1024 * 1024),
      },
    })
    this.uiHost.setPort(this.server.port ?? 0)
    await this.writeRuntime()
    this.stopEvents = this.kilo.startEvents?.((event) => {
      this.observe(event)
      this.uiHost.event(event)
      if (event.channel !== "tool") return
      this.hub.broadcast("tool", event.type, {
        type: event.type,
        data: event.data,
        directory: event.directory,
        id: event.id,
      })
    })
    this.startIdle()
    this.logEvent({
      event: "bridge.start",
      data: {
        version: BRIDGE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        workspace: this.workspace,
        pid: process.pid,
        url: this.url,
      },
    })
    return this
  }

  async stop() {
    if (this.closing) return
    this.closing = true
    this.logEvent({ event: "shutdown.start", data: { reason: "stop" } })
    this.stopEvents?.()
    this.stopEvents = undefined
    this.stopIdle()
    this.hub.stop()
    this.ui.stop()
    this.uiHost.close()
    this.approvals.close()
    this.server?.stop(true)
    this.server = undefined
    await this.removeRuntime()
    this.logEvent({ event: "shutdown.done", data: { forced: false } })
    await this.logger.close()
    this.closedDeferred.resolve()
  }

  async rotate() {
    this.hub.rotate()
    this.ui.disconnect(4000, "PAIR_ROTATED")
    const token = this.token()
    await this.writeRuntime()
    return token
  }

  async revoke() {
    this.hub.revoke()
    this.ui.disconnect(4000, "PAIR_REVOKED")
    const token = this.token()
    await this.writeRuntime()
    return token
  }

  callTool(call: ToolCall) {
    return executeTool(this, call)
  }

  runtime(): RuntimeInfo {
    return {
      httpUrl: this.url,
      wsUrl: this.wsUrl,
      token: this.token(),
      kiloUrl: this.kilo.url,
      pid: process.pid,
      startedAt: new Date(this.startedAt).toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: BRIDGE_VERSION,
    }
  }

  logEvent(event: LogEvent) {
    void this.logger.log(event).catch((err: unknown) => {
      process.stderr.write(`kilo-browser log: ${err instanceof Error ? err.message : "write failed"}\n`)
    })
  }

  private startIdle() {
    if (this.idleTimer || this.config.bridge.idleTimeoutMs <= 0) return
    const period = Math.max(1_000, Math.min(60_000, Math.floor(this.config.bridge.idleTimeoutMs / 2)))
    this.idleTimer = setInterval(() => {
      if (this.closing) return
      if (Date.now() - this.lastActivity < this.config.bridge.idleTimeoutMs) return
      this.logEvent({ event: "bridge.idle", level: "info", data: { idleTimeoutMs: this.config.bridge.idleTimeoutMs } })
      void this.stop()
    }, period)
  }

  private stopIdle() {
    if (!this.idleTimer) return
    clearInterval(this.idleTimer)
    this.idleTimer = undefined
  }

  private observe(event: BridgeEvent) {
    if (event.type === "session.diff") this.captureDiff(event)
    if (event.type !== "session.turn.close") return
    if (!this.config.memory.enabled || !this.config.memory.sessionLog) return
    const sessionID = sessionOf(event.data)
    if (!sessionID) return
    void ensureSession(this.workspace, sessionID, noteOf(event.data), { redaction: this.config.redaction }).catch(
      (err: unknown) => {
        process.stderr.write(`kilo-browser memory: ${err instanceof Error ? err.message : "session note failed"}\n`)
      },
    )
  }

  private captureDiff(event: BridgeEvent) {
    const data = isRecord(event.data) ? event.data : {}
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
    if (!sessionID) return
    const files = capDiff(diffFromEvent(data))
    if (files.length === 0) return
    this.diffs.set(sessionID, files)
    if (this.diffs.size <= 50) return
    const oldest = this.diffs.keys().next().value
    if (oldest !== undefined) this.diffs.delete(oldest)
  }

  private async writeRuntime() {
    const file = this.runtimePath
    await checkJail([this.workspace], file)
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await Bun.write(file, `${JSON.stringify(this.runtime(), null, 2)}\n`)
    if (process.platform !== "win32") await chmod(file, 0o600)
  }

  private async removeRuntime() {
    const file = this.runtimePath
    try {
      await Bun.file(file).delete()
    } catch (err) {
      if (!isMissing(err)) throw err
    }
  }
}

function sessionOf(data: unknown) {
  if (!isRecord(data)) return undefined
  return typeof data.sessionID === "string" ? data.sessionID : undefined
}

function noteOf(data: unknown): Partial<Omit<SessionNote, "sessionID">> {
  if (!isRecord(data)) return {}
  const note: Partial<Omit<SessionNote, "sessionID">> = {}
  for (const key of ["date", "goal", "url", "steps", "artifacts", "conclusion"] as const) {
    if (typeof data[key] === "string") note[key] = data[key] as string
  }
  if (data.status === "open" || data.status === "fixed" || data.status === "blocked") note.status = data.status
  return note
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissing(err: unknown) {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code
  return code === "ENOENT"
}