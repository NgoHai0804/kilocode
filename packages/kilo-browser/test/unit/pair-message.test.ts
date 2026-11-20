import { test, expect } from "bun:test"
import { pairRequest } from "../../extension/src/background/pair-message"

test("pair code plus port resolves the loopback websocket url", () => {
  expect(pairRequest({ code: "123456", port: 4099 })).toEqual({
    ok: true,
    url: "ws://127.0.0.1:4099/ws",
    code: "123456",
  })
})

test("claimed token is preferred over the code", () => {
  const token = "a".repeat(64)
  expect(pairRequest({ token, code: "123456", port: 4099 })).toEqual({
    ok: true,
    url: "ws://127.0.0.1:4099/ws",
    token,
  })
})

test("an explicit url wins over the port", () => {
  expect(pairRequest({ code: "123456", url: "ws://127.0.0.1:8080/ws", port: 4099 })).toEqual({
    ok: true,
    url: "ws://127.0.0.1:8080/ws",
    code: "123456",
  })
})

test("rejects a missing or invalid bridge port", () => {
  expect(pairRequest({ code: "123456" })).toEqual({ ok: false, error: "url" })
  expect(pairRequest({ code: "123456", port: 0 })).toEqual({ ok: false, error: "url" })
  expect(pairRequest({ code: "123456", port: 70000 })).toEqual({ ok: false, error: "url" })
  expect(pairRequest({ code: "123456", port: "4099" })).toEqual({ ok: false, error: "url" })
})

test("rejects a message with neither code nor token", () => {
  expect(pairRequest({ port: 4099 })).toEqual({ ok: false, error: "code" })
  expect(pairRequest({ port: 4099, code: "", token: "" })).toEqual({ ok: false, error: "code" })
})
