import type { Server, ServerWebSocket } from "bun"
import type { BrowserConfig } from "../config/schema"
import { WS_SUBPROTOCOL } from "../protocol/version"
import { extensionId } from "../policy/origin"
import type { Pairing } from "./pairing"
import type { WsData } from "./ws"
import { RateLimiter } from "./rate"
import type { ExtensionMessage, WebviewMessage } from "@kilo-webview/src/types/messages"
import type { HostCapabilities } from "@kilo-webview/src/host/HostBridge"

export type UiMessage = ExtensionMessage & { capabilities?: Partial<HostCapabilities> }

export type UiOptions = {
  config: BrowserConfig
  pairing: Pairing
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
  onOpen?: () => void
  onClose?: () => void
}

const TOKEN_PROTOCOL = "token."
const RATE_MAX = 120
const RATE_WINDOW_MS = 2000
const MAX_STRIKES = 10
const STRIKE_WINDOW_MS = 10_000

// Rate limits and strikes belong to a single socket: one misbehaving surface
// must not spend another surface's budget or close it.
type UiPeer = {
  lastPong: number
  limiter: RateLimiter
  strikes: number
  strikeAt: number
}

function newPeer(): UiPeer {
  return {
    lastPong: Date.now(),
    limiter: new RateLimiter({ max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
    strikes: 0,
    strikeAt: 0,
  }
}

export class UiHub {
  handler?: (message: WebviewMessage) => void
  private readonly config: BrowserConfig
  private readonly pairing: Pairing
  private readonly onEvent?: UiOptions["onEvent"]
  private readonly onOpen?: UiOptions["onOpen"]
  private readonly onClose?: UiOptions["onClose"]
  // Several UI surfaces can be connected at once (side panel, a settings tab,
  // file/diff viewers). Messages fan out to every open socket; each entry keeps
  // that socket's own heartbeat, rate limit, and strike state.
  private readonly sockets = new Map<ServerWebSocket<WsData>, UiPeer>()
  private heartbeat?: ReturnType<typeof setInterval>
  private id?: string

  constructor(options: UiOptions) {
    this.config = options.config
    this.pairing = options.pairing
    this.onEvent = options.onEvent
    this.onOpen = options.onOpen
    this.onClose = options.onClose
  }

  get connected() {
    return this.sockets.size > 0
  }

  get extension() {
    return this.id
  }

  upgrade(request: Request, server: Server<WsData>) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("upgrade required", { status: 426 })
    }
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    if (!protocols.includes(WS_SUBPROTOCOL)) {
      return new Response("unsupported websocket subprotocol", { status: 400 })
    }
    const origin = request.headers.get("origin")
    const id = extensionId(origin)
    if (!origin || !id) return new Response("extension origin required", { status: 403 })
    const allowed = this.config.browser.allowedExtensionIds
    if (allowed.length > 0 && !allowed.includes(id)) {
      return new Response("extension id not allowed", { status: 403 })
    }
    const token = tokenFromProtocol(protocols)
    if (!token || !this.pairing.verify(token)) {
      return new Response("unauthorized", { status: 401 })
    }
    const ok = server.upgrade(request, {
      data: { role: "ui", origin, id },
      headers: { "Sec-WebSocket-Protocol": WS_SUBPROTOCOL },
    })
    if (!ok) return new Response("websocket upgrade failed", { status: 400 })
    return undefined
  }

  open(ws: ServerWebSocket<WsData>) {
    this.sockets.set(ws, newPeer())
    this.id = ws.data.id
    this.onEvent?.({ type: "ui.port.open", data: { extensionId: ws.data.id, origin: ws.data.origin } })
    this.startHeartbeat()
    if (this.sockets.size === 1) this.onOpen?.()
  }

  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    const entry = this.sockets.get(ws)
    if (!entry) return
    const text = typeof raw === "string" ? raw : raw.toString("utf8")
    if (Buffer.byteLength(text) > this.config.bridge.maxPayloadBytes) {
      ws.close(4009, "MESSAGE_TOO_BIG")
      return
    }
    if (!entry.limiter.allow("ui")) {
      this.strike(ws, entry)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      this.sendError(ws, "Invalid JSON", "PARSE_ERROR")
      return
    }
    if (!isRecord(parsed) || parsed.kind !== "ui" || !isRecord(parsed.message)) {
      this.sendError(ws, "Invalid UI envelope", "INVALID_REQUEST")
      return
    }
    if (typeof parsed.message.type !== "string") {
      this.sendError(ws, "UI envelope message has no type", "INVALID_REQUEST")
      return
    }
    this.onEvent?.({ type: "ui.rpc.request", data: { message: parsed.message.type, id: typeof parsed.id === "string" ? parsed.id : undefined } })
    this.handler?.(parsed.message as unknown as WebviewMessage)
  }

  close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
    if (!this.sockets.delete(ws)) return
    this.onEvent?.({ type: "ui.port.close", data: { extensionId: ws.data.id, code, reason } })
    if (this.sockets.size > 0) return
    this.id = undefined
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    this.onClose?.()
  }

  pong(ws: ServerWebSocket<WsData>) {
    const entry = this.sockets.get(ws)
    if (entry) entry.lastPong = Date.now()
  }

  send(message: UiMessage) {
    if (this.sockets.size === 0) return
    const payload = JSON.stringify({ kind: "ui", message })
    for (const socket of this.sockets.keys()) {
      if (socket.readyState === 1) socket.send(payload)
    }
  }

  disconnect(code: number, reason: string) {
    for (const socket of this.sockets.keys()) socket.close(code, reason)
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const socket of this.sockets.keys()) socket.close(1001, "BRIDGE_SHUTDOWN")
    this.sockets.clear()
    this.id = undefined
  }

  private startHeartbeat() {
    if (this.heartbeat) return
    this.heartbeat = setInterval(() => {
      const now = Date.now()
      for (const [socket, entry] of this.sockets) {
        if (now - entry.lastPong > this.config.bridge.pongTimeoutMs) {
          socket.close(4003, "HEARTBEAT_TIMEOUT")
          continue
        }
        socket.ping()
      }
    }, this.config.bridge.heartbeatMs)
  }

  private strike(ws: ServerWebSocket<WsData>, entry: UiPeer) {
    const now = Date.now()
    if (now - entry.strikeAt > STRIKE_WINDOW_MS) {
      entry.strikes = 0
      entry.strikeAt = now
    }
    entry.strikes += 1
    this.onEvent?.({ type: "ui.rpc.error", data: { kind: "RATE_LIMIT", strikes: entry.strikes } })
    if (entry.strikes >= MAX_STRIKES) {
      ws.close(4008, "RATE_LIMIT")
      return
    }
    this.sendError(ws, "UI rate limit exceeded", "RATE_LIMIT")
  }

  private sendError(ws: ServerWebSocket<WsData>, message: string, code: string) {
    if (ws.readyState !== 1) return
    ws.send(JSON.stringify({ kind: "ui", message: { type: "error", message, code } }))
  }
}

function tokenFromProtocol(protocols: string[]) {
  for (const protocol of protocols) {
    if (protocol.startsWith(TOKEN_PROTOCOL)) return protocol.slice(TOKEN_PROTOCOL.length)
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
