import type { Server, ServerWebSocket } from "bun"
import type { BrowserConfig } from "../config/schema"
import { BRIDGE_VERSION, PROTOCOL_VERSION, WS_SUBPROTOCOL, negotiate } from "../protocol/version"
import { RpcFailure, RpcPeer } from "../protocol/rpc"
import { extensionId } from "../policy/origin"
import { Pairing } from "./pairing"
import { RateLimiter } from "./rate"

export type WsData = {
  role?: "tool" | "ui"
  origin: string
  id?: string
  reject?: boolean
}

export type WsOptions = {
  config: BrowserConfig
  pairing: Pairing
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
  onAuthenticated?: (info: { extensionId: string; token: string }) => void
  onClosed?: () => void
}

const RATE_MAX = 40
const RATE_WINDOW_MS = 2000

export class WsHub {
  private readonly config: BrowserConfig
  private readonly pairing: Pairing
  private readonly onEvent?: WsOptions["onEvent"]
  private readonly onAuthenticated?: WsOptions["onAuthenticated"]
  private readonly onClosed?: WsOptions["onClosed"]
  private socket?: ServerWebSocket<WsData>
  private peer?: RpcPeer
  private heartbeat?: ReturnType<typeof setInterval>
  private handshake?: ReturnType<typeof setTimeout>
  private lastPong = 0
  private limiter = new RateLimiter({ max: RATE_MAX, windowMs: RATE_WINDOW_MS })
  private auth = false
  private id?: string

  constructor(options: WsOptions) {
    this.config = options.config
    this.pairing = options.pairing
    this.onEvent = options.onEvent
    this.onAuthenticated = options.onAuthenticated
    this.onClosed = options.onClosed
  }

  get authenticated() {
    return this.auth
  }

  get extension() {
    return this.id
  }

  get connected() {
    return this.socket !== undefined
  }

  get rpc() {
    return this.peer
  }

