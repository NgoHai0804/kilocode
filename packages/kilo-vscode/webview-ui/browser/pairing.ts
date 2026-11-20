export const BROWSER_PORT_KEY = "kilo.browser.bridge.port"
export const BROWSER_TOKEN_KEY = "kilo.browser.bridge.token"
export const PAIR_CODE_LENGTH = 6
export const BRIDGE_STATE_EVENT = "kilo:bridge-state"
export const BRIDGE_PAIR_REQUIRED_EVENT = "kilo:bridge-pair-required"
export const BRIDGE_ERROR_EVENT = "kilo:bridge-error"

export type ConnectionStatus = "disconnected" | "pairing" | "connected" | "reconnecting"

export type BridgeStateDetail = {
  status: ConnectionStatus
  port?: number
  code?: number
  reason?: string
}

export type PairingStorage = {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export type FetchResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>

export function browserStorage(): PairingStorage {
  return {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
  }
}

export function parsePort(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

export function isPairCode(value: string): boolean {
  return new RegExp(`^\\d{${PAIR_CODE_LENGTH}}$`).test(value)
}

export function isPairResetCode(code: number | undefined): boolean {
  return code === 4000 || code === 4004
}

export function readToken(storage: PairingStorage): string | undefined {
  const token = storage.get(BROWSER_TOKEN_KEY)
  return token && token.length > 0 ? token : undefined
}

export function readPort(storage: PairingStorage): number | undefined {
  return parsePort(storage.get(BROWSER_PORT_KEY))
}

export function storePairing(storage: PairingStorage, token: string, port: number): void {
  storage.set(BROWSER_TOKEN_KEY, token)
  storage.set(BROWSER_PORT_KEY, String(port))
}

export function clearPairing(storage: PairingStorage): void {
  storage.remove(BROWSER_TOKEN_KEY)
  storage.remove(BROWSER_PORT_KEY)
}

export function bridgeUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`
}

export type ClaimFailureKind =
  | "NETWORK"
  | "SERVER"
  | "EXPIRED"
  | "LOCKED"
  | "BAD_CODE"
  | "UNAUTHORIZED"
  | "NO_CODE"
  | "UNKNOWN"

export type PairClaimSuccess = {
  ok: true
  token: string
  port: number
  protocolVersion: string
  bridgeVersion: string
}

export type PairClaimFailure = {
  ok: false
  kind: ClaimFailureKind
  status: number
  message: string
}

export type ClaimResult = PairClaimSuccess | PairClaimFailure

export type HintResult = { ok: true; port: number; requiresPair: boolean; autoPair: boolean } | PairClaimFailure

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl
  if (typeof fetch !== "function") throw new Error("fetch is unavailable")
  return (url, init) => fetch(url, init) as unknown as Promise<FetchResponse>
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function failure(status: number, kind: ClaimFailureKind, message: string): PairClaimFailure {
  return { ok: false, kind, status, message }
}

function failureKind(status: number, error: unknown): ClaimFailureKind {
  const data = record(record(error)?.data)
  const reason = typeof data?.reason === "string" ? data.reason : undefined
  if (reason === "LOCKED") return "LOCKED"
  if (reason === "EXPIRED") return "EXPIRED"
  if (reason === "BAD_CODE") return "BAD_CODE"
  if (reason === "UNAUTHORIZED") return "UNAUTHORIZED"
  if (reason === "NO_CODE") return "NO_CODE"
  if (status >= 500) return "SERVER"
  return "UNKNOWN"
}

export async function requestHint(options: { port: number; fetch?: FetchLike }): Promise<HintResult> {
  const send = resolveFetch(options.fetch)
  let response: FetchResponse
  try {
    response = await send(bridgeUrl(options.port, "/pair/hint"), { headers: { accept: "application/json" } })
  } catch (err) {
    return failure(0, "NETWORK", err instanceof Error ? err.message : "network error")
  }
  if (!response.ok) return failure(response.status, response.status >= 500 ? "SERVER" : "UNKNOWN", "hint failed")
  const body = record(await response.json())
  const port = typeof body?.port === "number" ? body.port : options.port
  return { ok: true, port, requiresPair: body?.requiresPair === true, autoPair: body?.autoPair === true }
}

export async function requestClaim(options: {
  port: number
  code?: string
  extensionId: string
  fetch?: FetchLike
  /** The bridge pre-approves this extension id, so no pair code is required. */
  auto?: boolean
}): Promise<ClaimResult> {
  if (!options.auto && !isPairCode(options.code ?? "")) return failure(0, "BAD_CODE", "pair code must be six digits")
  const send = resolveFetch(options.fetch)
  const payload: Record<string, string> = { extensionId: options.extensionId }
  if (options.code) payload.pairCode = options.code
  let response: FetchResponse
  try {
    response = await send(bridgeUrl(options.port, "/pair/claim"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return failure(0, "NETWORK", err instanceof Error ? err.message : "network error")
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return failure(response.status, response.status >= 500 ? "SERVER" : "UNKNOWN", "invalid response")
  }
  const value = record(body)
  if (response.ok && value?.ok === true && typeof value.token === "string") {
    return {
      ok: true,
      token: value.token,
      port: typeof value.port === "number" ? value.port : options.port,
      protocolVersion: typeof value.protocolVersion === "string" ? value.protocolVersion : "",
      bridgeVersion: typeof value.bridgeVersion === "string" ? value.bridgeVersion : "",
    }
  }
  return failure(response.status, failureKind(response.status, value?.error), "pairing rejected")
}

export type ClaimRetryOptions = {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

function isRetryable(kind: ClaimFailureKind): boolean {
  return kind === "NETWORK" || kind === "SERVER"
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function claimWithRetry(
  options: { port: number; code?: string; extensionId: string; fetch?: FetchLike; auto?: boolean },
  retry: ClaimRetryOptions = {},
): Promise<ClaimResult> {
  const attempts = Math.max(1, retry.attempts ?? 3)
  const base = retry.baseDelayMs ?? 250
  const cap = retry.maxDelayMs ?? 2_000
  const sleep = retry.sleep ?? defaultSleep
  let result: ClaimResult = failure(0, "UNKNOWN", "no attempt")
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await requestClaim(options)
    if (result.ok || !isRetryable(result.kind)) return result
    if (attempt < attempts - 1) await sleep(Math.min(cap, base * 2 ** attempt))
  }
  return result
}

export type PairingState = {
  status: ConnectionStatus
  port?: number
  error?: string
  attempt: number
}

export type PairingEvent =
  | { type: "submit"; port: number }
  | { type: "success"; port: number }
  | { type: "failure"; error: string }
  | { type: "lost" }
  | { type: "reconnect"; attempt: number }
  | { type: "reset" }

export function initialPairingState(port?: number): PairingState {
  return { status: "disconnected", port, attempt: 0 }
}

export function reducePairing(state: PairingState, event: PairingEvent): PairingState {
  switch (event.type) {
    case "submit":
      return { status: "pairing", port: event.port, error: undefined, attempt: 0 }
    case "success":
      return { status: "connected", port: event.port, error: undefined, attempt: 0 }
    case "failure":
      return { status: "disconnected", port: state.port, error: event.error, attempt: 0 }
    case "lost":
      return state.status === "connected" || state.status === "reconnecting"
        ? { status: "reconnecting", port: state.port, error: state.error, attempt: state.attempt }
        : state
    case "reconnect":
      return { status: "reconnecting", port: state.port, error: state.error, attempt: event.attempt }
    case "reset":
      return { status: "disconnected", port: state.port, error: undefined, attempt: 0 }
    default:
      return state
  }
}

export type BridgeErrorAction = "retry" | "select-tab" | "pair-again" | "open-settings" | "snapshot"

export type BridgeErrorInfo = {
  code: string
  text: string
  actionLabel: string
  action: BridgeErrorAction
}

const BRIDGE_ERRORS: Record<string, BridgeErrorInfo> = {
  DEVTOOLS_CONFLICT: {
    code: "DEVTOOLS_CONFLICT",
    text: "DevTools is open on this tab. Close it, then retry.",
    actionLabel: "Retry",
    action: "retry",
  },
  NO_TARGET: {
    code: "NO_TARGET",
    text: "No tab is selected, or the tab was closed.",
    actionLabel: "Select a tab",
    action: "select-tab",
  },
  NOT_PAIRED: {
    code: "NOT_PAIRED",
    text: "The extension is not paired with the bridge.",
    actionLabel: "Pair again",
    action: "pair-again",
  },
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    text: "The token is no longer valid.",
    actionLabel: "Pair again",
    action: "pair-again",
  },
  POLICY_DENIED: {
    code: "POLICY_DENIED",
    text: "This origin is not in the allowlist. Add it in Settings or use localhost.",
    actionLabel: "Open settings",
    action: "open-settings",
  },
  NETWORK_REFUSED: {
    code: "NETWORK_REFUSED",
    text: "Could not reach the URL. Check the app is running on the right port.",
    actionLabel: "Retry",
    action: "retry",
  },
  STALE_REF: {
    code: "STALE_REF",
    text: "The page changed since the previous snapshot. Take a new snapshot.",
    actionLabel: "Snapshot again",
    action: "snapshot",
  },
}

export function describeBridgeError(code: string | undefined): BridgeErrorInfo | undefined {
  if (!code) return undefined
  return BRIDGE_ERRORS[code]
}

export function matchBridgeError(text: string | undefined): BridgeErrorInfo | undefined {
  if (!text) return undefined
  for (const info of Object.values(BRIDGE_ERRORS)) {
    if (text.includes(info.code)) return info
  }
  return undefined
}

export type ConnectionBannerModel = {
  visible: boolean
  text: string
  tone: "warn" | "error"
  action: BridgeErrorAction | undefined
  actionLabel: string
}

export function connectionBanner(state: PairingState, error?: BridgeErrorInfo): ConnectionBannerModel {
  if (error) {
    return { visible: true, text: error.text, tone: "error", action: error.action, actionLabel: error.actionLabel }
  }
  if (state.status === "reconnecting") {
    return {
      visible: true,
      text: "Reconnecting to the Kilo bridge...",
      tone: "warn",
      action: "pair-again",
      actionLabel: "Pair again",
    }
  }
  return { visible: false, text: "", tone: "warn", action: undefined, actionLabel: "" }
}
