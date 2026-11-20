import { rpcError } from "../../../src/protocol/rpc"
import { PROTOCOL_VERSION } from "../../../src/protocol/version"
import type { Router } from "../rpc/router"
import type { Json } from "../util/value"
import { errorMessage, record, text } from "../util/value"

export type ConnectionState = "disconnected" | "connecting" | "pairing" | "connected" | "reconnecting" | "blocked"

export type PairingData = {
  extensionId: string
  token: string
  bridgeUrl: string
  pairedAt: string
}

export interface Socket {
  send(data: string): void
  close(code?: number, reason?: string): void
  onOpen(listener: () => void): () => void
  onClose(listener: (code: number, reason: string) => void): () => void
  onMessage(listener: (data: string) => void): () => void
  onError(listener: (error: unknown) => void): () => void
}

export type Timers = {
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}

export type TransportOptions = {
  router: Router
  loadPairing: () => Promise<PairingData | null>
  savePairing: (pairing: PairingData) => Promise<void>
  clearPairing: () => Promise<void>
  bridgeUrl: () => Promise<string | undefined>
  createSocket: (url: string) => Socket
  extensionId: string
  extensionVersion: string
  autoReconnect?: boolean
  pairCode?: string
  now?: () => number
  random?: () => number
  timers?: Timers
  onState?: (state: ConnectionState, detail?: Json) => void
  onEvent?: (event: { type: string; data: Json }) => void
}

const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000]
const MAX_ATTEMPTS = 10
const HELLO_TIMEOUT_MS = 10_000
const HEARTBEAT_TIMEOUT_MS = 30_000
const HELLO_ID = "hello"

export class BridgeTransport {
  private readonly options: TransportOptions
  private readonly timers: Timers
  private readonly now: () => number
  private readonly random: () => number
  private socket?: Socket
  private unsubscribers: (() => void)[] = []
  private stateValue: ConnectionState = "disconnected"
  private hello?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setTimeout>
  private reconnect?: ReturnType<typeof setTimeout>
  private pairCode?: string
  private attempts = 0
  private stopped = true
  private lastInboundAt = 0

  constructor(options: TransportOptions) {
    this.options = options
    this.timers = options.timers ?? { setTimeout, clearTimeout }
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.pairCode = options.pairCode
  }

  get state() {
    return this.stateValue
  }

  get connected() {
    return this.stateValue === "connected"
  }

  get socketUrl() {
    return this.socketUrlValue
  }

  checkHeartbeat() {
    if (this.stateValue !== "connected" || !this.socket) return
    if (this.lastInboundAt === 0) return
    if (this.now() - this.lastInboundAt < HEARTBEAT_TIMEOUT_MS) return
    this.log("ws.heartbeat_timeout", { source: "alarm" })
    this.socket.close(4003, "HEARTBEAT_TIMEOUT")
  }

  private socketUrlValue?: string

  async start() {
    this.stopped = false
    this.attempts = 0
    await this.connect()
  }

  async pair(code: string) {
    this.pairCode = code
    this.stopped = false
    this.attempts = 0
    await this.connect(true)
  }

  async reconnectNow() {
    this.stopped = false
    this.attempts = 0
    await this.connect(true)
  }

  stop() {
    this.stopped = true
    this.clearTimers()
    const socket = this.socket
    this.socket = undefined
    this.unsubscribe()
    if (socket) {
      try {
        socket.close(1000, "CLIENT_SHUTDOWN")
      } catch (err) {
        this.log("ws.close_failed", { error: errorMessage(err) })
      }
    }
    this.setState("disconnected", { reason: "stopped" })
  }

  async connect(force = false) {
    if (!force && (this.stateValue === "connecting" || this.stateValue === "pairing" || this.stateValue === "connected")) {
      return
    }
    this.clearTimers()
    this.unsubscribe()
    const previous = this.socket
    this.socket = undefined
    if (previous) {
      try {
        previous.close(1000, "RECONNECT")
      } catch (err) {
        this.log("ws.close_failed", { error: errorMessage(err) })
      }
    }
    const pairing = await this.options.loadPairing()
    const url = pairing?.bridgeUrl ?? (await this.options.bridgeUrl())
    if (!url) {
      this.setState("disconnected", { reason: "not_paired" })
      return
    }
    this.socketUrlValue = url
    this.setState("connecting", { url })
    const socket = this.options.createSocket(url)
    this.socket = socket
    this.unsubscribers = [
      socket.onOpen(() => this.handleOpen(socket, url, pairing)),
      socket.onMessage((data) => void this.handleMessage(socket, data)),
      socket.onClose((code, reason) => this.handleClose(socket, code, reason)),
      socket.onError((error) => this.handleError(socket, error)),
    ]
  }

  private handleOpen(socket: Socket, url: string, pairing: PairingData | null) {
    if (this.socket !== socket) return
    this.options.router.reset()
    this.setState("pairing", { url })
    this.hello = this.timers.setTimeout(() => {
      this.log("ws.hello_timeout", { url })
      socket.close(4004, "HELLO_TIMEOUT")
    }, HELLO_TIMEOUT_MS)
    const params: Json = {
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: this.options.extensionVersion,
      extensionId: this.options.extensionId,
    }
    if (pairing?.token) params.bridgeToken = pairing.token
    if (!pairing?.token && this.pairCode) params.pairCode = this.pairCode
    this.send(socket, { jsonrpc: "2.0", id: HELLO_ID, method: "hello", params })
  }

