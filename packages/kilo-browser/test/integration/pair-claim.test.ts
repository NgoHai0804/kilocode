import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../src/config/schema"
import { BridgeServer } from "../../src/bridge/server"
import { handle } from "../../src/bridge/http"
import type { KiloBackend } from "../../src/bridge/kilo"

const ORIGIN = "chrome-extension://kilotest"

function fakeKilo(): KiloBackend {
  return {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => ({ id: "ses_test" }),
    promptAsync: async () => undefined,
    prompt: async () => ({ id: "msg_test" }),
    abort: async () => undefined,
    getMessages: async () => [],
  }
}

function config(level: "info" | "error" = "error") {
  return parse(
    merge(DEFAULT_CONFIG, {
      browser: { allowedExtensionIds: ["kilotest"], defaultTimeoutMs: 300 },
      logging: { level },
      bridge: { heartbeatMs: 60_000, pongTimeoutMs: 120_000 },
    }),
  )
}

async function makeBridge(options: { workspace: string; level?: "info" | "error" }) {
  const bridge = new BridgeServer({
    workspace: options.workspace,
    config: config(options.level),
    kilo: fakeKilo(),
    token: "a".repeat(64),
  })
  return bridge
}

function hint(port: number, origin = ORIGIN) {
  return fetch(`http://127.0.0.1:${port}/pair/hint`, { headers: { origin } })
}

function claim(port: number, body: unknown, origin = ORIGIN) {
  return fetch(`http://127.0.0.1:${port}/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  })
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function portOf(bridge: BridgeServer): number {
  const port = bridge.port
  if (port === undefined) throw new Error("bridge has no port")
  return port
}

test(
  "hint exposes the port without secrets and flips requiresPair after a claim",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-pair-"))
    const bridge = await makeBridge({ workspace })
    try {
      await bridge.start()

      const before = await hint(portOf(bridge))
      expect(before.status).toBe(200)
      expect(before.headers.get("access-control-allow-origin")).toBe(ORIGIN)
      const beforeBody = await body(before)
      expect(beforeBody.port).toBe(portOf(bridge))
      expect(beforeBody.requiresPair).toBe(true)
      expect(beforeBody.token).toBeUndefined()

      const claimed = await claim(portOf(bridge), { pairCode: bridge.pairCode, extensionId: "kilotest" })
      expect(claimed.status).toBe(200)
      const claimedBody = await body(claimed)
      expect(claimedBody.token).toBe(bridge.token())
      expect(claimedBody.port).toBe(portOf(bridge))
      expect(typeof claimedBody.protocolVersion).toBe("string")
      expect(typeof claimedBody.bridgeVersion).toBe("string")

      const after = await body(await hint(portOf(bridge)))
      expect(after.requiresPair).toBe(false)
    } finally {
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "claim rejects bad codes and locks after five failures",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-pair-"))
    const bridge = await makeBridge({ workspace })
    try {
      await bridge.start()

      for (let attempt = 1; attempt < 5; attempt += 1) {
        const response = await claim(portOf(bridge), { pairCode: "000000", extensionId: "kilotest" })
        expect(response.status).toBe(401)
        const value = await body<{ ok: boolean; error: { data: { reason: string } } }>(response)
        expect(value.ok).toBe(false)
        expect(value.error.data.reason).toBe("BAD_CODE")
      }

      const fifth = await claim(portOf(bridge), { pairCode: "000000", extensionId: "kilotest" })
      expect(fifth.status).toBe(429)
      const locked = await body<{ error: { data: { reason: string } } }>(fifth)
      expect(locked.error.data.reason).toBe("LOCKED")

      const during = await claim(portOf(bridge), { pairCode: bridge.pairCode, extensionId: "kilotest" })
      expect(during.status).toBe(429)
    } finally {
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "claim enforces loopback, extension origin, allowlist, and matching extension id",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-pair-"))
    const bridge = await makeBridge({ workspace })
    try {
      await bridge.start()

      const foreign = await claim(portOf(bridge), { pairCode: bridge.pairCode, extensionId: "kilotest" }, "https://evil.example")
      expect(foreign.status).toBe(403)

      const wrongId = await claim(portOf(bridge), { pairCode: bridge.pairCode, extensionId: "other" })
      expect(wrongId.status).toBe(403)

      const missing = await claim(portOf(bridge), { extensionId: "kilotest" })
      expect(missing.status).toBe(400)

      const url = "http://127.0.0.1/pair/claim"
      const offLoopback = await handle(
        new Request(url, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" }),
        bridge,
        "203.0.113.9",
      )
      expect(offLoopback.status).toBe(403)
      const offBody = await body<{ error: { data: { reason: string } } }>(offLoopback)
      expect(offBody.error.data.reason).toBe("loopback_required")

      const unknown = await handle(new Request(url, { method: "POST", headers: { origin: ORIGIN }, body: "{}" }), bridge)
      expect(unknown.status).toBe(403)
    } finally {
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "never writes the pair code or issued token to the bridge log",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-pair-"))
    const bridge = await makeBridge({ workspace, level: "info" })
    const code = bridge.pairCode
    try {
      await bridge.start()
      const response = await claim(portOf(bridge), { pairCode: code, extensionId: "kilotest" })
      expect(response.status).toBe(200)
      const token = bridge.token()

      const failed = await claim(portOf(bridge), { pairCode: "000000", extensionId: "kilotest" })
      expect(failed.status).toBe(401)
      expect(token).not.toBe(code)

      await bridge.stop()
      const logPath = path.join(workspace, config("info").logging.file)
      const text = await Bun.file(logPath).text()
      expect(text.length).toBeGreaterThan(0)
      const stripped = text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const entry = JSON.parse(line) as Record<string, unknown>
          delete entry.ts
          return JSON.stringify(entry)
        })
        .join("\n")
      expect(stripped.includes(code)).toBe(false)
      expect(stripped.includes(token)).toBe(false)
      expect(stripped.includes("pair.ok")).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  },
  15000,
)
