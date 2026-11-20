import path from "node:path"
import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises"
import { DEFAULT_REDACTION, redactWithHits, type RedactionOptions } from "../policy/redact"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogEvent = {
  event: string
  level?: LogLevel
  sessionID?: string
  requestId?: string
  durationMs?: number
  data?: unknown
}

export type LoggerOptions = {
  file: string
  maxBytes?: number
  keep?: number
  level?: LogLevel
  redaction?: RedactionOptions
  now?: () => Date
}

export type JsonlLogger = {
  path: string
  log(event: LogEvent): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

export const LOG_EVENTS = [
  "bridge.start",
  "preflight.ok",
  "preflight.fail",
  "kilo.spawn",
  "kilo.ready",
  "kilo.exit",
  "ws.open",
  "ws.close",
  "ui.port.open",
  "ui.port.close",
  "ui.rpc.request",
  "ui.rpc.response",
  "ui.rpc.error",
  "ui.capability.hide",
  "ui.render.error",
  "ui.asset.missing",
  "pair.start",
  "pair.ok",
  "pair.fail",
  "pair.lockout",
  "rpc.request",
  "rpc.response",
  "rpc.error",
  "tool.start",
  "tool.end",
  "policy.deny",
  "jail.deny",
  "redact.hit",
  "loop.stop",
  "sse.gap",
  "sse.reconnect",
  "shutdown.start",
  "shutdown.done",
  "metrics.snapshot",
] as const

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SIZE_RESYNC_EVERY = 64

export function createLogger(options: LoggerOptions): JsonlLogger {
  const file = path.resolve(options.file)
  const maxBytes = options.maxBytes ?? 10_485_760
  const keep = Math.max(1, options.keep ?? 3)
  const level = options.level ?? "info"
  const redaction = options.redaction ?? DEFAULT_REDACTION
  const now = options.now ?? (() => new Date())
  let queue = Promise.resolve()
  let size: number | undefined
  let writes = 0
  let ready: Promise<void> | undefined

  const prepare = () => {
    ready ??= ensureDir(file).then(async () => {
      size = await fileSize(file)
    })
    return ready
  }

  async function append(line: string) {
    await prepare()
    writes += 1
    if (writes % SIZE_RESYNC_EVERY === 0) size = await fileSize(file)
    const bytes = Buffer.byteLength(line)
    if ((size ?? 0) + bytes > maxBytes) {
      await rotate(file, keep)
      size = 0
    }
    await appendFile(file, line, { encoding: "utf8", mode: 0o600 })
    size = (size ?? 0) + bytes
  }

  const write = (event: LogEvent) => {
    const next = queue.then(() => writeEvent(event))
    queue = next.then(
      () => undefined,
      (err: unknown) => {
        process.stderr.write(`kilo-browser log: ${err instanceof Error ? err.message : "write failed"}\n`)
      },
    )
    return next
  }

  async function writeEvent(event: LogEvent) {
    if (LEVELS[event.level ?? "info"] < LEVELS[level]) return
    const result = redactWithHits(event.data ?? {}, redaction)
    const entry = {
      ts: now().toISOString(),
      level: event.level ?? "info",
      event: event.event,
      ...(event.sessionID ? { sessionID: event.sessionID } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      data: result.value,
    }
    await append(`${JSON.stringify(entry)}\n`)
    for (const hit of result.hits) {
      const line = {
        ts: now().toISOString(),
        level: "info",
        event: "redact.hit",
        ...(event.sessionID ? { sessionID: event.sessionID } : {}),
        ...(event.requestId ? { requestId: event.requestId } : {}),
        data: hit,
      }
      await append(`${JSON.stringify(line)}\n`)
    }
  }

  return {
    path: file,
    log: write,
    flush() {
      return queue
    },
    async close() {
      await queue
    },
  }
}

export function logLine(event: LogEvent, options: LoggerOptions): string {
  const result = redactWithHits(event.data ?? {}, options.redaction ?? DEFAULT_REDACTION)
  return `${JSON.stringify({ ts: (options.now ?? (() => new Date()))().toISOString(), level: event.level ?? "info", event: event.event, data: result.value })}\n`
}

function ensureDir(file: string) {
  return mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
}

async function rotate(file: string, keep: number) {
  if (keep <= 1) {
    await remove(file)
    return
  }
  await remove(`${file}.${keep - 1}`)
  for (let index = keep - 1; index > 1; index -= 1) {
    await move(`${file}.${index - 1}`, `${file}.${index}`)
  }
  await move(file, `${file}.1`)
}

async function fileSize(file: string) {
  try {
    return (await stat(file)).size
  } catch (err) {
    if (codeOf(err) === "ENOENT") return 0
    throw err
  }
}

async function move(from: string, to: string) {
  try {
    await rename(from, to)
  } catch (err) {
    if (codeOf(err) === "ENOENT") return
    throw err
  }
}

async function remove(file: string) {
  try {
    await unlink(file)
  } catch (err) {
    if (codeOf(err) === "ENOENT") return
    throw err
  }
}

function codeOf(err: unknown) {
  if (!(err instanceof Error)) return undefined
  return (err as NodeJS.ErrnoException).code
}