import { test, expect } from "bun:test"
import { LoopGuard } from "../../src/bridge/loop"

test("blocks a signature only after maxRepeats consecutive failures", () => {
  const guard = new LoopGuard({ maxRepeats: 3 })
  const key = "ses|browser.click|abc"
  expect(guard.blocked(key)).toBe(false)
  guard.fail(key)
  guard.fail(key)
  expect(guard.blocked(key)).toBe(false)
  guard.fail(key)
  expect(guard.blocked(key)).toBe(true)
})

test("a successful call clears the failure run", () => {
  const guard = new LoopGuard({ maxRepeats: 2 })
  const key = "k"
  guard.fail(key)
  guard.pass(key)
  guard.fail(key)
  expect(guard.blocked(key)).toBe(false)
})

test("failures separated by the window start a fresh run", () => {
  let clock = 1_000
  const guard = new LoopGuard({ maxRepeats: 2, windowMs: 100, now: () => clock })
  const key = "k"
  guard.fail(key)
  clock += 1_000
  guard.fail(key)
  expect(guard.blocked(key)).toBe(false)
})

test("a blocked entry expires once the window passes", () => {
  let clock = 1_000
  const guard = new LoopGuard({ maxRepeats: 2, windowMs: 100, now: () => clock })
  const key = "k"
  guard.fail(key)
  guard.fail(key)
  expect(guard.blocked(key)).toBe(true)
  clock += 1_000
  expect(guard.blocked(key)).toBe(false)
})

test("the run map stays bounded by maxEntries", () => {
  const guard = new LoopGuard({ maxEntries: 3, windowMs: 1_000_000, now: () => 1 })
  for (let i = 0; i < 10; i += 1) guard.fail(`k${i}`)
  expect(guard.size).toBeLessThanOrEqual(3)
})
