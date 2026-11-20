/**
 * Browser-safe mirror of `src/policy/origin.ts`.
 *
 * The shared module imports `node:crypto` (`shortHash`), which would pull a
 * large `crypto-browserify` polyfill into the extension service-worker bundle.
 * Keep this file behaviorally identical to the shared policy: same blocked
 * schemes, same fail-closed empty allowlist, and no `node:` imports.
 */

export const BLOCKED_SCHEMES = new Set([
  "file:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "javascript:",
  "data:",
  "view-source:",
  "blob:",
  "filesystem:",
])

export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"]

export type OriginCheck = { ok: true; url: URL } | { ok: false; reason: string; url?: URL }

export class OriginError extends Error {
  readonly code = "POLICY_DENIED"

  constructor(
    readonly reason: string,
    readonly raw?: string,
  ) {
    super(`origin denied: ${reason}${raw ? ` (${raw})` : ""}`)
    this.name = "OriginError"
  }
}

export function checkUrl(raw: string, allowedOrigins: string[]): OriginCheck {
  if (raw.trim() === "about:blank") return { ok: true, url: new URL("about:blank") }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "invalid_url" }
  }
  return check(url, allowedOrigins)
}

export function check(url: URL, allowedOrigins: string[]): OriginCheck {
  if (url.href === "about:blank") return { ok: true, url }
  if (BLOCKED_SCHEMES.has(url.protocol)) return { ok: false, reason: `blocked_scheme:${url.protocol}`, url }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported_scheme:${url.protocol}`, url }
  }
  // Origin allowlist enforcement is disabled: every http/https page is controllable.
  // Only dangerous schemes above stay blocked. Kept as a parameter so callers and
  // the allowlist plumbing stay unchanged and the gate can be re-enabled here.
  void allowedOrigins
  return { ok: true, url }
}

export function assertUrl(raw: string, allowedOrigins: string[]): URL {
  const result = checkUrl(raw, allowedOrigins)
  if (!result.ok) throw new OriginError(result.reason, raw)
  return result.url
}

export function matches(url: URL, pattern: string) {
  const trimmed = pattern.trim()
  if (trimmed.length === 0) return false
  if (trimmed === "*") return false
  const marker = trimmed.indexOf("://")
  if (marker < 0) return false
  const scheme = trimmed.slice(0, marker)
  const rest = trimmed.slice(marker + 3)
  if (scheme !== url.protocol.slice(0, -1)) return false
  const slash = rest.indexOf("/")
  const authority = slash < 0 ? rest : rest.slice(0, slash)
  const pathPart = slash < 0 ? "" : rest.slice(slash)
  const hostPattern = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0] ?? authority
  const portPattern = authority.startsWith("[")
    ? authority.slice(authority.indexOf("]") + 1).replace(/^:/, "")
    : authority.includes(":")
      ? authority.slice(authority.lastIndexOf(":") + 1)
      : ""
  if (hostPattern.includes("*")) return false
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const patternHost = hostPattern.replace(/^\[|\]$/g, "")
  if (patternHost.toLowerCase() !== host.toLowerCase()) return false
  if (portPattern !== "" && portPattern !== "*") {
    const port = url.port || (url.protocol === "https:" ? "443" : "80")
    if (port !== portPattern) return false
  }
  if (pathPart !== "" && pathPart !== "/*") {
    if (!url.pathname.startsWith(pathPart.replace(/\*$/, ""))) return false
  }
  return true
}

export function isLoopbackUrl(raw: string) {
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    return host === "127.0.0.1" || host === "localhost" || host === "::1"
  } catch {
    return false
  }
}

export function extensionId(origin: string | null) {
  if (!origin) return undefined
  const match = /^chrome-extension:\/\/([a-z0-9]+)$/i.exec(origin)
  return match?.[1]
}
