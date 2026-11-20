export type RpcId = string | number

export type RpcKind =
  | "PARSE_ERROR"
  | "INVALID_REQUEST"
  | "METHOD_NOT_FOUND"
  | "INVALID_PARAMS"
  | "UNAUTHORIZED"
  | "APPROVAL_TIMEOUT"
  | "NOT_PAIRED"
  | "NO_TARGET"
  | "STALE_REF"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "BUSY"
  | "CANCELLED"
  | "POLICY_DENIED"
  | "DEVTOOLS_CONFLICT"
  | "NETWORK_REFUSED"
  | "LOOP_STOP"
  | "SHUTTING_DOWN"
  | "KILO_UNAVAILABLE"
  | "INTERNAL_ERROR"

type Definition = { code: number; retryable: boolean; remediation: string }

export const RPC_ERRORS: Record<RpcKind, Definition> = {
  PARSE_ERROR: { code: -32700, retryable: false, remediation: "BÃ¡o ngÆ°á»i dÃ¹ng gá»­i log." },
  INVALID_REQUEST: { code: -32600, retryable: false, remediation: "Sá»­a framing JSON-RPC." },
  METHOD_NOT_FOUND: { code: -32601, retryable: false, remediation: "DÃ¹ng tool Ä‘Æ°á»£c há»— trá»£." },
  INVALID_PARAMS: { code: -32602, retryable: false, remediation: "Sá»­a tham sá»‘." },
  UNAUTHORIZED: { code: -32001, retryable: true, remediation: "Pair láº¡i extension." },
  APPROVAL_TIMEOUT: { code: -32001, retryable: true, remediation: "YÃªu cáº§u ngÆ°á»i dÃ¹ng duyá»‡t láº¡i." },
  NOT_PAIRED: { code: -32002, retryable: true, remediation: "Má»Ÿ side panel vÃ  pair extension." },
  NO_TARGET: { code: -32003, retryable: true, remediation: "Chá»n tab há»£p lá»‡." },
  STALE_REF: { code: -32004, retryable: true, remediation: "Gá»i browser_snapshot rá»“i dÃ¹ng ref má»›i." },
  TIMEOUT: { code: -32005, retryable: true, remediation: "Kiá»ƒm tra app cÃ²n cháº¡y vÃ  tÄƒng timeout." },
  RATE_LIMIT: { code: -32005, retryable: true, remediation: "Chá» 1 giÃ¢y rá»“i thá»­ láº¡i." },
  BUSY: { code: -32005, retryable: true, remediation: "Chá» call hiá»‡n táº¡i xong." },
  CANCELLED: { code: -32005, retryable: true, remediation: "Chá»‰ thá»­ láº¡i náº¿u cÃ²n nhu cáº§u." },
  POLICY_DENIED: { code: -32006, retryable: false, remediation: "Äá»•i policy hoáº·c há»i ngÆ°á»i dÃ¹ng." },
  DEVTOOLS_CONFLICT: { code: -32006, retryable: true, remediation: "ÄÃ³ng DevTools." },
  NETWORK_REFUSED: { code: -32006, retryable: true, remediation: "Kiá»ƒm tra app/port." },
  LOOP_STOP: { code: -32006, retryable: false, remediation: "Tá»•ng káº¿t báº±ng chá»©ng." },
  SHUTTING_DOWN: { code: -32006, retryable: true, remediation: "Start láº¡i bridge." },
  KILO_UNAVAILABLE: { code: -32006, retryable: true, remediation: "Restart Kilo server." },
  INTERNAL_ERROR: { code: -32603, retryable: false, remediation: "BÃ¡o ngÆ°á»i dÃ¹ng gá»­i log." },
}

export type RpcErrorBody = {
  code: number
  message: RpcKind
  data: {
    kind: RpcKind
    retryable: boolean
    remediation: string
    [key: string]: unknown
  }
}

export class RpcFailure extends Error {
  readonly code: number
  readonly kind: RpcKind
  readonly retryable: boolean
  readonly remediation: string
  readonly data: Record<string, unknown>

  constructor(kind: RpcKind, data: Record<string, unknown> = {}) {
    const definition = RPC_ERRORS[kind]
    super(kind)
    this.name = "RpcFailure"
    this.code = definition.code
    this.kind = kind
    this.retryable = definition.retryable
    this.remediation = definition.remediation
    this.data = { kind, retryable: definition.retryable, remediation: definition.remediation, ...data }
  }

  get body(): RpcErrorBody {
    return {
      code: this.code,
      message: this.kind,
      data: {
        ...this.data,
        kind: this.kind,
        retryable: this.retryable,
        remediation: this.remediation,
      },
    }
  }
}

export function rpcError(kind: RpcKind, data: Record<string, unknown> = {}): RpcErrorBody {
  return new RpcFailure(kind, data).body
}

