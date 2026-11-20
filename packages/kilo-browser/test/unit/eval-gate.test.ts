import { test, expect } from "bun:test"
import { decideEval, type EvalApproval } from "../../src/plugin/eval"
import { ApprovalGate } from "../../src/bridge/approval"
import { ApprovalRegistry } from "../../extension/src/approval/registry"
import { DEFAULT_CONFIG, type BrowserConfig } from "../../src/config/schema"

function config(policy: "allow" | "ask" | "deny"): BrowserConfig {
  return { ...DEFAULT_CONFIG, tools: { ...DEFAULT_CONFIG.tools, eval: policy } }
}

test("decideEval is fail-closed and only allows ask with a valid approval", () => {
  const future = Date.now() + 10_000
  const once: EvalApproval = { decision: "allow-once", expiresAt: future }
  const tab: EvalApproval = { decision: "allow-tab", tabId: 1, expiresAt: future }
  expect(decideEval(config("deny"), once)).toBe("deny")
  expect(decideEval(config("allow"), once)).toBe("deny")
  expect(decideEval(config("ask"), undefined)).toBe("ask")
  expect(decideEval(config("ask"), once)).toBe("allow")
  expect(decideEval(config("ask"), tab)).toBe("allow")
  expect(decideEval(config("ask"), { decision: "allow-once", expiresAt: Date.now() - 1 })).toBe("deny")
  expect(decideEval(config("ask"), { decision: "timeout" })).toBe("deny")
  expect(decideEval(config("ask"), { decision: "deny" })).toBe("deny")
  expect(decideEval(config("ask"), { decision: "missing" })).toBe("deny")
})

test("ApprovalGate resolves allow-once and allow-tab decisions", async () => {
  const events: string[] = []
  const gate = new ApprovalGate({
    timeoutMs: 1000,
    tabTtlMs: 15 * 60_000,
    onEvent: (event) => {
      events.push(event.type)
    },
  })
  const once = gate.request({ tool: "browser.eval", method: "browser.eval", preview: "document.title", tabId: 9 })
  expect(gate.pendingCount()).toBe(1)
  const asked = events.includes("permission.asked")
  expect(asked).toBe(true)
  const requestId = pendingID(events, gate)
  expect(requestId).toBeDefined()
  expect(gate.reply(requestId!, "allow-once", 9)).toBe(true)
  await expect(once).resolves.toMatchObject({ decision: "allow-once", tabId: 9 })

  const tab = gate.request({ tool: "browser.eval", method: "browser.eval", preview: "document.title", tabId: 9 })
  const tabID = pendingIDFromGate(gate)
  expect(gate.reply(tabID!, "allow-tab", 9)).toBe(true)
  await expect(tab).resolves.toMatchObject({ decision: "allow-tab", tabId: 9 })

  const cached = await gate.request({ tool: "browser.eval", method: "browser.eval", preview: "document.title", tabId: 9 })
  expect(cached.decision).toBe("allow-tab")
  expect(cached.requestId).toBe("cached")
  expect(events).toContain("permission.replied")
  expect(gate.reply("missing", "deny")).toBe(false)
  gate.close()
})

test("ApprovalGate times out without a reply", async () => {
  const gate = new ApprovalGate({ timeoutMs: 10 })
  const result = await gate.request({ tool: "browser.eval", method: "browser.eval", preview: "x" })
  expect(result.decision).toBe("timeout")
  expect(gate.pendingCount()).toBe(0)
  gate.close()
})

test("extension ApprovalRegistry rejects missing, expired, and wrong-tab approvals", () => {
  let now = 1000
  const registry = new ApprovalRegistry({ now: () => now })
  expect(registry.check(undefined, 4)).toBeUndefined()
  expect(registry.check({ decision: "allow-once", tabId: 4, expiresAt: 2000 }, 4)).toMatchObject({ decision: "allow-once" })
  expect(registry.check({ decision: "allow-once", tabId: 5, expiresAt: 2000 }, 4)).toBeUndefined()
  expect(registry.check({ decision: "allow-once", tabId: 4, expiresAt: 999 }, 4)).toBeUndefined()
  const granted = registry.grant("allow-tab", 4)
  expect(registry.check(granted, 4)).toMatchObject({ decision: "allow-tab" })
  now += 16 * 60_000
  expect(registry.check(granted, 4)).toBeUndefined()
})

function pendingID(events: string[], gate: ApprovalGate): string | undefined {
  void events
  return pendingIDFromGate(gate)
}

function pendingIDFromGate(gate: ApprovalGate): string | undefined {
  const ids = gate.pendingIDs?.()
  return ids?.at(0)
}