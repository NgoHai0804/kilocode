import { test, expect } from "bun:test"
import { CdpSession } from "../../extension/src/cdp/session"
import type { DebuggerApi, DebuggerSource, Json } from "../../extension/src/cdp/types"
import { RefRegistry } from "../../extension/src/refs/registry"
import { ConsoleBuffer, NetworkBuffer } from "../../extension/src/buffers/ring"
import { Router } from "../../extension/src/rpc/router"
import { registerTools } from "../../extension/src/tools"
import { RpcFailure } from "../../src/protocol/rpc"

type EventListener = (source: DebuggerSource, method: string, params: unknown) => void
type DetachListener = (source: DebuggerSource, reason: string) => void

class FakeDebugger implements DebuggerApi {
  attached = false
  tabId = 42
  url = "about:blank"
  title = "Login"
  navigateCalls = 0
  private readonly eventListeners = new Set<EventListener>()
  private readonly detachListeners = new Set<DetachListener>()
  private readonly attachError?: string

  constructor(attachError?: string) {
    this.attachError = attachError
  }

  async attach(target: { tabId: number }) {
    if (this.attachError) throw new Error(this.attachError)
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
    if (method === "Page.navigate") {
      this.navigateCalls += 1
      this.url = typeof params.url === "string" ? params.url : this.url
      this.title = "Login"
      this.emit("Page.frameNavigated", { frame: { id: "main", url: this.url } })
      this.emit("Page.loadEventFired", {})
      return { frameId: "main" }
    }
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "main", url: this.url } } }
    }
    if (method === "Page.getNavigationHistory") {
      return { currentIndex: 0, entries: [{ url: this.url, title: this.title }] }
    }
    if (method === "Page.captureScreenshot") return { data: pngBase64(1280, 720) }
    if (method === "DOM.getDocument") return { root: documentTree() }
    if (method === "Accessibility.getFullAXTree") return { nodes: axTree() }
    if (method === "Network.getResponseBody") {
      return { body: JSON.stringify({ error: "internal error", token: "abc123", authorization: "Bearer secretsecret" }) }
    }
    return {}
  }

  onEvent(listener: EventListener) {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  onDetach(listener: DetachListener) {
    this.detachListeners.add(listener)
    return () => {
      this.detachListeners.delete(listener)
    }
  }

  emit(method: string, params: unknown) {
    for (const listener of this.eventListeners) listener({ tabId: this.tabId }, method, params)
  }

  emitDetach(reason: string) {
    for (const listener of this.detachListeners) listener({ tabId: this.tabId }, reason)
  }
}

function request(id: string | number, method: string, params: Json = {}) {
  return { jsonrpc: "2.0", id, method, params }
}

function resultOf(value: unknown): Json {
  expect(value).toBeDefined()
  const response = value as { result?: unknown; error?: { data: { kind: string } } }
  expect(response.error).toBeUndefined()
  return response.result as Json
}