  upgrade(request: Request, server: Server<WsData>) {
    const url = new URL(request.url)
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 })
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("upgrade required", { status: 426 })
    }
    const protocols = request.headers.get("sec-websocket-protocol") ?? ""
    if (!protocols.split(",").map((item) => item.trim()).includes(WS_SUBPROTOCOL)) {
      return new Response("unsupported websocket subprotocol", { status: 400 })
    }
    const origin = request.headers.get("origin")
    const id = extensionId(origin)
    if (!origin || !id) return new Response("extension origin required", { status: 403 })
    const allowed = this.config.browser.allowedExtensionIds
    if (allowed.length > 0 && !allowed.includes(id)) {
      return new Response("extension id not allowed", { status: 403 })
    }
    const rejected = this.socket !== undefined
    const ok = server.upgrade(request, {
      data: { role: "tool", origin, id, reject: rejected },
      headers: { "Sec-WebSocket-Protocol": WS_SUBPROTOCOL },
    })
    if (!ok) return new Response("websocket upgrade failed", { status: 400 })
    return undefined
  }

  open(ws: ServerWebSocket<WsData>) {
    if (ws.data.reject) {
      ws.close(4001, "ALREADY_PAIRED")
      return
    }
    this.socket = ws
    this.id = ws.data.id
    this.auth = false
    this.lastPong = Date.now()
    this.limiter = new RateLimiter({ max: RATE_MAX, windowMs: RATE_WINDOW_MS })
    this.onEvent?.({ type: "ws.open", data: { extensionId: ws.data.id, origin: ws.data.origin } })
    this.handshake = setTimeout(() => {
      if (!this.auth) ws.close(4004, "PAIRING_TIMEOUT")
    }, 10_000)
  }

  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    const text = typeof raw === "string" ? raw : raw.toString("utf8")
    if (Buffer.byteLength(text) > this.config.bridge.maxPayloadBytes) {
      ws.close(4009, "MESSAGE_TOO_BIG")
      return
    }
    if (!this.rateAllow()) {
      const id = idOf(text)
      if (id !== undefined) ws.send(JSON.stringify({ jsonrpc: "2.0", id, error: rateError() }))
      this.onEvent?.({ type: "ws.rate_limit", data: { extensionId: this.id } })
      return
    }
    let message: unknown
    try {
      message = JSON.parse(text) as unknown
    } catch {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: null, error: parseError() }))
      return
    }
    if (!isRecord(message)) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: null, error: invalidRequest() }))
      return
    }
    if (!this.auth) {
      this.hello(ws, message)
      return
    }
    this.afterHello(ws, message)
  }

  close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
    if (this.socket !== ws) return
    this.socket = undefined
    this.peer?.close(new RpcFailure("NOT_PAIRED", { reason: "extension disconnected" }))
    this.peer = undefined
    this.auth = false
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.handshake) clearTimeout(this.handshake)
    this.heartbeat = undefined
    this.handshake = undefined
    this.onEvent?.({ type: "ws.close", data: { extensionId: this.id, code, reason } })
    this.onClosed?.()
  }

  pong() {
    this.lastPong = Date.now()
  }

  send(message: Record<string, unknown>) {
    this.socket?.send(JSON.stringify(message))
  }

  broadcast(channel: "ui" | "tool", type: string, data: unknown) {
    if (!this.socket || !this.auth) return
    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: channel === "ui" ? "ui.event" : "tool.event",
        params: { type, data },
      }),
    )
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs: number) {
    if (!this.peer || !this.auth) throw new RpcFailure("NOT_PAIRED")
    return this.peer.call(method, params, timeoutMs)
  }

  rotate() {
    this.pairing.rotate()
    this.disconnect(4000, "PAIR_ROTATED")
  }

  revoke() {
    this.pairing.revoke()
    this.disconnect(4000, "PAIR_REVOKED")
  }

  disconnect(code: number, reason: string) {
    const socket = this.socket
    if (socket) socket.close(code, reason)
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.handshake) clearTimeout(this.handshake)
    this.heartbeat = undefined
    this.handshake = undefined
    if (this.socket) this.socket.close(1001, "BRIDGE_SHUTDOWN")
    this.socket = undefined
    this.peer?.close()
    this.peer = undefined
    this.auth = false
  }

  private hello(ws: ServerWebSocket<WsData>, message: Record<string, unknown>) {
    const id = message.id
    if (message.method !== "hello") {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: unauthorized() }))
      ws.close(4004, "HELLO_REQUIRED")
      return
    }
    const params = isRecord(message.params) ? message.params : {}
    const version = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
    const negotiation = negotiate(version)
    if (!negotiation.ok) {
      ws.close(4002, JSON.stringify({ required: negotiation.required, got: negotiation.got }))
      return
    }
    const pairCode = typeof params.pairCode === "string" ? params.pairCode : undefined
    const token = typeof params.bridgeToken === "string" ? params.bridgeToken : undefined
    if (!this.id) {
      ws.close(4004, "MISSING_EXTENSION_ID")
      return
    }
    const result = this.pairing.issue({ pairCode, token, extensionId: this.id })
    if (!result.ok) {
      this.onEvent?.({
        type: result.kind === "LOCKED" ? "pair.lockout" : "pair.fail",
        data: { attempt: result.attempt ?? 0, extensionId: this.id, kind: result.kind },
      })
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: id ?? null,
          error: new RpcFailure("UNAUTHORIZED", { kind: result.kind }).body,
        }),
      )
      if (result.kind === "LOCKED" || result.kind === "UNAUTHORIZED") ws.close(4004, result.kind)
      return
    }
    this.auth = true
    if (this.handshake) clearTimeout(this.handshake)
    this.handshake = undefined
    this.lastPong = Date.now()
    this.peer = new RpcPeer({ send: (payload) => ws.send(JSON.stringify(payload)) })
    this.startHeartbeat()
    this.onEvent?.({ type: "pair.ok", data: { extensionId: this.id } })
    this.onAuthenticated?.({ extensionId: this.id, token: result.token })
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          ok: true,
          protocolVersion: PROTOCOL_VERSION,
          bridgeVersion: BRIDGE_VERSION,
          token: result.token,
          heartbeatMs: this.config.bridge.heartbeatMs,
        },
      }),
    )
  }

  private afterHello(ws: ServerWebSocket<WsData>, message: Record<string, unknown>) {
    if (message.method === "pong") {
      this.pong()
      return
    }
    if (message.method === "ping") {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "pong", params: {} }))
      return
    }
    if (message.method === "browser.cancel" && isRecord(message.params)) {
      const requestId = message.params.requestId
      if (typeof requestId === "string" || typeof requestId === "number") this.peer?.cancel(requestId)
      return
    }
    if (message.method === "ui.event" || message.method === "tool.event") return
    if (message.method !== undefined) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id ?? null,
          error: { code: -32601, message: "METHOD_NOT_FOUND", data: { kind: "METHOD_NOT_FOUND" } },
        }),
      )
      return
    }
    this.peer?.accept(message)
  }

  private startHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = setInterval(() => {
      if (!this.socket) return
      if (Date.now() - this.lastPong > this.config.bridge.pongTimeoutMs) {
        this.socket.close(4003, "HEARTBEAT_TIMEOUT")
        return
      }
      this.send({ jsonrpc: "2.0", method: "ping", params: {} })
    }, this.config.bridge.heartbeatMs)
  }

  private rateAllow() {
    return this.limiter.allow("tool")
  }
}

function idOf(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) return undefined
    return parsed.id
  } catch {
    return undefined
  }
}

function parseError() {
  return { code: -32700, message: "PARSE_ERROR", data: { kind: "PARSE_ERROR", retryable: false } }
}

function invalidRequest() {
  return { code: -32600, message: "INVALID_REQUEST", data: { kind: "INVALID_REQUEST", retryable: false } }
}

function unauthorized() {
  return new RpcFailure("UNAUTHORIZED").body
}

function rateError() {
  return new RpcFailure("RATE_LIMIT").body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

