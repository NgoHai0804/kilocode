import { test, expect } from "bun:test"
import { backoffDelay } from "../../extension/src/transport/ws"

test("reconnect backoff follows 250ms to 8s and caps", () => {
  expect(backoffDelay(0, () => 0.5)).toBe(250)
  expect(backoffDelay(1, () => 0.5)).toBe(500)
  expect(backoffDelay(2, () => 0.5)).toBe(1000)
  expect(backoffDelay(3, () => 0.5)).toBe(2000)
  expect(backoffDelay(4, () => 0.5)).toBe(4000)
  expect(backoffDelay(5, () => 0.5)).toBe(8000)
  expect(backoffDelay(10, () => 0.5)).toBe(8000)
})

test("reconnect jitter stays inside 20 percent", () => {
  expect(backoffDelay(0, () => 0)).toBe(200)
  expect(backoffDelay(0, () => 1)).toBe(300)
  expect(backoffDelay(5, () => 0)).toBe(6400)
  expect(backoffDelay(5, () => 1)).toBe(9600)
})