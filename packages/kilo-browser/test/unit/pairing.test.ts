import { test, expect } from "bun:test"
import { Pairing } from "../../src/bridge/pairing"

test("pairing code expires after TTL", () => {
  let clock = 1_000
  const pairing = new Pairing({ now: () => clock, ttlMs: 120_000 })
  const code = pairing.code
  clock += 120_001
  const result = pairing.issue({ pairCode: code, extensionId: "ext" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.kind).toBe("EXPIRED")
})

test("five bad codes lock pairing for 60 seconds", () => {
  let clock = 5_000
  const pairing = new Pairing({ now: () => clock, ttlMs: 120_000, lockoutMs: 60_000 })
  const good = pairing.code
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const result = pairing.issue({ pairCode: "000000", extensionId: "ext" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe("BAD_CODE")
  }
  const fifth = pairing.issue({ pairCode: "000000", extensionId: "ext" })
  expect(fifth.ok).toBe(false)
  if (!fifth.ok) expect(fifth.kind).toBe("LOCKED")
  expect(pairing.lockedUntil).toBe(clock + 60_000)

  const during = pairing.issue({ pairCode: good, extensionId: "ext" })
  expect(during.ok).toBe(false)
  if (!during.ok) expect(during.kind).toBe("LOCKED")

  clock += 60_001
  const after = pairing.issue({ pairCode: good, extensionId: "ext" })
  expect(after.ok).toBe(true)
})

test("one token is issued and bound to the extension", () => {
  let clock = 0
  const pairing = new Pairing({ now: () => clock, ttlMs: 120_000 })
  const first = pairing.issue({ pairCode: pairing.code, extensionId: "chrome-a" })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.token).toMatch(/^[a-f0-9]{64}$/)

  const again = pairing.issue({ pairCode: pairing.code, extensionId: "chrome-a" })
  expect(again.ok).toBe(true)
  if (again.ok) {
    expect(again.token).toBe(first.token)
    expect(again.reused).toBe(true)
  }

  const reconnect = pairing.issue({ token: first.token, extensionId: "chrome-a" })
  expect(reconnect.ok).toBe(true)
  if (reconnect.ok) expect(reconnect.token).toBe(first.token)

  const otherToken = pairing.issue({ token: first.token, extensionId: "chrome-b" })
  expect(otherToken.ok).toBe(false)
  const otherCode = pairing.issue({ pairCode: pairing.code, extensionId: "chrome-b" })
  expect(otherCode.ok).toBe(false)
})

test("pre-approved extension id pairs without a code and keeps the token", () => {
  const pairing = new Pairing({ now: () => 0 })
  const first = pairing.issue({ extensionId: "chrome-a", preApproved: true })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.token).toMatch(/^[a-f0-9]{64}$/)

  // A stale token from a previous bridge run is replaced, not rejected.
  const again = pairing.issue({ extensionId: "chrome-a", token: "0".repeat(64), preApproved: true })
  expect(again.ok).toBe(true)
  if (again.ok) expect(again.token).toBe(first.token)

  // Only the bound extension id may take over, even when pre-approved.
  const other = pairing.issue({ extensionId: "chrome-b", preApproved: true })
  expect(other.ok).toBe(false)

  // A supplied code is still validated; bad codes never pass.
  const badCode = pairing.issue({ extensionId: "chrome-a", pairCode: "000000", preApproved: true })
  expect(badCode.ok).toBe(false)
})

test("rotate revokes the old token and code", () => {
  const pairing = new Pairing({ now: () => 0, ttlMs: 120_000 })
  const first = pairing.issue({ pairCode: pairing.code, extensionId: "chrome-a" })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const oldToken = first.token
  const oldCode = pairing.code
  const newCode = pairing.rotate()
  expect(newCode).not.toBe(oldCode)
  expect(pairing.issue({ token: oldToken, extensionId: "chrome-a" }).ok).toBe(false)
  const next = pairing.issue({ pairCode: newCode, extensionId: "chrome-a" })
  expect(next.ok).toBe(true)
  if (next.ok) expect(next.token).not.toBe(oldToken)
})
