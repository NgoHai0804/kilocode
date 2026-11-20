import { test, expect } from "bun:test"
import {
  clearPairing,
  claimWithRetry,
  initialPairingState,
  isPairCode,
  isPairResetCode,
  matchBridgeError,
  parsePort,
  readPort,
  readToken,
  reducePairing,
  requestClaim,
  requestHint,
  storePairing,
  type FetchLike,
  type PairingStorage,
} from "../../../../kilo-vscode/webview-ui/browser/pairing"

function memoryStorage(): PairingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

function jsonFetch(status: number, body: unknown): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
}

test("validates six-digit pair codes", () => {
  expect(isPairCode("123456")).toBe(true)
  expect(isPairCode("000000")).toBe(true)
  expect(isPairCode("12345")).toBe(false)
  expect(isPairCode("1234567")).toBe(false)
  expect(isPairCode("12a456")).toBe(false)
})

test("parses and bounds bridge ports", () => {
  expect(parsePort("7373")).toBe(7373)
  expect(parsePort("0")).toBeUndefined()
  expect(parsePort("65536")).toBeUndefined()
  expect(parsePort("abc")).toBeUndefined()
  expect(parsePort(null)).toBeUndefined()
  expect(parsePort("12.5")).toBeUndefined()
})

test("stores, reads, and clears the pairing token and port", () => {
  const storage = memoryStorage()
  expect(readToken(storage)).toBeUndefined()
  expect(readPort(storage)).toBeUndefined()
  storePairing(storage, "token-abc", 7373)
  expect(readToken(storage)).toBe("token-abc")
  expect(readPort(storage)).toBe(7373)
  clearPairing(storage)
  expect(readToken(storage)).toBeUndefined()
  expect(readPort(storage)).toBeUndefined()
})

test("hint reports the resolved port and auto-pair flag without secrets", async () => {
  const result = await requestHint({
    port: 7373,
    fetch: jsonFetch(200, { ok: true, port: 8888, requiresPair: true, autoPair: true }),
  })
  expect(result).toEqual({ ok: true, port: 8888, requiresPair: true, autoPair: true })
})

test("auto claim skips the code and a manual claim still requires one", async () => {
  const auto = await requestClaim({
    port: 7373,
    extensionId: "ext-1",
    auto: true,
    fetch: jsonFetch(200, { ok: true, token: "tok", port: 7373, protocolVersion: "1.0", bridgeVersion: "0.1.0" }),
  })
  expect(auto.ok).toBe(true)
  if (auto.ok) expect(auto.token).toBe("tok")

  let calls = 0
  const fetchImpl: FetchLike = async () => {
    calls += 1
    return { ok: true, status: 200, json: async () => ({ ok: true, token: "t" }) }
  }
  const rejected = await requestClaim({ port: 7373, extensionId: "ext-1", fetch: fetchImpl })
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) expect(rejected.kind).toBe("BAD_CODE")
  expect(calls).toBe(0)
})

test("claim returns the token and version envelope", async () => {
  const result = await requestClaim({
    port: 7373,
    code: "123456",
    extensionId: "ext-1",
    fetch: jsonFetch(200, { ok: true, token: "tok", port: 7373, protocolVersion: "1.0", bridgeVersion: "0.1.0" }),
  })
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.token).toBe("tok")
    expect(result.protocolVersion).toBe("1.0")
    expect(result.bridgeVersion).toBe("0.1.0")
  }
})

test("claim maps the pairing failure reason", async () => {
  const bad = await requestClaim({
    port: 7373,
    code: "000000",
    extensionId: "ext-1",
    fetch: jsonFetch(401, { ok: false, error: { message: "UNAUTHORIZED", data: { reason: "BAD_CODE", attempt: 2 } } }),
  })
  expect(bad.ok).toBe(false)
  if (!bad.ok) expect(bad.kind).toBe("BAD_CODE")

  const locked = await requestClaim({
    port: 7373,
    code: "000000",
    extensionId: "ext-1",
    fetch: jsonFetch(429, { ok: false, error: { message: "RATE_LIMIT", data: { reason: "LOCKED" } } }),
  })
  expect(locked.ok).toBe(false)
  if (!locked.ok) expect(locked.kind).toBe("LOCKED")
})

test("claim rejects a bad code locally without calling the bridge", async () => {
  let calls = 0
  const fetchImpl: FetchLike = async () => {
    calls += 1
    return { ok: true, status: 200, json: async () => ({ ok: true, token: "t" }) }
  }
  const result = await requestClaim({ port: 7373, code: "abc", extensionId: "ext-1", fetch: fetchImpl })
  expect(result.ok).toBe(false)
  expect(calls).toBe(0)
})

test("claim retry policy retries transient failures only", async () => {
  let calls = 0
  const flaky: FetchLike = async () => {
    calls += 1
    if (calls === 1) throw new Error("network down")
    return { ok: true, status: 200, json: async () => ({ ok: true, token: "t", port: 7373, protocolVersion: "1.0", bridgeVersion: "0.1.0" }) }
  }
  const recovered = await claimWithRetry(
    { port: 7373, code: "123456", extensionId: "ext-1", fetch: flaky },
    { attempts: 3, baseDelayMs: 0, sleep: async () => undefined },
  )
  expect(recovered.ok).toBe(true)
  expect(calls).toBe(2)

  let rejected = 0
  const invalid: FetchLike = async () => {
    rejected += 1
    return { ok: false, status: 401, json: async () => ({ ok: false, error: { data: { reason: "BAD_CODE" } } }) }
  }
  const result = await claimWithRetry(
    { port: 7373, code: "123456", extensionId: "ext-1", fetch: invalid },
    { attempts: 3, baseDelayMs: 0, sleep: async () => undefined },
  )
  expect(result.ok).toBe(false)
  expect(rejected).toBe(1)
})

test("connection state machine moves disconnected to pairing to connected to reconnecting", () => {
  let state = initialPairingState()
  expect(state.status).toBe("disconnected")
  state = reducePairing(state, { type: "submit", port: 7373 })
  expect(state.status).toBe("pairing")
  state = reducePairing(state, { type: "success", port: 7373 })
  expect(state.status).toBe("connected")
  state = reducePairing(state, { type: "lost" })
  expect(state.status).toBe("reconnecting")
  state = reducePairing(state, { type: "failure", error: "bad code" })
  expect(state.status).toBe("disconnected")
  expect(state.error).toBe("bad code")
  expect(reducePairing(state, { type: "lost" }).status).toBe("disconnected")
})

test("reserved close codes request a fresh pairing", () => {
  expect(isPairResetCode(4000)).toBe(true)
  expect(isPairResetCode(4004)).toBe(true)
  expect(isPairResetCode(1006)).toBe(false)
  expect(isPairResetCode(undefined)).toBe(false)
})

test("maps DevTools and other bridge errors to actionable guidance", () => {
  const devtools = matchBridgeError("browser.navigate DEVTOOLS_CONFLICT: tab already debugged")
  expect(devtools?.code).toBe("DEVTOOLS_CONFLICT")
  expect(devtools?.action).toBe("retry")
  expect(matchBridgeError("no known code here")).toBeUndefined()
})
