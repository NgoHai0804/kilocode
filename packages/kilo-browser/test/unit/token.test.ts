import { test, expect } from "bun:test"
import { Pairing } from "../../src/bridge/pairing"
import { tokenTag } from "../../src/policy/redact"

test("bridge tokens are 32 random bytes in hex", () => {
  const pairing = new Pairing()
  const token = pairing.currentToken
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(Buffer.from(token, "hex").length).toBe(32)
  expect(tokenTag(token)).toMatch(/^[a-f0-9]{8}$/)
  expect(new Pairing().currentToken).not.toBe(token)
})

test("pair code is six digits and expires after the 120 second default", () => {
  let clock = 1_000
  const pairing = new Pairing({ now: () => clock })
  expect(pairing.code).toMatch(/^\d{6}$/)
  clock += 120_001
  const result = pairing.issue({ pairCode: pairing.code, extensionId: "ext" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.kind).toBe("EXPIRED")
})

test("five bad codes lock pairing for sixty seconds", () => {
  let clock = 0
  const pairing = new Pairing({ now: () => clock })
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const result = pairing.issue({ pairCode: "000000", extensionId: "ext" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe("BAD_CODE")
  }
  const fifth = pairing.issue({ pairCode: "000000", extensionId: "ext" })
  expect(fifth.ok).toBe(false)
  if (!fifth.ok) expect(fifth.kind).toBe("LOCKED")
  expect(pairing.lockedUntil).toBe(clock + 60_000)
  clock += 60_001
  expect(pairing.issue({ pairCode: pairing.code, extensionId: "ext" }).ok).toBe(true)
})

test("revoke invalidates the old token and issues a new one", () => {
  const pairing = new Pairing({ now: () => 0 })
  const first = pairing.issue({ pairCode: pairing.code, extensionId: "chrome-a" })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const old = first.token
  const next = pairing.revoke()
  expect(next).not.toBe(old)
  expect(pairing.verify(old)).toBe(false)
  expect(pairing.verify(next)).toBe(true)
  expect(pairing.issue({ token: old, extensionId: "chrome-a" }).ok).toBe(false)
  const again = pairing.issue({ token: next, extensionId: "chrome-a" })
  expect(again.ok).toBe(true)
})

test("restart creates a new pairing instance and invalidates the old token", () => {
  const first = new Pairing({ now: () => 0 })
  const issued = first.issue({ pairCode: first.code, extensionId: "chrome-a" })
  expect(issued.ok).toBe(true)
  if (!issued.ok) return
  const restarted = new Pairing({ now: () => 0 })
  expect(restarted.currentToken).not.toBe(issued.token)
  expect(restarted.verify(issued.token)).toBe(false)
  expect(restarted.issue({ token: issued.token, extensionId: "chrome-a" }).ok).toBe(false)
})

test("rotate changes both the pair code and the token", () => {
  const pairing = new Pairing({ now: () => 0 })
  const first = pairing.issue({ pairCode: pairing.code, extensionId: "chrome-a" })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const code = pairing.code
  const token = first.token
  const nextCode = pairing.rotate()
  expect(nextCode).not.toBe(code)
  expect(pairing.currentToken).not.toBe(token)
  expect(pairing.verify(token)).toBe(false)
})