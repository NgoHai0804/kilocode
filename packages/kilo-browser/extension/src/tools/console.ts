import type { Json } from "../util/value"
import type { ConsoleEntry, ConsoleLevel } from "../buffers/ring"
import type { ToolContext } from "./context"
import { byteLength } from "../buffers/ring"
import { redactText, redactUrl } from "../policy/redact"
import { throwIfAborted } from "../rpc/failure"
import { optionalEnum, optionalInteger, integer } from "./params"

const LEVELS: readonly ConsoleLevel[] = ["debug", "info", "warn", "error"]
const MAX_BYTES = 128 * 1024

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  throwIfAborted(signal)
  const level = optionalEnum(params.level, "level", LEVELS)
  const sinceSeq = optionalInteger(params.sinceSeq, "sinceSeq", 0, Number.MAX_SAFE_INTEGER) ?? 0
  const limit = integer(params.limit, "limit", 200, 1, 500)
  const page = ctx.console.query({ level, sinceSeq, limit })
  const entries: Json[] = []
  let bytes = 0
  let truncated = false
  for (const entry of page.entries) {
    const item = present(entry)
    const size = byteLength(JSON.stringify(item))
    if (entries.length > 0 && bytes + size > MAX_BYTES) {
      truncated = true
      break
    }
    bytes += size
    entries.push(item)
  }
  return {
    entries,
    dropped: page.dropped,
    oldestSeq: page.oldestSeq ?? 0,
    nextSeq: page.nextSeq,
    truncated,
  }
}

function present(entry: ConsoleEntry): Json {
  return {
    seq: entry.seq,
    level: entry.level,
    text: redactText(entry.text),
    url: entry.url ? redactUrl(entry.url) : undefined,
    line: entry.line,
    timestamp: entry.timestamp,
  }
}