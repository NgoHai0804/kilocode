import { test, expect } from "bun:test"
import { CdpSession } from "../../extension/src/cdp/session"
import type { DebuggerApi, DebuggerSource, Json } from "../../extension/src/cdp/types"
import { RefRegistry } from "../../extension/src/refs/registry"
import { ConsoleBuffer, NetworkBuffer } from "../../extension/src/buffers/ring"
import { Router } from "../../extension/src/rpc/router"
import { registerTools } from "../../extension/src/tools"
import { ApprovalRegistry } from "../../extension/src/approval/registry"

class FakeEval implements DebuggerApi {
  attached = false
  readonly evaluations: Json[] = []
  readonly worlds: Json[] = []
  result: unknown = { type: "string", value: "Login" }
  exception = false

  async attach() {
    this.attached = true
  }

  async detach() {
    this.attached = false
  }

  async getTargets() {
    return [{ tabId: 42, attached: this.attached }]
  }

  async sendCommand(_target: { tabId: number }, method: string, params: Json = {}): Promise<unknown> {
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: "http://localhost:3000/" } } }
    if (method === "Page.getNavigationHistory") return { currentIndex: 0, entries: [{ url: "http://localhost:3000/", title: "Login" }] }
    if (method === "Page.createIsolatedWorld") {
      this.worlds.push(params)
      return { executionContextId: 7 }
    }
    if (method === "Runtime.evaluate") {
      this.evaluations.push(params)
      if (this.exception) return { exceptionDetails: { text: "ReferenceError: nope", exception: { description: "ReferenceError: nope" } } }
      return { result: this.result }
    }
    return {}
  }

  onEvent(_listener: (source: DebuggerSource, method: string, params: unknown) => void) {
    return () => undefined
  }

  onDetach() {
    return () => undefined
  }
}

function request(id: string, params: Json) {
  return { jsonrpc: "2.0", id, method: "browser.eval", params }
}

async function setup() {
  const fake = new FakeEval()
  const refs = new RefRegistry()
  const consoleBuffer = new ConsoleBuffer()
  const networkBuffer = new NetworkBuffer()
  const session = new CdpSession({ api: fake, refs, console: consoleBuffer, network: networkBuffer })
  const router = new Router()
  const approvals = new ApprovalRegistry()
  const events: { type: string; data: Json }[] = []
  registerTools(router, {
    session,
    refs,
    console: consoleBuffer,
    network: networkBuffer,
    allowlist: async () => ["http://localhost:3000"],
    paired: () => true,
    approval: approvals,
    onEvent: (event) => events.push(event),
  })
  await session.attach(42)
  return { fake, router, events }
}

function approval(tabId = 42) {
  return { decision: "allow-once", tabId, expiresAt: Date.now() + 10_000 }
}

test("eval runs in an isolated world after approval", async () => {
  const { fake, router, events } = await setup()
  const response = await router.handle(request("eval_1", { expression: "document.title", approval: approval() }))
  const result = response?.result as Json
  expect(result).toMatchObject({ value: "Login", type: "string", truncated: false })
  expect(fake.worlds[0]).toMatchObject({ frameId: "main", worldName: "kilo-eval" })
  expect(fake.evaluations[0]).toMatchObject({ contextId: 7, returnByValue: true })
  expect(events.map((event) => event.type)).toEqual(["eval.start", "eval.end"])
  expect(JSON.stringify(events)).not.toContain("document.title")
})

test("eval without approval is rejected before CDP evaluate", async () => {
  const { fake, router } = await setup()
  const response = (await router.handle(request("eval_2", { expression: "document.title" }))) as {
    error?: { data: { kind: string } }
  }
  expect(response.error?.data.kind).toBe("APPROVAL_TIMEOUT")
  expect(fake.evaluations).toHaveLength(0)
})

test("eval exceptions map to INVALID_PARAMS without running in the main world", async () => {
  const { fake, router } = await setup()
  fake.exception = true
  const response = (await router.handle(request("eval_3", { expression: "throw new Error('x')", approval: approval() }))) as {
    error?: { data: { kind: string } }
  }
  expect(response.error?.data.kind).toBe("INVALID_PARAMS")
  expect(fake.evaluations[0]?.contextId).toBe(7)
})

test("eval rejects objects that are not serializable", async () => {
  const { fake, router } = await setup()
  fake.result = { type: "function", objectId: "obj-1", description: "function () {}" }
  const response = (await router.handle(request("eval_5", { expression: "() => 1", approval: approval() }))) as {
    error?: { data: { kind: string } }
  }
  expect(response.error?.data.kind).toBe("INVALID_PARAMS")
})

test("eval caps results at 64 KB and marks them truncated", async () => {
  const { fake, router } = await setup()
  fake.result = { type: "string", value: "y".repeat(70_000) }
  const result = (await router.handle(request("eval_4", { expression: "big()", approval: approval() })))?.result as Json
  expect(result.truncated).toBe(true)
  expect(String(result.value).length).toBe(64 * 1024)
})