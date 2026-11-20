import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { createLogger, LOG_EVENTS } from "../../src/log/jsonl"

async function readAll(dir: string) {
  const files = await readdir(dir)
  const text: string[] = []
  for (const file of files) text.push(await readFile(path.join(dir, file), "utf8"))
  return text.join("")
}

test("writes spec-shaped JSONL lines and includes the documented events", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-log-"))
  try {
    const file = path.join(base, "logs", "bridge.jsonl")
    const log = createLogger({ file, now: () => new Date("2026-01-01T00:00:00Z") })
    await log.log({ event: "bridge.start", level: "info", sessionID: "ses_1", requestId: "req_1", durationMs: 3, data: { pid: 1 } })
    await log.close()
    const line = JSON.parse((await readFile(file, "utf8")).trim()) as Record<string, unknown>
    expect(line.ts).toBe("2026-01-01T00:00:00.000Z")
    expect(line.level).toBe("info")
    expect(line.event).toBe("bridge.start")
    expect(line.sessionID).toBe("ses_1")
    expect(line.requestId).toBe("req_1")
    expect(line.durationMs).toBe(3)
    expect(line.data).toEqual({ pid: 1 })
    for (const event of ["bridge.start", "policy.deny", "jail.deny", "redact.hit", "tool.start", "tool.end"]) {
      expect(LOG_EVENTS as readonly string[]).toContain(event)
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("log data is redacted before writing and emits redact.hit", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-log-"))
  try {
    const file = path.join(base, "logs", "bridge.jsonl")
    const log = createLogger({ file, level: "debug" })
    await log.log({
      event: "rpc.response",
      data: {
        authorization: "Bearer abcdefghij",
        cookie: "sid=abcdef",
        "x-api-key": "sk-abcdefghijklmnopqrstuvwx",
        note: "token=abc123",
      },
    })
    await log.close()
    const text = await readAll(path.join(base, "logs"))
    expect(text).not.toContain("abcdefghij")
    expect(text).not.toContain("sid=abcdef")
    expect(text).not.toContain("sk-abcdefghij")
    expect(text).toContain("[REDACTED]")
    expect(text).toContain('"event":"redact.hit"')
    expect(text).toContain('"location"')
    expect(text).toContain('"pattern"')
    expect(text).toContain('"count"')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("rotates at the size cap and keeps at most three files", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-log-"))
  try {
    const dir = path.join(base, "logs")
    const file = path.join(dir, "bridge.jsonl")
    const log = createLogger({ file, maxBytes: 200, keep: 3, level: "debug" })
    for (let index = 0; index < 20; index += 1) {
      await log.log({ event: "tool.start", data: { index, authorization: "Bearer abcdefghij", pad: "x".repeat(30) } })
    }
    await log.close()
    const files = await readdir(dir)
    expect(files).toContain("bridge.jsonl")
    expect(files).toContain("bridge.jsonl.1")
    expect(files).toContain("bridge.jsonl.2")
    expect(files).not.toContain("bridge.jsonl.3")
    const text = await readAll(dir)
    expect(text).not.toContain("abcdefghij")
    for (const line of text.split("\n").filter((item) => item.length > 0)) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("level filtering keeps debug out of info logs", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-log-"))
  try {
    const file = path.join(base, "logs", "bridge.jsonl")
    const log = createLogger({ file, level: "info" })
    await log.log({ event: "metrics.snapshot", level: "debug", data: { value: 1 } })
    await log.log({ event: "bridge.start", level: "info", data: { value: 2 } })
    await log.close()
    const text = await readFile(file, "utf8")
    expect(text).not.toContain("metrics.snapshot")
    expect(text).toContain("bridge.start")
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})