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
      const fn = typeof params.functionDeclaration === "string" ? params.functionDeclaration : ""
      if (fn.includes("landmarks")) {
        return {
          result: {
            value: {
              landmarks: [{ role: "main", name: "Dashboard", heading: "Usage", selector: "main" }],
              headings: [{ level: 1, text: "Usage", selector: "h1" }],
              forms: [],
              tables: [],
              buttons: 2,
              links: 5,
              inputs: 1,
            },
          },
        }
      }
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

test("outline maps landmarks, headings, and counts into text", async () => {
  const { router } = await setup()
  const result = resultOf(await router.handle({ jsonrpc: "2.0", id: 3, method: "browser.outline", params: {} }))
  const landmarks = result.landmarks as Json[]
  expect(landmarks[0]).toMatchObject({ role: "main", selector: "main" })
  expect(result.buttons).toBe(2)
  expect(result.links).toBe(5)
  const text = String(result.text)
  expect(text).toContain("LANDMARKS")
  expect(text).toContain("HEADINGS")
  expect(text).toContain("h1 Usage")
  expect(text).toContain("COUNTS buttons=2 links=5 inputs=1")
})

test("batch runs an ordered sequence of steps in one call", async () => {
  const { router } = await setup()
  const result = resultOf(
    await router.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "browser.batch",
      params: { steps: [{ action: "get_text" }, { action: "outline" }] },
    }),
  )
  expect(result.completed).toBe(2)
  const steps = result.steps as Json[]
  expect(steps[0]).toMatchObject({ action: "get_text", ok: true })
  expect((steps[0].result as Json).text).toBe("Hello world")
  expect(steps[1]).toMatchObject({ action: "outline", ok: true })
})

test("batch stops at the first failure by default", async () => {
  const { router } = await setup()
  const result = resultOf(
    await router.handle({
      jsonrpc: "2.0",
      id: 5,
      method: "browser.batch",
      params: { steps: [{ action: "nope" }, { action: "get_text" }] },
    }),
  )
  expect(result.completed).toBe(0)
  const steps = result.steps as Json[]
  expect(steps).toHaveLength(1)
  expect(steps[0]).toMatchObject({ action: "nope", ok: false })
})