  private async handleMessage(socket: Socket, data: string) {
    if (this.socket !== socket) return
    this.lastInboundAt = this.now()
    this.armHeartbeat()
    let message: unknown
    try {
      message = JSON.parse(data) as unknown
    } catch (err) {
      this.log("ws.parse_error", { error: errorMessage(err) })
      this.send(socket, { jsonrpc: "2.0", id: null, error: rpcError("PARSE_ERROR") })
      return
    }
    const body = record(message)
    if (!body) {
      this.send(socket, { jsonrpc: "2.0", id: null, error: rpcError("INVALID_REQUEST") })
      return
    }
    if (body.id === HELLO_ID && body.method === undefined) {
      await this.handleHello(socket, body)
      return
    }
    if (body.method === "ping") {
      this.send(socket, { jsonrpc: "2.0", method: "pong", params: {} })
      return
    }
    if (body.method === "pong") return
    if (typeof body.method === "string" && body.method.startsWith("browser.")) {
      const response = await this.options.router.handle(body)
      if (response) this.send(socket, response as unknown as Json)
      return
    }
    this.log("ws.unhandled", { method: typeof body.method === "string" ? body.method : undefined })
  }

  private async handleHello(socket: Socket, body: Json) {
    if (this.hello) this.timers.clearTimeout(this.hello)
    this.hello = undefined
    const error = record(body.error)
    if (error) {
      const data = record(error.data)
      const kind = data && typeof data.kind === "string" ? data.kind : "UNAUTHORIZED"
      this.log("ws.hello_failed", { kind })
      if (kind === "UNAUTHORIZED" || kind === "LOCKED" || kind === "BAD_CODE") await this.options.clearPairing()
      this.setState("blocked", { reason: kind })
      socket.close(4004, kind)
      return
    }
    const result = record(body.result)
    const token = result ? text(result.token) : undefined
    if (!result || !token) {
      this.setState("blocked", { reason: "invalid_hello" })
      socket.close(4004, "INVALID_HELLO")
      return
    }
    const url = this.socketUrlValue ?? ""
    await this.options.savePairing({
      extensionId: this.options.extensionId,
      token,
      bridgeUrl: url,
      pairedAt: new Date(this.now()).toISOString(),
    })
    this.pairCode = undefined
    this.attempts = 0
    this.lastInboundAt = this.now()
    this.setState("connected", { url })
    this.armHeartbeat()
  }

  private handleClose(socket: Socket, code: number, reason: string) {
    if (this.socket !== socket) return
    this.socket = undefined
    this.unsubscribe()
    this.clearTimers()
    this.log("ws.close", { code, reason })
    this.setState("disconnected", { code, reason })
    if (this.stopped) return
    if (code === 4000) {
      void this.options.clearPairing()
      this.setState("blocked", { reason: "pair_rotated" })
      return
    }
    if (code === 4001) {
      this.scheduleReconnect(true)
      return
    }
    if (code === 4002) {
      this.setState("blocked", { reason: "version_mismatch" })
      return
    }
    if (code === 4004) {
      void this.options.clearPairing()
      this.setState("blocked", { reason: "pair_required" })
      return
    }
    if (this.options.autoReconnect === false) return
    this.scheduleReconnect()
  }

  private handleError(socket: Socket, error: unknown) {
    if (this.socket !== socket) return
    this.log("ws.error", { error: errorMessage(error) })
    try {
      socket.close(4003, "SOCKET_ERROR")
    } catch (err) {
      this.log("ws.close_failed", { error: errorMessage(err) })
    }
  }

  private scheduleReconnect(endless = false) {
    if (this.stopped) return
    if (!endless && this.attempts >= MAX_ATTEMPTS) {
      this.setState("blocked", { reason: "max_retries" })
      return
    }
    const delay = backoffDelay(this.attempts, this.random)
    this.attempts += 1
    this.setState("reconnecting", { attempt: this.attempts, delay })
    this.reconnect = this.timers.setTimeout(() => {
      void this.connect(true)
    }, delay)
  }

  private armHeartbeat() {
    if (this.heartbeat) this.timers.clearTimeout(this.heartbeat)
    this.heartbeat = this.timers.setTimeout(() => {
      this.log("ws.heartbeat_timeout", {})
      const socket = this.socket
      if (socket) socket.close(4003, "HEARTBEAT_TIMEOUT")
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private send(socket: Socket, message: Json) {
    try {
      socket.send(JSON.stringify(message))
    } catch (err) {
      this.log("ws.send_failed", { error: errorMessage(err) })
    }
  }

  private unsubscribe() {
    for (const remove of this.unsubscribers) remove()
    this.unsubscribers = []
  }

  private clearTimers() {
    if (this.hello) this.timers.clearTimeout(this.hello)
    if (this.heartbeat) this.timers.clearTimeout(this.heartbeat)
    if (this.reconnect) this.timers.clearTimeout(this.reconnect)
    this.hello = undefined
    this.heartbeat = undefined
    this.reconnect = undefined
  }

  private setState(state: ConnectionState, detail: Json = {}) {
    this.stateValue = state
    this.options.onState?.(state, detail)
  }

  private log(type: string, data: Json) {
    this.options.onEvent?.({ type, data })
  }
}

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)] ?? 8000
  const jitter = base * 0.2 * (random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}
