import { RpcFailure, rpcError, type RpcErrorBody } from "../../../src/protocol/rpc"
import type { Json } from "../util/value"
import { errorMessage, isRecord } from "../util/value"

export type RpcId = string | number

export type Handler = (params: Json, signal: AbortSignal) => Promise<unknown>

export type RegisterOptions = {
  timeoutMs?: number
  idempotent?: boolean
}

export type RpcResponse = {
  jsonrpc: "2.0"
  id: RpcId | null
  result?: unknown
  error?: RpcErrorBody
}

export type RouterOptions = {
  busyWaitMs?: number
  cacheTtlMs?: number
  now?: () => number
  onEvent?: (event: { type: string; data: Json }) => void
}

type Registered = {
  handler: Handler
  timeoutMs: number
  idempotent: boolean
}

type Call = {
  id: RpcId
  method: string
  params: Json
  registered: Registered
  deferred: PromiseWithResolvers<unknown>
  timer?: ReturnType<typeof setTimeout>
  controller: AbortController
  cacheKey?: string
  settled: boolean
  queuedAt: number
}

type Cached = { at: number; result: unknown }

const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_BUSY_WAIT_MS = 5000
const DEFAULT_CACHE_TTL_MS = 60_000

export class Router {
  private readonly registered = new Map<string, Registered>()
  private readonly cache = new Map<string, Cached>()
  private readonly busyWaitMs: number
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private readonly onEvent?: RouterOptions["onEvent"]
  private current?: Call
  private queue: Call[] = []
  private next = 0

  constructor(options: RouterOptions = {}) {
    this.busyWaitMs = options.busyWaitMs ?? DEFAULT_BUSY_WAIT_MS
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.now = options.now ?? Date.now
    this.onEvent = options.onEvent
  }

  register(method: string, handler: Handler, options: RegisterOptions = {}) {
    this.registered.set(method, {
      handler,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      idempotent: options.idempotent === true,
    })
  }

  get busy() {
    return this.current !== undefined
  }

  get inflight() {
    return this.current?.method
  }

  get queued() {
    return this.queue.length
  }

  /**
   * Drop cached idempotent results. The transport calls this when a fresh
   * WebSocket connection opens so a reconnecting bridge is never served a
   * result cached for a previous connection.
   */
  reset() {
    this.cache.clear()
  }

  async handleText(text: string): Promise<RpcResponse | undefined> {
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      return { jsonrpc: "2.0", id: null, error: rpcError("PARSE_ERROR") }
    }
    return this.handle(parsed)
  }

  async handle(message: unknown): Promise<RpcResponse | undefined> {
    this.prune()
    if (!isRecord(message) || message.jsonrpc !== "2.0") {
      return { jsonrpc: "2.0", id: null, error: rpcError("INVALID_REQUEST") }
    }
    const method = typeof message.method === "string" ? message.method : undefined
    if (!method) return { jsonrpc: "2.0", id: idOf(message) ?? null, error: rpcError("INVALID_REQUEST") }
    const params = isRecord(message.params) ? message.params : {}
    const id = idOf(message)

    if (method === "browser.cancel") {
      const requestId = params.requestId
      if (typeof requestId === "string" || typeof requestId === "number") this.cancel(requestId)
      return id === undefined ? undefined : { jsonrpc: "2.0", id, result: {} }
    }

    const registered = this.registered.get(method)
    if (!registered) {
      return { jsonrpc: "2.0", id: id ?? null, error: rpcError("METHOD_NOT_FOUND", { method }) }
    }
    if (id === undefined) return undefined

    const cacheKey = registered.idempotent ? `${method}:${String(id)}` : undefined
    if (cacheKey) {
      const cached = this.cache.get(cacheKey)
      if (cached && this.now() - cached.at <= this.cacheTtlMs) {
        return { jsonrpc: "2.0", id, result: cached.result }
      }
      if (cached) this.cache.delete(cacheKey)
    }

    const deferred = Promise.withResolvers<unknown>()
    const call: Call = {
      id,
      method,
      params,
      registered,
      deferred,
      controller: new AbortController(),
      cacheKey,
      settled: false,
      queuedAt: this.now(),
    }

    if (this.current) {
      call.timer = setTimeout(() => {
        const index = this.queue.indexOf(call)
        if (index >= 0) this.queue.splice(index, 1)
        this.settle(call, new RpcFailure("BUSY", { method }))
      }, this.busyWaitMs)
      this.queue.push(call)
    } else {
      this.run(call)
    }

    try {
      const result = await deferred.promise
      return { jsonrpc: "2.0", id, result }
    } catch (error) {
      return { jsonrpc: "2.0", id, error: toFailure(error).body }
    }
  }

  cancel(id: RpcId) {
    if (this.current && this.current.id === id) {
      this.current.controller.abort()
      this.settle(this.current, new RpcFailure("CANCELLED", { requestId: id }))
      if (this.current) this.finish(this.current)
      return true
    }
    const index = this.queue.findIndex((item) => item.id === id)
    if (index < 0) return false
    const call = this.queue.splice(index, 1)[0]
    if (call) {
      if (call.timer) clearTimeout(call.timer)
      this.settle(call, new RpcFailure("CANCELLED", { requestId: id }))
    }
    return true
  }

  private prune() {
    if (this.cache.size < 200) return
    const cutoff = this.now() - this.cacheTtlMs
    for (const [key, item] of this.cache) {
      if (item.at < cutoff) this.cache.delete(key)
    }
  }

  private run(call: Call) {
    this.current = call
    this.onEvent?.({ type: "rpc.start", data: { method: call.method, id: String(call.id) } })
    call.timer = setTimeout(() => {
      call.controller.abort()
      this.settle(call, new RpcFailure("TIMEOUT", { method: call.method, timeoutMs: call.registered.timeoutMs }))
      this.finish(call)
    }, call.registered.timeoutMs)

    call.registered.handler(call.params, call.controller.signal).then(
      (value) => {
        this.settle(call, value)
        this.finish(call)
      },
      (error: unknown) => {
        const failure = toFailure(error)
        this.onEvent?.({ type: "rpc.error", data: { method: call.method, kind: failure.kind, reason: failure.data.reason } })
        this.settle(call, failure)
        this.finish(call)
      },
    )
  }

  private settle(call: Call, value: unknown) {
    if (call.settled) return
    call.settled = true
    if (call.timer) clearTimeout(call.timer)
    if (value instanceof RpcFailure) {
      call.deferred.reject(value)
      return
    }
    if (call.cacheKey) this.cache.set(call.cacheKey, { at: this.now(), result: value })
    call.deferred.resolve(value)
  }

  private finish(call: Call) {
    if (this.current !== call) return
    this.current = undefined
    this.drain()
  }

  private drain() {
    if (this.current) return
    const next = this.queue.shift()
    if (!next) return
    if (next.timer) clearTimeout(next.timer)
    next.timer = undefined
    this.run(next)
  }
}

function idOf(message: Json): RpcId | undefined {
  const id = message.id
  if (typeof id === "string" || typeof id === "number") return id
  return undefined
}



function toFailure(error: unknown): RpcFailure {
  if (error instanceof RpcFailure) return error
  return new RpcFailure("INTERNAL_ERROR", { reason: errorMessage(error) })
}