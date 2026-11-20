import { test, expect } from "bun:test"
import { BridgeTransport, backoffDelay, type ConnectionState, type PairingData, type Socket, type Timers } from "../../extension/src/transport/ws"
import { Router } from "../../extension/src/rpc/router"

class FakeSocket implements Socket {
  readonly sent: string[] = []
  private openListeners: (() => void)[] = []
  private closeListeners: ((code: number, reason: string) => void)[] = []
  private messageListeners: ((data: string) => void)[] = []
  private errorListeners: ((error: unknown) => void)[] = []

  readonly closed: { code: number; reason: string }[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close(code = 1000, reason = "") {
    this.closed.push({ code, reason })
    for (const listener of [...this.closeListeners]) listener(code, reason)
  }

  onOpen(listener: () => void) {
    this.openListeners.push(listener)
    return () => {
      this.openListeners = this.openListeners.filter((item) => item !== listener)
    }
  }

  onClose(listener: (code: number, reason: string) => void) {
    this.closeListeners.push(listener)
    return () => {
      this.closeListeners = this.closeListeners.filter((item) => item !== listener)
    }
  }

  onMessage(listener: (data: string) => void) {
    this.messageListeners.push(listener)
    return () => {
      this.messageListeners = this.messageListeners.filter((item) => item !== listener)
    }
  }

  onError(listener: (error: unknown) => void) {
    this.errorListeners.push(listener)
    return () => {
      this.errorListeners = this.errorListeners.filter((item) => item !== listener)
    }
  }

  open() {
    for (const listener of [...this.openListeners]) listener()
  }

  receive(message: unknown) {
    const data = typeof message === "string" ? message : JSON.stringify(message)
    for (const listener of [...this.messageListeners]) listener(data)
  }

  fail(error: unknown) {
    for (const listener of [...this.errorListeners]) listener(error)
  }
}

type Task = { fn: () => void; at: number }

function fakeTimers() {
  let time = 0
  let next = 0
  const tasks = new Map<number, Task>()
  const timers: Timers = {
    setTimeout(handler, ms) {
      const id = ++next
      tasks.set(id, { fn: handler, at: time + ms })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout(timer) {
      tasks.delete(Number(timer))
    },
  }
  return {
    timers,
    pending: () => tasks.size,
    async advance(ms: number) {
      time += ms
      const due = [...tasks.entries()].filter(([, task]) => task.at <= time).sort((a, b) => a[1].at - b[1].at)
      for (const [id, task] of due) {
        tasks.delete(id)
        task.fn()
        await Bun.sleep(0)
      }
    },
  }
}

function makeTransport(initial: PairingData | null) {
  const sockets: FakeSocket[] = []
  const states: ConnectionState[] = []
  const saved: PairingData[] = []
  let pairing = initial
  let cleared = 0
  const clock = fakeTimers()
  let statusCalls = 0
  const router = new Router()
  router.register(
    "browser.status",
    async () => {
      statusCalls += 1
      return { paired: true, tab: { id: 1 }, cdp: true }
    },
    { timeoutMs: 1000, idempotent: true },
  )
  const transport = new BridgeTransport({
    router,
    loadPairing: async () => pairing,
    savePairing: async (value) => {
      pairing = value
      saved.push(value)
    },
    clearPairing: async () => {
      pairing = null
      cleared += 1
    },
    bridgeUrl: async () => "ws://127.0.0.1:1234/ws",
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    extensionId: "kilotest",
    extensionVersion: "0.1.0",
    autoReconnect: true,
    timers: clock.timers,
    random: () => 0.5,
    onState: (state) => states.push(state),
  })
  return { transport, sockets, states, saved, clock, router, calls: () => statusCalls, cleared: () => cleared }
}

function hello(socket: FakeSocket) {
  socket.receive({ jsonrpc: "2.0", id: "hello", result: { ok: true, token: "a".repeat(64) } })
}

test("backoff sequence is capped and jittered inside 20 percent", () => {
  expect(backoffDelay(0, () => 0.5)).toBe(250)
  expect(backoffDelay(1, () => 0.5)).toBe(500)
  expect(backoffDelay(2, () => 0.5)).toBe(1000)
  expect(backoffDelay(3, () => 0.5)).toBe(2000)
  expect(backoffDelay(4, () => 0.5)).toBe(4000)
  expect(backoffDelay(5, () => 0.5)).toBe(8000)
  expect(backoffDelay(9, () => 0.5)).toBe(8000)
  expect(backoffDelay(0, () => 0)).toBe(200)
  expect(backoffDelay(0, () => 1)).toBe(300)
})

test("hello stores the paired token and routes tool requests", async () => {
  const pairing: PairingData = {
    extensionId: "kilotest",
    token: "b".repeat(64),
    bridgeUrl: "ws://127.0.0.1:1234/ws",
    pairedAt: "2026-11-19T00:00:00Z",
  }
  const h = makeTransport(pairing)
  await h.transport.start()
  expect(h.sockets).toHaveLength(1)
  const socket = h.sockets[0]!
  socket.open()
  const helloMessage = JSON.parse(socket.sent[0] ?? "{}") as Record<string, unknown>
  expect(helloMessage.method).toBe("hello")
  const params = helloMessage.params as Record<string, unknown>
  expect(params.bridgeToken).toBe("b".repeat(64))
  hello(socket)
  await Bun.sleep(0)
  expect(h.transport.state).toBe("connected")

  socket.receive({ jsonrpc: "2.0", id: "req_1", method: "browser.status", params: {} })
  await Bun.sleep(0)
  const response = socket.sent
    .map((item) => JSON.parse(item) as Record<string, unknown>)
    .find((item) => item.id === "req_1")
  expect(response?.result).toMatchObject({ paired: true })
  h.transport.stop()
})

test("close code 4004 clears the token and blocks reconnects", async () => {
  const h = makeTransport({
    extensionId: "kilotest",
    token: "c".repeat(64),
    bridgeUrl: "ws://127.0.0.1:1234/ws",
    pairedAt: "2026-11-19T00:00:00Z",
  })
  await h.transport.start()
  const socket = h.sockets[0]!
  socket.open()
  hello(socket)
  await Bun.sleep(0)
  socket.close(4004, "TOKEN_INVALID")
  await Bun.sleep(0)
  expect(h.cleared()).toBe(1)
  expect(h.transport.state).toBe("blocked")
  expect(h.clock.pending()).toBe(0)
})

test("close code 4001 retries with backoff instead of blocking", async () => {
  const h = makeTransport({
    extensionId: "kilotest",
    token: "d".repeat(64),
    bridgeUrl: "ws://127.0.0.1:1234/ws",
    pairedAt: "2026-11-19T00:00:00Z",
  })
  await h.transport.start()
  const socket = h.sockets[0]!
  socket.open()
  hello(socket)
  await Bun.sleep(0)
  socket.close(4001, "ALREADY_PAIRED")
  await Bun.sleep(0)
  expect(h.cleared()).toBe(0)
  expect(h.transport.state).toBe("reconnecting")
  await h.clock.advance(250)
  expect(h.sockets).toHaveLength(2)

  for (let attempt = 0; attempt < 12; attempt += 1) {
    h.sockets.at(-1)!.close(4001, "ALREADY_PAIRED")
    await Bun.sleep(0)
    await h.clock.advance(8000)
  }
  h.sockets.at(-1)!.close(4001, "ALREADY_PAIRED")
  await Bun.sleep(0)
  expect(h.transport.state).toBe("reconnecting")
  expect(h.cleared()).toBe(0)
})

test("close code 4000 rotates the pairing and blocks", async () => {
  const h = makeTransport({ extensionId: "kilotest", token: "f".repeat(64), bridgeUrl: "ws://127.0.0.1:1234/ws", pairedAt: "2026-11-19T00:00:00Z" })
  await h.transport.start()
  const socket = h.sockets[0]!
  socket.open()
  hello(socket)
  await Bun.sleep(0)
  socket.close(4000, "PAIR_ROTATED")
  await Bun.sleep(0)
  expect(h.cleared()).toBe(1)
  expect(h.transport.state).toBe("blocked")
})

test("close code 4002 blocks a version mismatch without clearing", async () => {
  const h = makeTransport({ extensionId: "kilotest", token: "g".repeat(64), bridgeUrl: "ws://127.0.0.1:1234/ws", pairedAt: "2026-11-19T00:00:00Z" })
  await h.transport.start()
  const socket = h.sockets[0]!
  socket.open()
  hello(socket)
  await Bun.sleep(0)
  socket.close(4002, "VERSION_MISMATCH")
  await Bun.sleep(0)
  expect(h.cleared()).toBe(0)
  expect(h.transport.state).toBe("blocked")
})

test("close code 4009 reconnects", async () => {
  const h = makeTransport({ extensionId: "kilotest", token: "h".repeat(64), bridgeUrl: "ws://127.0.0.1:1234/ws", pairedAt: "2026-11-19T00:00:00Z" })
  await h.transport.start()
  const socket = h.sockets[0]!
  socket.open()
  hello(socket)
  await Bun.sleep(0)
  socket.close(4009, "MESSAGE_TOO_BIG")
  expect(h.transport.state).toBe("reconnecting")
  await h.clock.advance(250)
  expect(h.sockets).toHaveLength(2)
})

test("heartbeat close reconnects after the first backoff delay", async () => {
  const h = makeTransport({
    extensionId: "kilotest",
    token: "e".repeat(64),
    bridgeUrl: "ws://127.0.0.1:1234/ws",
    pairedAt: "2026-11-19T00:00:00Z",
  })
  await h.transport.start()
  const socket = h.sockets[0]!
  socket.open()
  hello(socket)
  await Bun.sleep(0)
  socket.close(4003, "HEARTBEAT_TIMEOUT")
  expect(h.transport.state).toBe("reconnecting")
  await h.clock.advance(250)
  expect(h.sockets).toHaveLength(2)
})

test("forced reconnect closes the previous socket before replacing it", async () => {
  const h = makeTransport({
    extensionId: "kilotest",
    token: "i".repeat(64),
    bridgeUrl: "ws://127.0.0.1:1234/ws",
    pairedAt: "2026-11-19T00:00:00Z",
  })
  await h.transport.start()
  const first = h.sockets[0]!
  first.open()
  hello(first)
  await Bun.sleep(0)
  await h.transport.reconnectNow()
  expect(first.closed).toContainEqual({ code: 1000, reason: "RECONNECT" })
  expect(h.sockets).toHaveLength(2)
  h.transport.stop()
})

test("idempotency cache is cleared for a new connection", async () => {
  const h = makeTransport({
    extensionId: "kilotest",
    token: "j".repeat(64),
    bridgeUrl: "ws://127.0.0.1:1234/ws",
    pairedAt: "2026-11-19T00:00:00Z",
  })
  await h.transport.start()
  const first = h.sockets[0]!
  first.open()
  hello(first)
  await Bun.sleep(1)
  first.receive({ jsonrpc: "2.0", id: "same", method: "browser.status", params: {} })
  await Bun.sleep(1)
  expect(h.calls()).toBe(1)

  first.close(4009, "MESSAGE_TOO_BIG")
  await h.clock.advance(250)
  const second = h.sockets.at(-1)!
  second.open()
  hello(second)
  await Bun.sleep(1)
  second.receive({ jsonrpc: "2.0", id: "same", method: "browser.status", params: {} })
  await Bun.sleep(1)
  expect(h.calls()).toBe(2)
  const response = second.sent
    .map((item) => JSON.parse(item) as Record<string, unknown>)
    .find((item) => item.id === "same")
  expect(response?.result).toMatchObject({ paired: true })
  h.transport.stop()
})