type Pending = {
  id: string
  method: string
  resolve: (value: unknown) => void
  reject: (error: RpcFailure) => void
  timer: ReturnType<typeof setTimeout>
}

type Queued = {
  method: string
  params: Record<string, unknown>
  timeoutMs: number
  resolve: (value: unknown) => void
  reject: (error: RpcFailure) => void
  timer: ReturnType<typeof setTimeout>
}

export type PeerOptions = {
  send: (message: Record<string, unknown>) => void
  busyWaitMs?: number
  defaultTimeoutMs?: number
}

export class RpcPeer {
  private readonly send: (message: Record<string, unknown>) => void
  private readonly busyWaitMs: number
  private readonly defaultTimeoutMs: number
  private pending?: Pending
  private queue: Queued[] = []
  private next = 0
  private closed?: RpcFailure

  constructor(options: PeerOptions) {
    this.send = options.send
    this.busyWaitMs = options.busyWaitMs ?? 5000
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15000
  }

  get busy() {
    return this.pending !== undefined
  }

  get inflight() {
    return this.pending?.method
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = this.defaultTimeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closed)
    if (this.pending) return this.enqueue(method, params, timeoutMs)
    return this.dispatch(method, params, timeoutMs)
  }

  accept(message: unknown): boolean {
    if (!isRecord(message) || message.id === undefined) return false
    const id = String(message.id)
    if (!this.pending || this.pending.id !== id) return false
    const current = this.pending
    clearTimeout(current.timer)
    this.pending = undefined
    if (isRecord(message.error)) {
      const data = isRecord(message.error.data) ? message.error.data : {}
      const kind = typeof data.kind === "string" && data.kind in RPC_ERRORS ? (data.kind as RpcKind) : "INTERNAL_ERROR"
      current.reject(new RpcFailure(kind, data))
    } else {
      current.resolve(message.result)
    }
    this.drain()
    return true
  }

  cancel(id: RpcId) {
    if (!this.pending || this.pending.id !== String(id)) return
    const current = this.pending
    clearTimeout(current.timer)
    this.pending = undefined
    current.reject(new RpcFailure("CANCELLED", { requestId: current.id }))
    this.drain()
  }

  close(error = new RpcFailure("SHUTTING_DOWN")) {
    if (this.closed) return
    this.closed = error
    if (this.pending) {
      const current = this.pending
      clearTimeout(current.timer)
      this.pending = undefined
      current.reject(error)
    }
    for (const item of this.queue) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    this.queue = []
  }

  private enqueue(method: string, params: Record<string, unknown>, timeoutMs: number) {
    const deferred = Promise.withResolvers<unknown>()
    const timer = setTimeout(() => {
      const index = this.queue.findIndex((item) => item.timer === timer)
      if (index >= 0) this.queue.splice(index, 1)
      deferred.reject(new RpcFailure("BUSY", { method }))
    }, this.busyWaitMs)
    this.queue.push({ method, params, timeoutMs, resolve: deferred.resolve, reject: deferred.reject, timer })
    return deferred.promise
  }

  private drain() {
    if (this.pending || this.closed) return
    const item = this.queue.shift()
    if (!item) return
    clearTimeout(item.timer)
    const deferred = Promise.withResolvers<unknown>()
    deferred.promise.then(item.resolve, item.reject)
    this.sendCall(item.method, item.params, item.timeoutMs, deferred.resolve, deferred.reject)
  }

  private dispatch(method: string, params: Record<string, unknown>, timeoutMs: number) {
    const deferred = Promise.withResolvers<unknown>()
    this.sendCall(method, params, timeoutMs, deferred.resolve, deferred.reject)
    return deferred.promise
  }

  private sendCall(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    resolve: (value: unknown) => void,
    reject: (error: RpcFailure) => void,
  ) {
    const id = `req_${++this.next}`
    const timer = setTimeout(() => {
      if (!this.pending || this.pending.id !== id) return
      this.pending = undefined
      try {
        this.send({ jsonrpc: "2.0", method: "browser.cancel", params: { requestId: id } })
      } catch (err) {
        this.closed = this.closed ?? new RpcFailure("SHUTTING_DOWN", {
          reason: err instanceof Error ? err.message : "cancel send failed",
        })
      }
      reject(new RpcFailure("TIMEOUT", { method, timeoutMs }))
      this.drain()
    }, timeoutMs)
    this.pending = { id, method, resolve, reject, timer }
    try {
      this.send({ jsonrpc: "2.0", id, method, params })
    } catch (err) {
      if (this.pending?.id === id) {
        clearTimeout(timer)
        this.pending = undefined
      }
      reject(new RpcFailure("SHUTTING_DOWN", { method, reason: err instanceof Error ? err.message : "send failed" }))
      this.drain()
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
