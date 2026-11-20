/**
 * Resolve a UI `kilo.pair` message into the bridge URL plus the material the
 * tool transport needs to authenticate.
 *
 * The UI page owns the bridge token: it claims it through `POST /pair/claim`
 * and stores it in `localStorage`. Only the service worker can open the tool
 * WebSocket, so the UI forwards the pairing here, either as the six-digit code
 * (fresh pairing) or as the already-claimed token (restored UI session).
 */

export type PairRequest =
  | { ok: true; url: string; code: string }
  | { ok: true; url: string; token: string }
  | { ok: false; error: "url" | "code" }

export type PairMessage = {
  url?: unknown
  port?: unknown
  code?: unknown
  token?: unknown
}

export function pairRequest(input: PairMessage): PairRequest {
  const url = bridgeUrl(input)
  if (!url) return { ok: false, error: "url" }
  const token = nonEmpty(input.token)
  if (token) return { ok: true, url, token }
  const code = nonEmpty(input.code)
  if (code) return { ok: true, url, code }
  return { ok: false, error: "code" }
}

function bridgeUrl(input: PairMessage) {
  const url = nonEmpty(input.url)
  if (url) return url
  const port = input.port
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined
  return `ws://127.0.0.1:${port}/ws`
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
