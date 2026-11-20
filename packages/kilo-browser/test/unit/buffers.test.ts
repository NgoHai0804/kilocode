import { test, expect } from "bun:test"
import { ConsoleBuffer, NetworkBuffer } from "../../extension/src/buffers/ring"

test("console ring overwrites the oldest entry and tracks dropped", () => {
  const buffer = new ConsoleBuffer()
  for (let index = 0; index < 501; index += 1) {
    buffer.push({ level: "info", text: `entry ${index}`, timestamp: index })
  }
  const page = buffer.query({ limit: 500 })
  expect(page.entries).toHaveLength(500)
  expect(page.dropped).toBe(1)
  expect(page.oldestSeq).toBe(2)
  expect(page.entries.at(0)?.seq).toBe(2)
  expect(page.nextSeq).toBe(501)
})

test("console filters by level and sinceSeq", () => {
  const buffer = new ConsoleBuffer()
  buffer.push({ level: "info", text: "hello", timestamp: 1 })
  buffer.push({ level: "error", text: "boom", timestamp: 2 })
  buffer.push({ level: "warn", text: "careful", timestamp: 3 })
  expect(buffer.query({ level: "error" }).entries.map((entry) => entry.text)).toEqual(["boom"])
  expect(buffer.query({ sinceSeq: 1 }).entries.map((entry) => entry.text)).toEqual(["boom", "careful"])
  expect(buffer.query({ limit: 1 }).entries).toHaveLength(1)
})

test("console truncates a single entry to 8 KB", () => {
  const buffer = new ConsoleBuffer()
  const entry = buffer.push({ level: "info", text: "x".repeat(20_000), timestamp: 1 })
  expect(entry.text.length).toBeLessThan(20_000)
  expect(entry.text.length).toBeLessThanOrEqual(8 * 1024)
})

test("network ring caps entries, truncates bodies, and drops bodies under memory pressure", () => {
  const buffer = new NetworkBuffer()
  for (let index = 0; index < 201; index += 1) {
    const seq = buffer.begin({
      requestId: `r${index}`,
      method: "GET",
      url: `http://localhost:3000/api/${index}`,
      timestamp: index,
    })
    buffer.finish(seq, { status: 200, durationMs: 5, body: "y".repeat(40_000) })
  }
  const page = buffer.query({ limit: 200, includeBodies: true })
  expect(page.requests).toHaveLength(200)
  expect(page.dropped).toBe(1)
  expect(page.requests.at(-1)?.seq).toBe(201)
  const bodyRequest = page.requests.at(-1)
  expect(bodyRequest?.body?.length).toBeLessThanOrEqual(32 * 1024)
  expect(bodyRequest?.bodyTruncated).toBe(true)
  expect(page.bodyDropped).toBeGreaterThan(0)
})

test("network filters by regex and sinceSeq and omits bodies unless requested", () => {
  const buffer = new NetworkBuffer()
  const first = buffer.begin({ requestId: "a", method: "POST", url: "/api/save", timestamp: 1 })
  buffer.finish(first, { status: 500, durationMs: 42, mimeType: "application/json", body: '{"token":"secret"}' })
  const second = buffer.begin({ requestId: "b", method: "GET", url: "/health", timestamp: 2 })
  buffer.finish(second, { status: 200, durationMs: 3, body: "ok" })

  const filtered = buffer.query({ filter: /api\/save/i })
  expect(filtered.requests).toHaveLength(1)
  expect(filtered.requests[0]?.status).toBe(500)
  expect(filtered.requests[0]?.durationMs).toBe(42)
  expect(filtered.requests[0]?.body).toBeUndefined()

  const withBody = buffer.query({ filter: /api\/save/i, includeBodies: true })
  expect(withBody.requests).toHaveLength(1)
  expect(withBody.requests[0]?.body).toBe('{"token":"secret"}')
})

test("network keeps body metadata when the entry survives but the body was dropped", () => {
  const buffer = new NetworkBuffer()
  for (let index = 0; index < 200; index += 1) {
    const seq = buffer.begin({ requestId: `q${index}`, method: "GET", url: `/big/${index}`, timestamp: index })
    buffer.finish(seq, { status: 200, durationMs: 1, body: "z".repeat(32 * 1024) })
  }
  expect(buffer.bodyDropped).toBeGreaterThan(0)
  const page = buffer.query({})
  expect(page.bodyDropped).toBe(buffer.bodyDropped)
})