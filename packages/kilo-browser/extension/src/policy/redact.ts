/**
 * Browser-safe mirror of `src/policy/redact.ts`.
 *
 * The shared module imports `node:crypto` for its hash helpers, which would pull
 * a large `crypto-browserify` polyfill into the extension service-worker bundle.
 * This copy keeps the exact shared redaction behavior: same header list, same
 * query keys, the `basic` pattern, and the identical JWT threshold.
 */

export const DEFAULT_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
]

export const DEFAULT_QUERY_KEYS = ["token", "access_token", "key", "secret", "password"]

const REPLACEMENT = "[REDACTED]"

export type RedactOptions = {
  headers?: string[]
  keys?: string[]
  replacement?: string
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

export function redactText(value: string, options: RedactOptions = {}): string {
  const replacement = options.replacement ?? REPLACEMENT
  let out = value
  for (const pattern of PATTERNS) {
    out = out.replace(pattern.regex, () => {
      if (pattern.name === "bearer") return `Bearer ${replacement}`
      if (pattern.name === "basic") return `Basic ${replacement}`
      return replacement
    })
  }
  return out
}

export function redactHeaders(headers: Record<string, string>, options: RedactOptions = {}): Record<string, string> {
  const replacement = options.replacement ?? REPLACEMENT
  const names = new Set((options.headers ?? DEFAULT_HEADERS).map((name) => name.toLowerCase()))
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = names.has(name.toLowerCase()) ? replacement : redactText(value, options)
  }
  return out
}

export function redactUrl(raw: string, options: RedactOptions = {}): string {
  try {
    const url = new URL(raw)
    const keys = new Set((options.keys ?? DEFAULT_QUERY_KEYS).map((key) => key.toLowerCase()))
    for (const key of [...url.searchParams.keys()]) {
      if (keys.has(key.toLowerCase())) url.searchParams.set(key, options.replacement ?? REPLACEMENT)
    }
    return url.toString()
  } catch {
    return redactText(raw, options)
  }
}

export function redactBody(body: string, options: RedactOptions = {}): string {
  const replacement = options.replacement ?? REPLACEMENT
  const keys = new Set([...(options.keys ?? DEFAULT_QUERY_KEYS), ...(options.headers ?? DEFAULT_HEADERS)])
  try {
    const parsed = JSON.parse(body) as unknown
    return JSON.stringify(redactJson(parsed, keys, replacement))
  } catch {
    return redactText(body, options)
  }
}

function redactJson(value: unknown, keys: Set<string>, replacement: string): unknown {
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactJson(item, keys, replacement))
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = keys.has(key.toLowerCase()) ? replacement : redactJson(item, keys, replacement)
    }
    return out
  }
  return value
}
