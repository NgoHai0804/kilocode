const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

export type Truncated = { text: string; truncated: boolean }

export function truncateText(value: string, maxBytes: number): Truncated {
  if (maxBytes <= 0) return { text: "", truncated: value.length > 0 }
  const bytes = encoder.encode(value)
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false }
  const slice = bytes.slice(0, maxBytes)
  return { text: decoder.decode(slice).replace(/\uFFFD+$/, ""), truncated: true }
}

export type Entry<T> = { seq: number; at: number; value: T; bytes: number }

export class RingBuffer<T> {
  readonly capacity: number
  readonly maxBytes: number
  private readonly measure: (value: T) => number
  private items: Entry<T>[] = []
  private next = 0
  private droppedCount = 0
  private total = 0

  constructor(capacity: number, maxBytes: number, measure: (value: T) => number) {
    this.capacity = capacity
    this.maxBytes = maxBytes
    this.measure = measure
  }

  push(make: (seq: number) => T): Entry<T> {
    const seq = ++this.next
    const value = make(seq)
    const entry: Entry<T> = { seq, at: Date.now(), value, bytes: this.measure(value) }
    this.items.push(entry)
    this.total += entry.bytes
    while (this.items.length > this.capacity) {
      const old = this.items.shift()
      if (!old) break
      this.total -= old.bytes
      this.droppedCount += 1
    }
    while (this.total > this.maxBytes && this.items.length > 1) {
      const old = this.items.shift()
      if (!old) break
      this.total -= old.bytes
      this.droppedCount += 1
    }
    return entry
  }

  get size() {
    return this.items.length
  }

  get dropped() {
    return this.droppedCount
  }

  get oldestSeq() {
    return this.items.at(0)?.seq
  }

  get nextSeq() {
    return this.next
  }

  all(): Entry<T>[] {
    return [...this.items]
  }

  since(seq: number, limit = this.capacity): Entry<T>[] {
    const out: Entry<T>[] = []
    for (const item of this.items) {
      if (item.seq <= seq) continue
      out.push(item)
      if (out.length >= limit) break
    }
    return out
  }

  clear() {
    this.items = []
    this.total = 0
  }
}

export type ConsoleLevel = "debug" | "info" | "warn" | "error"

export type ConsoleEntry = {
  seq: number
  level: ConsoleLevel
  text: string
  url?: string
  line?: number
  timestamp: number
}

export type ConsoleInput = Omit<ConsoleEntry, "seq">

export type ConsoleQuery = {
  level?: ConsoleLevel
  sinceSeq?: number
  limit?: number
}

export type ConsolePage = {
  entries: ConsoleEntry[]
  dropped: number
  oldestSeq?: number
  nextSeq: number
}

const ENTRY_TEXT_BYTES = 8 * 1024

export class ConsoleBuffer {
  private readonly ring = new RingBuffer<ConsoleEntry>(500, 4 * 1024 * 1024, (entry) => byteLength(entry.text) + 128)

  push(input: ConsoleInput): ConsoleEntry {
    const text = truncateText(input.text, ENTRY_TEXT_BYTES)
    return this.ring.push((seq) => ({
      seq,
      level: input.level,
      text: text.text,
      url: input.url,
      line: input.line,
      timestamp: input.timestamp,
    })).value
  }

  query(input: ConsoleQuery = {}): ConsolePage {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500))
    const since = input.sinceSeq ?? 0
    const entries = this.ring
      .since(since, 500)
      .map((item) => item.value)
      .filter((entry) => input.level === undefined || entry.level === input.level)
      .slice(0, limit)
    return {
      entries,
      dropped: this.ring.dropped,
      oldestSeq: this.ring.oldestSeq,
      nextSeq: this.ring.nextSeq,
    }
  }

  clear() {
    this.ring.clear()
  }
}

export type NetworkRecord = {
  seq: number
  requestId: string
  method: string
  url: string
  status: number
  statusText?: string
  mimeType?: string
  resourceType?: string
  durationMs: number
  headers?: Record<string, string>
  body?: string
  bodyTruncated?: boolean
  error?: string
  timestamp: number
}

export type NetworkBegin = {
  requestId: string
  method: string
  url: string
  resourceType?: string
  timestamp: number
}

export type NetworkFinish = {
  status: number
  statusText?: string
  mimeType?: string
  durationMs: number
  headers?: Record<string, string>
  body?: string
  bodyTruncated?: boolean
}

export type NetworkQuery = {
  filter?: RegExp
  sinceSeq?: number
  includeBodies?: boolean
  limit?: number
}

export type NetworkPage = {
  requests: NetworkRecord[]
  dropped: number
  bodyDropped: number
  oldestSeq?: number
  nextSeq: number
}

const BODY_BYTES = 32 * 1024
const TOTAL_BODY_BYTES = 6 * 1024 * 1024

