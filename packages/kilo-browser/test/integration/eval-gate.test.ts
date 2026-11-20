import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, type BrowserConfig } from "../../src/config/schema"
import { ApprovalGate } from "../../src/bridge/approval"
import { executeTool, type HttpBridge, type ToolCall } from "../../src/bridge/http"
import { RpcFailure } from "../../src/protocol/rpc"

function config(policy: "ask" | "deny"): BrowserConfig {
  return { ...DEFAULT_CONFIG, tools: { ...DEFAULT_CONFIG.tools, eval: policy } }
}

function fakeBridge(policy: "ask" | "deny", result: unknown, workspace: string) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const events: { type: string; data: Record<string, unknown> }[] = []
  const gate = new ApprovalGate({
    timeoutMs: 100,
    onEvent: (event) => {
      events.push({ type: event.type, data: event.data })
    },
  })
  const bridge = {
    config: config(policy),
    workspace,
    hub: {
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params })
        return result
      },
    },
    approvals: gate,
    tab: () => ({ id: 9, url: "http://localhost:3000/" }),
    logEvent: (event: { event: string; data?: Record<string, unknown> }) => {
      events.push({ type: event.event, data: event.data ?? {} })
    },
    touch: () => undefined,
  } as unknown as HttpBridge
  return { bridge, gate, calls, events }
}

const call: ToolCall = { method: "browser.eval", params: { expression: "document.title" }, sessionID: "ses_test" }

test("eval policy deny rejects before forwarding", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-eval-deny-"))
  try {
    const { bridge, calls } = fakeBridge("deny", { value: "Login" }, workspace)
    let failure: unknown
    try {
      await executeTool(bridge, call)
    } catch (err) {
      failure = err
    }
    expect(failure).toBeInstanceOf(RpcFailure)
    expect((failure as RpcFailure).kind).toBe("POLICY_DENIED")
    expect(calls).toHaveLength(0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("eval ask forwards only after an allow-once approval", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-eval-ask-"))
  try {
    const { bridge, gate, calls, events } = fakeBridge("ask", { value: "Login", type: "string", truncated: false }, workspace)
    const pending = executeTool(bridge, call)
    const requestID = gate.pendingIDs()[0]
    expect(requestID).toBeDefined()
    expect(gate.reply(requestID!, "allow-once", 9)).toBe(true)
    const result = (await pending) as Record<string, unknown>
    expect(result.value).toBe("Login")
    expect(calls).toHaveLength(1)
    const approval = calls[0]?.params.approval as Record<string, unknown>
    expect(approval.decision).toBe("allow-once")
    expect(events.some((event) => event.type === "permission.asked")).toBe(true)
    expect(events.some((event) => event.type === "permission.replied")).toBe(true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("eval ask times out without a decision and never forwards", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-eval-timeout-"))
  try {
    const { bridge, calls } = fakeBridge("ask", { value: "Login" }, workspace)
    let failure: unknown
    try {
      await executeTool(bridge, call)
    } catch (err) {
      failure = err
    }
    expect(failure).toBeInstanceOf(RpcFailure)
    expect((failure as RpcFailure).kind).toBe("APPROVAL_TIMEOUT")
    expect(calls).toHaveLength(0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("a truncated eval result is persisted with only an expression hash", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-eval-artifact-"))
  try {
    const { bridge, gate } = fakeBridge("ask", { value: "x".repeat(70_000), type: "string", truncated: true }, workspace)
    const pending = executeTool(bridge, { ...call, params: { expression: "document.title" } })
    const requestID = gate.pendingIDs()[0]!
    gate.reply(requestID, "allow-once", 9)
    const result = (await pending) as Record<string, unknown>
    expect(result.truncated).toBe(true)
    expect(result.artifactId).toBeString()
    const file = path.join(workspace, String(result.artifactPath))
    const text = await Bun.file(file).text()
    expect(text).toContain("expressionHash")
    expect(text).not.toContain("document.title")
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})