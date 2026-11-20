import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../src/config/schema"
import { BridgeServer } from "../../src/bridge/server"
import type { KiloBackend } from "../../src/bridge/kilo"

type Message = Record<string, unknown>

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

function inbox(socket: WebSocket) {
  const messages: Message[] = []
  const waiters: { match: (message: Message) => boolean; resolve: (message: Message) => void }[] = []
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Message
    messages.push(message)
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!
      if (waiter.match(message)) {
        waiters.splice(index, 1)
        waiter.resolve(message)
      }
    }
  })
  return {
    messages,
    next(match: (message: Message) => boolean, timeoutMs = 2000) {
      const existing = messages.find(match)
      if (existing) {
        const index = messages.indexOf(existing)
        messages.splice(index, 1)
        return Promise.resolve(existing)
      }
      const deferred = Promise.withResolvers<Message>()
      const timer = setTimeout(() => {
        const index = waiters.findIndex((item) => item.resolve === deferred.resolve)
        if (index >= 0) waiters.splice(index, 1)
        deferred.reject(new Error("websocket message timeout"))
      }, timeoutMs)
      waiters.push({
        match,
        resolve: (message) => {
          clearTimeout(timer)
          deferred.resolve(message)
        },
      })
      return deferred.promise
    },
  }
}

type SocketCtor = new (url: string, options: Bun.WebSocketOptions) => WebSocket

function connect(url: string) {
  const Ctor = WebSocket as unknown as SocketCtor
  return new Ctor(url, {
    protocols: ["kilo-browser.v1"],
    headers: { Origin: "chrome-extension://kilotest" },
  })
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(25)
  }
  throw new Error("condition timed out")
}

test(
  "pairs, round-trips /tool, rejects a second client, and reports disconnects",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-bridge-"))
    const config = parse(
      merge(DEFAULT_CONFIG, {
        browser: { allowedExtensionIds: ["kilotest"], defaultTimeoutMs: 300 },
        logging: { level: "error" },
      }),
    )
    const bridge = new BridgeServer({
      workspace,
      config,
      kilo: fakeKilo(),
      token: "a".repeat(64),
    })
    let first: WebSocket | undefined
    let second: WebSocket | undefined
    try {
      await bridge.start()

      const initial = await fetch(`${bridge.url}/health`)
      const initialHealth = (await initial.json()) as Record<string, unknown>
      expect(initialHealth).toMatchObject({ ok: true, paired: false })
      expect(initialHealth.tab).toBeUndefined()
      expect((initialHealth.kilo as Record<string, unknown>).url).toBeUndefined()

      first = connect(bridge.wsUrl)
      const firstInbox = inbox(first)
      await new Promise<void>((resolve, reject) => {
        first!.addEventListener("open", () => resolve(), { once: true })
        first!.addEventListener("error", () => reject(new Error("first socket failed")), { once: true })
      })
      first.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "hello",
          params: {
            protocolVersion: "1.0",
            pairCode: bridge.pairCode,
            extensionVersion: "0.1.0",
            extensionId: "kilotest",
          },
        }),
      )
      const hello = await firstInbox.next((message) => message.id === 1 && message.result !== undefined)
      const helloResult = hello.result as Record<string, unknown>
      expect(helloResult.ok).toBe(true)
      expect(String(helloResult.token)).toMatch(/^[a-f0-9]{64}$/)
      expect(helloResult.protocolVersion).toBe("1.0")

      const pairedHealth = (await (await fetch(`${bridge.url}/health`)).json()) as Record<string, unknown>
      expect(pairedHealth.paired).toBe(true)
      expect(pairedHealth.pairingOpen).toBe(false)

      const runtimeText = await Bun.file(bridge.runtimePath).text()
      const runtime = JSON.parse(runtimeText) as Record<string, unknown>
      expect(runtime.token).toBe(bridge.token())
      expect(runtime.kiloAuth).toBeUndefined()
      expect(runtime.kiloUrl).toBe("http://127.0.0.1:1")
      expect(runtimeText).not.toContain("password")
      expect(runtimeText).not.toContain("Basic ")

      const statusPromise = fetch(`${bridge.url}/tool`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bridge.token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method: "browser.status", params: {} }),
      })
      const extensionRequest = await firstInbox.next((message) => message.method === "browser.status")
      first.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: extensionRequest.id,
          result: { paired: true, tab: { id: 7, url: "http://localhost:3000/" }, cdp: true },
        }),
      )
      const status = await statusPromise
      const statusBody = (await status.json()) as Record<string, unknown>
      expect(statusBody.ok).toBe(true)
      const finalStatus = (await (await fetch(`${bridge.url}/health`)).json()) as Record<string, unknown>
      expect(finalStatus.tab).toBeUndefined()
      const finalKilo = finalStatus.kilo as Record<string, unknown>
      expect(finalKilo.url).toBeUndefined()
      expect(finalKilo.healthy).toBe(true)

      const closed = Promise.withResolvers<number>()
      second = connect(bridge.wsUrl)
      second.addEventListener("close", (event) => closed.resolve(event.code))
      const code = await Promise.race([
        closed.promise,
        Bun.sleep(2000).then(() => {
          throw new Error("second socket was not closed")
        }),
      ])
      expect(code).toBe(4001)

      first.close()
      await waitFor(async () => {
        const health = (await (await fetch(`${bridge.url}/health`)).json()) as Record<string, unknown>
        return health.paired === false
      })

      const offline = await fetch(`${bridge.url}/tool`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bridge.token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method: "browser.status", params: {} }),
      })
      const offlineBody = (await offline.json()) as { ok: boolean; error: { data: { kind: string } } }
      expect(offlineBody.ok).toBe(false)
      expect(offlineBody.error.data.kind).toBe("NOT_PAIRED")

      const again = connect(bridge.wsUrl)
      const againInbox = inbox(again)
      await new Promise<void>((resolve, reject) => {
        again.addEventListener("open", () => resolve(), { once: true })
        again.addEventListener("error", () => reject(new Error("reconnect failed")), { once: true })
      })
      again.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "hello",
          params: {
            protocolVersion: "1.0",
            bridgeToken: bridge.token(),
            extensionVersion: "0.1.0",
            extensionId: "kilotest",
          },
        }),
      )
      const reconnect = await againInbox.next((message) => message.id === 2 && message.result !== undefined)
      expect((reconnect.result as Record<string, unknown>).token).toBe(bridge.token())

      const timeout = await fetch(`${bridge.url}/tool`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bridge.token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method: "browser.wait_for", params: { text: "never" }, timeoutMs: 100 }),
      })
      const timeoutBody = (await timeout.json()) as { ok: boolean; error: { data: { kind: string } } }
      expect(timeoutBody.ok).toBe(false)
      expect(timeoutBody.error.data.kind).toBe("TIMEOUT")

      const oldToken = bridge.token()
      const rotated = await fetch(`${bridge.url}/pair/rotate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${oldToken}` },
      })
      const rotatedBody = (await rotated.json()) as { ok: boolean; result: { token: string } }
      expect(rotatedBody.ok).toBe(true)
      expect(rotatedBody.result.token).toBe(bridge.token())
      expect(bridge.token()).not.toBe(oldToken)
      const stale = await fetch(`${bridge.url}/tool`, {
        method: "POST",
        headers: { Authorization: `Bearer ${oldToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method: "browser.status", params: {} }),
      })
      expect(stale.status).toBe(401)
      again.close()
      await bridge.stop()
      expect(await Bun.file(bridge.runtimePath).exists()).toBe(false)
    } finally {
      first?.close()
      second?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
    }
  },
  15000,
)



