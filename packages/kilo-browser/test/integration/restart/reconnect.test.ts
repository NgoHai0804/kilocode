import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../../src/config/schema"
import { BridgeServer } from "../../../src/bridge/server"
import type { KiloBackend } from "../../../src/bridge/kilo"
import { executeTool, type HttpBridge } from "../../../src/bridge/http"
import { RpcFailure } from "../../../src/protocol/rpc"

type Message = Record<string, unknown>

function kilo(): KiloBackend {
  return {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => ({ id: "ses_restart" }),
    promptAsync: async () => undefined,
    prompt: async () => ({}),
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
    next(match: (message: Message) => boolean, timeoutMs = 3000) {
      const existing = messages.find(match)
      if (existing) return Promise.resolve(existing)
      const deferred = Promise.withResolvers<Message>()
      const timer = setTimeout(() => deferred.reject(new Error("websocket timeout")), timeoutMs)
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

async function open(socket: WebSocket) {
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true })
  })
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(25)
  }
  throw new Error("condition timed out")
}

test("AC-15: a dropped extension socket reconnects and the next tool call succeeds", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-restart-"))
  const config = parse(
    merge(DEFAULT_CONFIG, {
      bridge: { idleTimeoutMs: 60000 },
      browser: { allowedExtensionIds: ["kilotest"], defaultTimeoutMs: 1000 },
      logging: { level: "debug" },
    }),
  )
  const bridge = new BridgeServer({ workspace, config, kilo: kilo(), token: "b".repeat(64) })
  let first: WebSocket | undefined
  let second: WebSocket | undefined
  try {
    await bridge.start()
    first = connect(bridge.wsUrl)
    const firstInbox = inbox(first)
    await open(first)
    first.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hello", params: {
      protocolVersion: "1.0", pairCode: bridge.pairCode, extensionVersion: "0.1.0", extensionId: "kilotest",
    } }))
    const hello = await firstInbox.next((message) => message.id === 1 && message.result !== undefined)
    const token = (hello.result as Record<string, unknown>).token
    expect(typeof token).toBe("string")
    first.close()
    await waitFor(async () => {
      const health = (await (await fetch(`${bridge.url}/health`)).json()) as Record<string, unknown>
      return health.paired === false
    })

    second = connect(bridge.wsUrl)
    const secondInbox = inbox(second)
    await open(second)
    second.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "hello", params: {
      protocolVersion: "1.0", bridgeToken: bridge.token(), extensionVersion: "0.1.0", extensionId: "kilotest",
    } }))
    const reconnect = await secondInbox.next((message) => message.id === 2 && message.result !== undefined)
    expect((reconnect.result as Record<string, unknown>).token).toBe(bridge.token())

    const call = fetch(`${bridge.url}/tool`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridge.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ method: "browser.status", params: {} }),
    })
    const request = await secondInbox.next((message) => message.method === "browser.status")
    second.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { paired: true, tab: { id: 3 }, cdp: true } }))
    const response = (await (await call).json()) as Record<string, unknown>
    expect(response.ok).toBe(true)
    await Bun.sleep(100)
    const log = await Bun.file(path.join(workspace, config.logging.file)).text()
    expect((log.match(/"event":"ws.open"/g) ?? []).length).toBeGreaterThanOrEqual(2)
  } finally {
    first?.close()
    second?.close()
    await bridge.stop()
    await rm(workspace, { recursive: true, force: true })
  }
}, 15000)
