import type { Json } from "../util/value"
import type { NetworkRecord } from "../buffers/ring"
import type { ToolContext } from "./context"
import { byteLength } from "../buffers/ring"
import { bool } from "../util/value"
import { redactBody, redactHeaders, redactText, redactUrl } from "../policy/redact"
import { invalid, throwIfAborted } from "../rpc/failure"
import { integer, optionalInteger, optionalString } from "./params"

const MAX_BYTES = 256 * 1024

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  throwIfAborted(signal)
  const filterText = optionalString(params.filter, "filter")
  const filter = filterText === undefined || filterText.length === 0 ? undefined : compile(filterText)
  const sinceSeq = optionalInteger(params.sinceSeq, "sinceSeq", 0, Number.MAX_SAFE_INTEGER) ?? 0
  const includeBodies = bool(params.includeBodies) === true
  const limit = integer(params.limit, "limit", 100, 1, 200)
  const page = ctx.network.query({ filter, sinceSeq, includeBodies, limit })
  const requests: Json[] = []
  let bytes = 0
  let truncated = false
  for (const request of page.requests) {
    const item = present(request, includeBodies)
    const size = byteLength(JSON.stringify(item))
    if (requests.length > 0 && bytes + size > MAX_BYTES) {
      truncated = true
      break
    }
    bytes += size
    requests.push(item)
  }
  return {
    requests,
    dropped: page.dropped,
    bodyDropped: page.bodyDropped,
    oldestSeq: page.oldestSeq ?? 0,
    nextSeq: page.nextSeq,
    truncated,
  }
}

function present(request: NetworkRecord, includeBodies: boolean): Json {
  const out: Json = {
    seq: request.seq,
    method: request.method,
    url: redactUrl(request.url),
    status: request.status,
    statusText: request.statusText,
    mimeType: request.mimeType,
    resourceType: request.resourceType,
    durationMs: request.durationMs,
    timestamp: request.timestamp,
  }
  if (request.error) out.error = redactText(request.error)
  if (request.headers) out.headers = redactHeaders(request.headers)
  if (includeBodies && request.body !== undefined) {
    out.body = redactBody(request.body)
    out.bodyTruncated = request.bodyTruncated === true
  }
  return out
}

function compile(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i")
  } catch {
    throw invalid("filter", "invalid regular expression")
  }
}