import { createHash } from "node:crypto"

export type RedactionOptions = {
  enabled: boolean
  replacement: string
  headers: string[]
  queryKeys: string[]
  maxDepth?: number
  maxNodes?: number
}

export const DEFAULT_REDACTION: RedactionOptions = {
  enabled: true,
  replacement: "[REDACTED]",
  headers: [
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
    "x-auth-token",
  ],
  queryKeys: ["token", "access_token", "key", "secret", "password"],
  maxDepth: 12,
  maxNodes: 100_000,
}

export type RedactionHit = {
  location: string
  pattern: string
  count: number
}

export type RedactionResult = {
  value: unknown
  hits: RedactionHit[]
}

type Ctx = {
  options: RedactionOptions
  headers: Set<string>
  query: Set<string>
  hits: Map<string, RedactionHit>
  order: RedactionHit[]
  nodes: number
}

type Pattern = { name: string; regex: RegExp }

const PATTERNS: Pattern[] = [
  { name: "bearer", regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { name: "basic", regex: /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "openai", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "github", regex: /\b(?:ghp|gho)_[A-Za-z0-9]{20,}\b/g },
  { name: "aws", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
]

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi
const HEADER_LINE = /\b(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token)\s*:\s*([^\r\n]+)/gi

export function redactText(text: string, options: RedactionOptions = DEFAULT_REDACTION): string {
  return applyString(text, createCtx(options), "text", false)
}

export function redactHeaders(
  headers: Record<string, string>,
  options: RedactionOptions = DEFAULT_REDACTION,
): Record<string, string> {
  if (!options.enabled) return { ...headers }
  const ctx = createCtx(options)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const field = applyField(key, value, ctx, "headers", 0)
    out[key] = typeof field === "string" ? field : value
  }
  return out
}

export function redactUrl(raw: string, options: RedactionOptions = DEFAULT_REDACTION): string {
  return applyUrl(raw, createCtx(options), "url")
}

export function redactValue(value: unknown, options: RedactionOptions = DEFAULT_REDACTION, depth = 0): unknown {
  return apply(value, createCtx(options), "", depth, false)
}

export function redactWithHits(value: unknown, options: RedactionOptions = DEFAULT_REDACTION): RedactionResult {
  const ctx = createCtx(options)
  const safe = apply(value, ctx, "", 0, false)
  return { value: safe, hits: ctx.order }
}

export function redactData(
  data: string | Uint8Array | ArrayBuffer,
  ext: string,
  options: RedactionOptions = DEFAULT_REDACTION,
): string | Uint8Array | ArrayBuffer {
  if (typeof data !== "string") return data
  void ext
  if (looksJson(data)) {
    try {
      const parsed = JSON.parse(data) as unknown
      return JSON.stringify(redactValue(parsed, options))
    } catch {
      return redactText(data, options)
    }
  }
  return redactText(data, options)
}

export function paramsHash(params: unknown, options: RedactionOptions = DEFAULT_REDACTION) {
  const safe = redactValue(params, options)
  return createHash("sha256").update(JSON.stringify(safe ?? null)).digest("hex").slice(0, 8)
}

export function tokenTag(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 8)
}

function createCtx(options: RedactionOptions): Ctx {
  return {
    options,
    headers: new Set(options.headers.map((name) => name.toLowerCase())),
    query: new Set(options.queryKeys.map((name) => name.toLowerCase())),
    hits: new Map(),
    order: [],
    nodes: 0,
  }
}

function apply(value: unknown, ctx: Ctx, location: string, depth: number, cookie: boolean): unknown {
  if (!ctx.options.enabled) return value
  if (depth > (ctx.options.maxDepth ?? 12)) return value
  ctx.nodes += 1
  if (ctx.nodes > (ctx.options.maxNodes ?? 100_000)) return value

  if (typeof value === "string") return applyString(value, ctx, location || "value", cookie)
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      out.push(apply(value[index], ctx, `${location}[${index}]`, depth + 1, cookie))
    }
    return out
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const next = location ? `${location}.${key}` : key
      out[key] = applyField(key, item, ctx, next, depth + 1, cookie)
    }
    return out
  }
  return value
}

function applyField(key: string, item: unknown, ctx: Ctx, location: string, depth: number, cookie = false): unknown {
  if (!ctx.options.enabled) return item
  const lower = key.toLowerCase()
  const header = ctx.headers.has(lower)
  const query = ctx.query.has(lower)
  const cookieKey = lower === "cookie" || lower === "set-cookie"
  const cookieBag = lower === "cookies"

  if (cookie && (lower === "value" || lower === "content")) {
    addHit(ctx, location, "cookie:value")
    return ctx.options.replacement
  }

  if (header || query) {
    if (cookieKey) {
      addHit(ctx, location, `header:${lower}`)
      if (Array.isArray(item)) return item.map(() => ctx.options.replacement)
      return ctx.options.replacement
    }
    addHit(ctx, location, `field:${lower}`)
    return ctx.options.replacement
  }

  return apply(item, ctx, location, depth, cookieBag)
}

function applyString(value: string, ctx: Ctx, location: string, cookie: boolean): string {
  if (!ctx.options.enabled) return value
  if (cookie) {
    addHit(ctx, location, "cookie:value")
    return ctx.options.replacement
  }
  let out = value.replace(HEADER_LINE, (match, name: string) => {
    addHit(ctx, location, `header:${name.toLowerCase()}`)
    return `${name}: ${ctx.options.replacement}`
  })
  for (const pattern of PATTERNS) {
    out = replacePattern(out, pattern, ctx, location)
  }
  out = out.replace(URL_PATTERN, (match) => applyUrl(match, ctx, location))
  return out
}

function replacePattern(value: string, pattern: Pattern, ctx: Ctx, location: string) {
  return value.replace(pattern.regex, (match) => {
    addHit(ctx, location, pattern.name)
    if (pattern.name === "bearer") return `Bearer ${ctx.options.replacement}`
    if (pattern.name === "basic") return `Basic ${ctx.options.replacement}`
    return ctx.options.replacement
  })
}

function applyUrl(raw: string, ctx: Ctx, location: string): string {
  if (!ctx.options.enabled) return raw
  const marker = raw.indexOf("#")
  const hash = marker < 0 ? "" : raw.slice(marker)
  const body = marker < 0 ? raw : raw.slice(0, marker)
  const split = body.indexOf("?")
  if (split < 0) return raw
  const base = body.slice(0, split)
  const query = body.slice(split + 1)
  if (query.length === 0) return raw
  const parts = query.split("&").map((pair) => {
    const equals = pair.indexOf("=")
    if (equals < 0) return pair
    const key = decodeSafe(pair.slice(0, equals))
    if (!ctx.query.has(key.toLowerCase())) return pair
    addHit(ctx, location, `query:${key.toLowerCase()}`)
    return `${pair.slice(0, equals)}=${ctx.options.replacement}`
  })
  return `${base}?${parts.join("&")}${hash}`
}

function addHit(ctx: Ctx, location: string, pattern: string, count = 1) {
  const key = `${location}\u0000${pattern}`
  const existing = ctx.hits.get(key)
  if (existing) {
    existing.count += count
    return
  }
  const hit = { location: location || "value", pattern, count }
  ctx.hits.set(key, hit)
  ctx.order.push(hit)
}

function decodeSafe(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "))
  } catch {
    return value
  }
}

function looksJson(value: string) {
  const trimmed = value.trimStart()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}