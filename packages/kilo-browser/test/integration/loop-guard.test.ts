import { test, expect } from "bun:test"
import { DEFAULT_CONFIG } from "../../src/config/schema"
import { executeTool, type HttpBridge, type ToolCall } from "../../src/bridge/http"
import { RpcFailure } from "../../src/protocol/rpc"
import { LoopGuard } from "../../src/bridge/loop"

function failingBridge(guard: LoopGuard) {
  let calls = 0
  const bridge = {
    config: DEFAULT_CONFIG,
    workspace: process.cwd(),
    hub: {
      request: async () => {
        calls += 1
        throw new RpcFailure("STALE_REF", { reason: "element moved" })
      },
    },
    logEvent: () => undefined,
    touch: () => undefined,
    loop: guard,
  } as unknown as HttpBridge
  return { bridge, calls: () => calls }
}

async function failureOf(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    return err
  }
}

test("a repeated identical failure stops with LOOP_STOP before a 4th attempt", async () => {
  const guard = new LoopGuard({ maxRepeats: 3 })
  const { bridge, calls } = failingBridge(guard)
  const call: ToolCall = { method: "browser.click", params: { ref: "e119" }, sessionID: "ses_1" }

  const first = await failureOf(() => executeTool(bridge, call))
  const second = await failureOf(() => executeTool(bridge, call))
  const third = await failureOf(() => executeTool(bridge, call))
  expect((first as RpcFailure).kind).toBe("STALE_REF")
  expect((second as RpcFailure).kind).toBe("STALE_REF")
  expect((third as RpcFailure).kind).toBe("STALE_REF")
  expect(calls()).toBe(3)

  const fourth = await failureOf(() => executeTool(bridge, call))
  expect((fourth as RpcFailure).kind).toBe("LOOP_STOP")
  expect(calls()).toBe(3)
})

test("a different target is not blocked by another signature's failures", async () => {
  const guard = new LoopGuard({ maxRepeats: 2 })
  const { bridge, calls } = failingBridge(guard)
  await failureOf(() => executeTool(bridge, { method: "browser.click", params: { ref: "e1" }, sessionID: "s" }))
  await failureOf(() => executeTool(bridge, { method: "browser.click", params: { ref: "e1" }, sessionID: "s" }))
  const other = await failureOf(() =>
    executeTool(bridge, { method: "browser.click", params: { ref: "e2" }, sessionID: "s" }),
  )
  expect((other as RpcFailure).kind).toBe("STALE_REF")
  expect(calls()).toBe(3)
})

test("a success clears the run so a later failure is not blocked", async () => {
  const guard = new LoopGuard({ maxRepeats: 2 })
  let calls = 0
  let ok = false
  const bridge = {
    config: DEFAULT_CONFIG,
    workspace: process.cwd(),
    hub: {
      request: async () => {
        calls += 1
        if (ok) return { ok: true }
        throw new RpcFailure("STALE_REF", { reason: "moved" })
      },
    },
    logEvent: () => undefined,
    touch: () => undefined,
    loop: guard,
  } as unknown as HttpBridge
  const call: ToolCall = { method: "browser.click", params: { ref: "e1" }, sessionID: "s" }

  await failureOf(() => executeTool(bridge, call))
  ok = true
  await executeTool(bridge, call)
  ok = false
  const after = await failureOf(() => executeTool(bridge, call))
  expect((after as RpcFailure).kind).toBe("STALE_REF")
  expect(calls).toBe(3)
})

test("a transient failure does not count toward a loop stop", async () => {
  const guard = new LoopGuard({ maxRepeats: 2 })
  let transient = true
  const bridge = {
    config: DEFAULT_CONFIG,
    workspace: process.cwd(),
    hub: {
      request: async () => {
        if (transient) throw new RpcFailure("NOT_PAIRED", { reason: "extension disconnected" })
        throw new RpcFailure("STALE_REF", { reason: "moved" })
      },
    },
    logEvent: () => undefined,
    touch: () => undefined,
    loop: guard,
  } as unknown as HttpBridge
  const call: ToolCall = { method: "browser.click", params: { ref: "e1" }, sessionID: "s" }

  for (let i = 0; i < 4; i += 1) {
    const failure = await failureOf(() => executeTool(bridge, call))
    expect((failure as RpcFailure).kind).toBe("NOT_PAIRED")
  }
  transient = false
  const next = await failureOf(() => executeTool(bridge, call))
  expect((next as RpcFailure).kind).toBe("STALE_REF")
})

test("a batch step with a denied policy is rejected before any dispatch", async () => {
  const guard = new LoopGuard()
  let calls = 0
  const config = { ...DEFAULT_CONFIG, tools: { ...DEFAULT_CONFIG.tools, click: "deny" as const } }
  const bridge = {
    config,
    workspace: process.cwd(),
    hub: {
      request: async () => {
        calls += 1
        return { completed: 1, total: 1 }
      },
    },
    logEvent: () => undefined,
    touch: () => undefined,
    loop: guard,
  } as unknown as HttpBridge

  const failure = await failureOf(() =>
    executeTool(bridge, { method: "browser.batch", params: { steps: [{ action: "click", ref: "e1" }] }, sessionID: "s" }),
  )
  expect((failure as RpcFailure).kind).toBe("POLICY_DENIED")
  expect(calls).toBe(0)
})

test("a batch that reports failed steps counts against the loop guard", async () => {
  const guard = new LoopGuard({ maxRepeats: 2 })
  const bridge = {
    config: DEFAULT_CONFIG,
    workspace: process.cwd(),
    hub: { request: async () => ({ completed: 0, total: 1, steps: [{ action: "get_text", ok: false }] }) },
    logEvent: () => undefined,
    touch: () => undefined,
    loop: guard,
  } as unknown as HttpBridge
  const call: ToolCall = { method: "browser.batch", params: { steps: [{ action: "get_text" }] }, sessionID: "s" }

  await executeTool(bridge, call)
  await executeTool(bridge, call)
  const third = await failureOf(() => executeTool(bridge, call))
  expect((third as RpcFailure).kind).toBe("LOOP_STOP")
})

