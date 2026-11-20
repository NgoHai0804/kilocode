import { test, expect } from "bun:test"
import { Router } from "../../extension/src/rpc/router"

function request(id: string | number, method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method, params }
}

test("dispatches JSON-RPC and preserves the id", async () => {
  const router = new Router()
  router.register("browser.status", async () => ({ paired: true }), { timeoutMs: 1000 })
  const response = await router.handle(request("req_1", "browser.status"))
  expect(response?.id).toBe("req_1")
  expect(response?.result).toEqual({ paired: true })
  expect(response?.error).toBeUndefined()
})

test("returns METHOD_NOT_FOUND and handles parse errors", async () => {
  const router = new Router()
  const missing = await router.handle(request(1, "browser.nope"))
  expect(missing?.error?.data.kind).toBe("METHOD_NOT_FOUND")
  const parsed = await router.handleText("{not json")
  expect(parsed?.error?.code).toBe(-32700)
})

test("runs one tool at a time", async () => {
  const router = new Router()
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  router.register(
    "browser.status",
    async () => {
      events.push("first:start")
      await gate.promise
      events.push("first:end")
      return { ok: 1 }
    },
    { timeoutMs: 2000 },
  )
  router.register(
    "browser.snapshot",
    async () => {
      events.push("second")
      return { ok: 2 }
    },
    { timeoutMs: 2000 },
  )

  const first = router.handle(request(1, "browser.status"))
  await Bun.sleep(0)
  expect(events).toEqual(["first:start"])
  const second = router.handle(request(2, "browser.snapshot"))
  await Bun.sleep(0)
  expect(events).toEqual(["first:start"])

  gate.resolve()
  expect((await first)?.result).toEqual({ ok: 1 })
  expect((await second)?.result).toEqual({ ok: 2 })
  expect(events).toEqual(["first:start", "first:end", "second"])
})

test("queued calls become BUSY after the wait budget", async () => {
  const router = new Router({ busyWaitMs: 20 })
  router.register("browser.status", () => new Promise(() => undefined), { timeoutMs: 2000 })
  const first = router.handle(request(1, "browser.status"))
  const second = await router.handle(request(2, "browser.status"))
  expect(second?.error?.data.kind).toBe("BUSY")
  router.cancel(1)
  expect((await first)?.error?.data.kind).toBe("CANCELLED")
})

test("cancel aborts the active handler and returns CANCELLED", async () => {
  const router = new Router()
  const started = Promise.withResolvers<AbortSignal>()
  router.register(
    "browser.wait_for",
    async (_params, signal) => {
      started.resolve(signal)
      await Bun.sleep(50)
      return { matched: true }
    },
    { timeoutMs: 2000 },
  )
  const pending = router.handle(request("req_9", "browser.wait_for"))
  const signal = await started.promise
  router.cancel("req_9")
  const response = await pending
  expect(response?.error?.data.kind).toBe("CANCELLED")
  expect(signal.aborted).toBe(true)
})

test("idempotent methods cache results by request id", async () => {
  const router = new Router()
  let calls = 0
  router.register(
    "browser.console",
    async () => {
      calls += 1
      return { entries: [], dropped: 0, call: calls }
    },
    { timeoutMs: 1000, idempotent: true },
  )
  const first = await router.handle(request("same", "browser.console"))
  const second = await router.handle(request("same", "browser.console"))
  expect(calls).toBe(1)
  expect(second?.result).toEqual(first?.result)
})

test("non-idempotent methods run again for the same request id", async () => {
  const router = new Router()
  let calls = 0
  router.register(
    "browser.navigate",
    async () => {
      calls += 1
      return { url: "http://localhost:3000/", title: "Login", status: 200 }
    },
    { timeoutMs: 1000 },
  )
  await router.handle(request("nav", "browser.navigate"))
  await router.handle(request("nav", "browser.navigate"))
  expect(calls).toBe(2)
})

test("tool timeout returns TIMEOUT", async () => {
  const router = new Router()
  router.register("browser.screenshot", () => new Promise(() => undefined), { timeoutMs: 20 })
  const response = await router.handle(request(1, "browser.screenshot"))
  expect(response?.error?.data.kind).toBe("TIMEOUT")
})

test("notifications do not produce responses", async () => {
  const router = new Router()
  const response = await router.handle({ jsonrpc: "2.0", method: "browser.cancel", params: { requestId: "x" } })
  expect(response).toBeUndefined()
})
test("reset clears the idempotency cache", async () => {
  const router = new Router()
  let calls = 0
  router.register(
    "browser.console",
    async () => {
      calls += 1
      return { entries: [], dropped: 0, call: calls }
    },
    { timeoutMs: 1000, idempotent: true },
  )
  await router.handle(request("same", "browser.console"))
  await router.handle(request("same", "browser.console"))
  expect(calls).toBe(1)
  router.reset()
  await router.handle(request("same", "browser.console"))
  expect(calls).toBe(2)
})