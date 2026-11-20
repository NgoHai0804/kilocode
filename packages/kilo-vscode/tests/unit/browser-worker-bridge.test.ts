import { test, expect, beforeEach, afterEach } from "bun:test"
import { notifyWorker } from "../../webview-ui/browser/worker-bridge"

type Globals = { chrome?: unknown }

let sent: unknown[] = []

beforeEach(() => {
  sent = []
  ;(globalThis as Globals).chrome = {
    runtime: {
      sendMessage: (message: unknown) => {
        sent.push(message)
        return Promise.resolve({ ok: true })
      },
    },
  }
})

afterEach(() => {
  ;(globalThis as Globals).chrome = undefined
})

test("forwards the pair message to the service worker", () => {
  notifyWorker({ type: "kilo.pair", code: "123456", port: 4099 })
  expect(sent).toEqual([{ type: "kilo.pair", code: "123456", port: 4099 }])
})

test("forwards the claimed token used by a restored UI session", () => {
  const token = "b".repeat(64)
  notifyWorker({ type: "kilo.pair", token, port: 4099 })
  expect(sent).toEqual([{ type: "kilo.pair", token, port: 4099 }])
})

test("is a no-op outside the extension", () => {
  ;(globalThis as Globals).chrome = undefined
  expect(() => notifyWorker({ type: "kilo.pair", code: "123456", port: 4099 })).not.toThrow()
  expect(sent).toEqual([])
})

test("a rejected worker call does not throw into the caller", async () => {
  ;(globalThis as Globals).chrome = {
    runtime: { sendMessage: () => Promise.reject(new Error("no listener")) },
  }
  expect(() => notifyWorker({ type: "kilo.pair", port: 4099, code: "123456" })).not.toThrow()
  await Bun.sleep(0)
})