export class NetworkBuffer {
  private items: NetworkRecord[] = []
  private next = 0
  private droppedCount = 0
  private bodyDroppedCount = 0
  private bodyBytes = 0

  begin(input: NetworkBegin): number {
    const seq = ++this.next
    const record: NetworkRecord = {
      seq,
      requestId: input.requestId,
      method: input.method,
      url: input.url,
      status: 0,
      resourceType: input.resourceType,
      durationMs: 0,
      timestamp: input.timestamp,
    }
    this.items.push(record)
    while (this.items.length > 200) {
      const old = this.items.shift()
      if (!old) break
      this.bodyBytes -= byteLength(old.body ?? "")
      this.droppedCount += 1
    }
    return seq
  }

  bySeq(seq: number): NetworkRecord | undefined {
    return this.items.find((item) => item.seq === seq)
  }

  finish(seq: number, input: NetworkFinish) {
    const record = this.bySeq(seq)
    if (!record) return
    this.bodyBytes -= byteLength(record.body ?? "")
    record.status = input.status
    record.statusText = input.statusText
    record.mimeType = input.mimeType
    record.durationMs = Math.max(0, Math.round(input.durationMs))
    record.headers = input.headers
    if (input.body !== undefined) {
      const body = truncateText(input.body, BODY_BYTES)
      record.body = body.text
      record.bodyTruncated = input.bodyTruncated === true || body.truncated
    }
    this.bodyBytes += byteLength(record.body ?? "")
    this.trimBodies()
  }

  fail(seq: number, error: string, durationMs: number) {
    const record = this.bySeq(seq)
    if (!record) return
    record.status = 0
    record.error = error
    record.durationMs = Math.max(0, Math.round(durationMs))
  }

  query(input: NetworkQuery = {}): NetworkPage {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 200))
    const since = input.sinceSeq ?? 0
    const requests: NetworkRecord[] = []
    for (const item of this.items) {
      if (item.seq <= since) continue
      if (input.filter && !input.filter.test(item.url)) continue
      requests.push(input.includeBodies ? { ...item } : stripBody(item))
      if (requests.length >= limit) break
    }
    return {
      requests,
      dropped: this.droppedCount,
      bodyDropped: this.bodyDroppedCount,
      oldestSeq: this.items.at(0)?.seq,
      nextSeq: this.next,
    }
  }

  get size() {
    return this.items.length
  }

  get dropped() {
    return this.droppedCount
  }

  get bodyDropped() {
    return this.bodyDroppedCount
  }

  clear() {
    this.items = []
    this.bodyBytes = 0
  }

  private trimBodies() {
    if (this.bodyBytes <= TOTAL_BODY_BYTES) return
    for (const record of this.items) {
      if (this.bodyBytes <= TOTAL_BODY_BYTES) return
      if (record.body === undefined) continue
      this.bodyBytes -= byteLength(record.body)
      record.body = undefined
      record.bodyTruncated = true
      this.bodyDroppedCount += 1
    }
  }
}

function stripBody(record: NetworkRecord): NetworkRecord {
  return {
    seq: record.seq,
    requestId: record.requestId,
    method: record.method,
    url: record.url,
    status: record.status,
    statusText: record.statusText,
    mimeType: record.mimeType,
    resourceType: record.resourceType,
    durationMs: record.durationMs,
    headers: record.headers,
    bodyTruncated: record.bodyTruncated,
    error: record.error,
    timestamp: record.timestamp,
  }
}

export type CdpEvent = {
  seq: number
  method: string
  bytes: number
  timestamp: number
}

const EVENT_BYTES_CAP = 2048

export class EventBuffer {
  private readonly ring = new RingBuffer<CdpEvent>(1000, 2 * 1024 * 1024, (event) => event.bytes)

  push(method: string, payload: unknown): CdpEvent {
    const bytes = estimateBytes(payload, EVENT_BYTES_CAP)
    return this.ring.push((seq) => ({ seq, method, bytes: Math.min(bytes, EVENT_BYTES_CAP), timestamp: Date.now() })).value
  }

  get dropped() {
    return this.ring.dropped
  }

  all() {
    return this.ring.all().map((item) => item.value)
  }
}

/**
 * Cheap size estimate for a CDP event payload.
 *
 * CDP events stream at high volume, so a full `JSON.stringify` per event is
 * wasteful. Count string lengths and known primitives and stop once the cap is
 * reached; that is all the ring needs for its byte accounting.
 */
function estimateBytes(value: unknown, cap: number): number {
  if (typeof value === "string") return Math.min(value.length, cap)
  if (value == null) return 0
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return 8
  if (Array.isArray(value)) {
    let total = 2
    for (const item of value) {
      total += estimateBytes(item, cap) + 1
      if (total >= cap) return cap
    }
    return total
  }
  if (typeof value === "object") {
    let total = 2
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      total += key.length + 2 + estimateBytes(item, cap) + 1
      if (total >= cap) return cap
    }
    return total
  }
  return 0
}