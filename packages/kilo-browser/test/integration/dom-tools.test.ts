import { test, expect } from "bun:test"
import { CdpSession } from "../../extension/src/cdp/session"
import type { DebuggerApi, DebuggerSource, Json } from "../../extension/src/cdp/types"
import { RefRegistry } from "../../extension/src/refs/registry"
import { ConsoleBuffer, NetworkBuffer } from "../../extension/src/buffers/ring"
import { Router } from "../../extension/src/rpc/router"
import { registerTools } from "../../extension/src/tools"

class FakeDebugger implements DebuggerApi {
  attached = false
  tabId = 7
  url = "https://example.com/dashboard"
  title = "Example"
  calls: string[] = []

  async attach(target: { tabId: number }) {
    this.tabId = target.tabId
    this.attached = true
  }

  async detach() {
    this.attached = false
  }

  async getTargets() {
    return [{ tabId: this.tabId, attached: this.attached }]
  }

  async sendCommand(_target: { tabId: number }, method: string, params: Json = {}): Promise<unknown> {
    this.calls.push(method)
    if (method === "Runtime.evaluate") {
      if (params.expression === "document") return { result: { objectId: "doc" } }
      if (typeof params.expression === "string" && params.expression.includes("innerText")) {
        return { result: { value: "Hello world" } }
      }
      return { result: { value: "" } }
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: [{ tag: "a", role: "", name: "Usage", selector: "nav > a" }] } }
    }
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: this.url } } }
    if (method === "Page.getNavigationHistory") {
      return { currentIndex: 0, entries: [{ id: 1, url: this.url, title: this.title }] }
    }
    return {}
  }

  onEvent(_listener: (source: DebuggerSource, method: string, params: unknown) => void) {
    return () => {}
  }

  onDetach(_listener: (source: DebuggerSource, reason: string) => void) {
    return () => {}
  }
}

async function setup() {
  const fake = new FakeDebugger()
  const refs = new RefRegistry()
  const consoleBuffer = new ConsoleBuffer()
  const networkBuffer = new NetworkBuffer()
  const session = new CdpSession({ api: fake, refs, console: consoleBuffer, network: networkBuffer })
  const router = new Router()
  registerTools(router, {
    session,
    refs,
    console: consoleBuffer,
    network: networkBuffer,
    allowlist: async () => [],
    paired: () => true,
  })
  await session.attach(7)
  return { fake, router }
}

function resultOf(value: unknown): Json {
  expect(value).toBeDefined()
  const response = value as { result?: unknown; error?: { data: { kind: string } } }
  expect(response.error).toBeUndefined()
  return response.result as Json
}

test("find locates elements and returns reusable CSS selectors", async () => {
  const { fake, router } = await setup()
  const result = resultOf(
    await router.handle({ jsonrpc: "2.0", id: 1, method: "browser.find", params: { text: "Usage" } }),
  )
  expect(result.count).toBe(1)
  const matches = result.matches as Json[]
  expect(matches[0]).toMatchObject({ tag: "a", name: "Usage", selector: "nav > a" })
  expect(fake.calls).toContain("Runtime.callFunctionOn")
})

test("get_text without a target reads the whole page", async () => {
  const { router } = await setup()
  const result = resultOf(await router.handle({ jsonrpc: "2.0", id: 2, method: "browser.get_text", params: {} }))
  expect(result.text).toBe("Hello world")
  expect(result.truncated).toBe(false)
})