function documentTree(): Json {
  return {
    nodeId: 1,
    backendNodeId: 1,
    nodeName: "#document",
    children: [
      {
        nodeId: 2,
        backendNodeId: 2,
        nodeName: "HTML",
        localName: "html",
        children: [
          {
            nodeId: 3,
            backendNodeId: 3,
            nodeName: "BODY",
            localName: "body",
            children: [
              {
                nodeId: 4,
                backendNodeId: 4,
                nodeName: "FORM",
                localName: "form",
                children: [
                  { nodeId: 5, backendNodeId: 5, nodeName: "INPUT", localName: "input" },
                  { nodeId: 6, backendNodeId: 6, nodeName: "INPUT", localName: "input" },
                  { nodeId: 7, backendNodeId: 7, nodeName: "BUTTON", localName: "button" },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

function axTree(): Json[] {
  return [
    { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Login" }, backendDOMNodeId: 1 },
    { nodeId: "2", parentId: "1", role: { value: "form" }, name: { value: "login" }, backendDOMNodeId: 4 },
    { nodeId: "3", parentId: "1", role: { value: "heading" }, name: { value: "Sign in" }, backendDOMNodeId: 10 },
    { nodeId: "4", parentId: "1", role: { value: "textbox" }, name: { value: "Email" }, backendDOMNodeId: 5 },
    { nodeId: "5", parentId: "1", role: { value: "textbox" }, name: { value: "Password" }, backendDOMNodeId: 6 },
    { nodeId: "6", parentId: "1", role: { value: "button" }, name: { value: "Save" }, backendDOMNodeId: 7 },
  ]
}

function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes[24] = 8
  bytes[25] = 6
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
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
    allowlist: async () => ["http://localhost:3000"],
    paired: () => true,
  })
  await session.attach(42)
  return { fake, refs, consoleBuffer, networkBuffer, session, router }
}

test("observe tools cover navigate, snapshot, screenshot, console, and network", async () => {
  const { fake, refs, router } = await setup()

  const status = resultOf(await router.handle(request(1, "browser.status")))
  expect(status.paired).toBe(true)
  expect((status.tab as Json).id).toBe(42)

  const navigate = resultOf(
    await router.handle(
      request(2, "browser.navigate", { url: "http://localhost:3000/login", waitUntil: "load", timeoutMs: 2000 }),
    ),
  )
  expect(navigate).toMatchObject({ status: 200, title: "Login", url: "http://localhost:3000/login" })
  expect(fake.navigateCalls).toBe(1)

  const snapshot = resultOf(await router.handle(request(3, "browser.snapshot", {})))
  expect(snapshot.snapshotId).toMatch(/^[0-9a-f]{8}$/)
  expect(snapshot.refs).toBeGreaterThanOrEqual(3)
  expect(String(snapshot.text)).toContain('button "Save"')
  expect(String(snapshot.text)).not.toContain("<button")

  const screenshot = resultOf(await router.handle(request(4, "browser.screenshot", {})))
  expect(screenshot.width).toBe(1280)
  expect(screenshot.height).toBe(720)
  expect(screenshot.bytes).toBe(33)
  const png = Buffer.from(String(screenshot.data), "base64")
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  expect(() => refs.resolve("e1")).not.toThrow()

  fake.emit("Runtime.consoleAPICalled", {
    type: "error",
    args: [{ type: "string", value: "Uncaught TypeError: x is undefined" }],
    timestamp: 5,
  })
  const consoleResult = resultOf(await router.handle(request(5, "browser.console", { level: "error" })))
  const entries = consoleResult.entries as Json[]
  expect(entries).toHaveLength(1)
  expect(entries[0]?.seq).toBeNumber()
  expect(String(entries[0]?.text)).toContain("x is undefined")
  expect(consoleResult.dropped).toBeNumber()

  fake.emit("Network.requestWillBeSent", {
    requestId: "r1",
    request: { url: "http://localhost:3000/api/save", method: "POST" },
    type: "XHR",
    timestamp: 1,
  })
  fake.emit("Network.responseReceived", {
    requestId: "r1",
    response: {
      status: 500,
      statusText: "Internal Server Error",
      mimeType: "application/json",
      headers: { "content-type": "application/json", "set-cookie": "sid=secret" },
    },
    timestamp: 1.01,
  })
  fake.emit("Network.loadingFinished", { requestId: "r1", timestamp: 1.04, encodedDataLength: 100 })
  await Bun.sleep(10)

  const networkResult = resultOf(
    await router.handle(request(6, "browser.network", { filter: "/api/save", includeBodies: true })),
  )
  const requests = networkResult.requests as Json[]
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ method: "POST", status: 500, durationMs: 40 })
  expect(String(requests[0]?.body)).toContain("[REDACTED]")
  expect(String(requests[0]?.body)).not.toContain("abc123")
  expect((requests[0]?.headers as Json)["set-cookie"]).toBe("[REDACTED]")
  expect(networkResult.bodyDropped).toBeNumber()
})

test("attach maps another debugger to DEVTOOLS_CONFLICT", async () => {
  const fake = new FakeDebugger("Another debugger is already attached")
  const session = new CdpSession({ api: fake })
  let failure: unknown
  try {
    await session.attach(42)
  } catch (err) {
    failure = err
  }
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("DEVTOOLS_CONFLICT")
})

test("a new snapshot makes old refs stale", async () => {
  const { refs, router } = await setup()
  await router.handle(request(1, "browser.navigate", { url: "http://localhost:3000/login", timeoutMs: 2000 }))
  resultOf(await router.handle(request(2, "browser.snapshot", {})))
  expect(() => refs.resolve("e1")).not.toThrow()

  resultOf(await router.handle(request(3, "browser.snapshot", {})))
  let failure: unknown
  try {
    refs.resolve("e1")
  } catch (err) {
    failure = err
  }
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("STALE_REF")
})

test("navigate rejects origins outside the allowlist without calling CDP", async () => {
  const { fake, router } = await setup()
  const response = (await router.handle(
    request(1, "browser.navigate", { url: "https://evil.example/login" }),
  )) as { error?: { data: { kind: string } } }
  expect(response.error?.data.kind).toBe("POLICY_DENIED")
  expect(fake.navigateCalls).toBe(0)
})

test("detach clears the tab and the next call returns NO_TARGET", async () => {
  const { fake, router } = await setup()
  fake.emitDetach("canceled_by_user")
  const response = (await router.handle(request(1, "browser.status"))) as Json
  expect(response.result).toMatchObject({ cdp: false, tab: null })
  const snapshot = (await router.handle(request(2, "browser.snapshot", {}))) as {
    error?: { data: { kind: string } }
  }
  expect(snapshot.error?.data.kind).toBe("NO_TARGET")
})