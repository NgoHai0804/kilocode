import { test, expect } from "bun:test"
import { CdpSession } from "../../extension/src/cdp/session"
import type { DebuggerApi, DebuggerSource, Json } from "../../extension/src/cdp/types"
import { RefRegistry } from "../../extension/src/refs/registry"
import { ConsoleBuffer, NetworkBuffer } from "../../extension/src/buffers/ring"
import { Router } from "../../extension/src/rpc/router"
import { registerTools } from "../../extension/src/tools"
import { ApprovalRegistry } from "../../extension/src/approval/registry"
import { RpcFailure } from "../../src/protocol/rpc"

type EventListener = (source: DebuggerSource, method: string, params: unknown) => void

class FakeCdp implements DebuggerApi {
  attached = false
  tabId = 42
  url = "http://localhost:3000/"
  title = "Login"
  readonly inputEvents: { method: string; params: Json }[] = []
  readonly disabled = new Set<number>()
  readonly readOnly = new Set<number>()
  private readonly events = new Set<EventListener>()

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
    if (method.startsWith("Input.")) {
      this.inputEvents.push({ method, params })
      return {}
    }
    if (method === "Page.createIsolatedWorld") return { executionContextId: 7 }
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: this.url } } }
    if (method === "Page.getNavigationHistory") return { currentIndex: 0, entries: [{ url: this.url, title: this.title }] }
    if (method === "Page.reload") {
      this.emit("Page.frameNavigated", { frame: { id: "main", url: this.url } })
      this.emit("Page.loadEventFired", {})
      return {}
    }
    if (method === "DOM.getDocument") return { root: documentTree() }
    if (method === "DOM.querySelector") {
      const selector = typeof params.selector === "string" ? params.selector : ""
      return { nodeId: selector === "button" ? 7 : selector === "input" ? 5 : 0 }
    }
    if (method === "DOM.resolveNode") {
      const backend = typeof params.backendNodeId === "number" ? params.backendNodeId : 0
      return { object: { objectId: `obj-${backend}` } }
    }
    if (method === "DOM.getBoxModel") {
      return { model: { content: { quad: [100, 100, 220, 100, 220, 130, 100, 130] } } }
    }
    if (method === "DOM.scrollIntoViewIfNeeded") return {}
    if (method === "Accessibility.getFullAXTree") return { nodes: axTree() }
    if (method === "Runtime.callFunctionOn") {
      const objectId = typeof params.objectId === "string" ? params.objectId : ""
      const backend = Number(objectId.replace("obj-", ""))
      const fn = typeof params.functionDeclaration === "string" ? params.functionDeclaration : ""
      if (fn.includes("document.activeElement === this")) return { result: { type: "boolean", value: true } }
      if (fn.includes("if (typeof this.select")) return { result: { type: "boolean", value: true } }
      return {
        result: {
          type: "object",
          value: {
            tag: backend === 7 ? "button" : "input",
            disabled: this.disabled.has(backend),
            readOnly: this.readOnly.has(backend),
            visible: true,
            hit: true,
            x: 160,
            y: 115,
            width: 120,
            height: 30,
            dpr: 1,
          },
        },
      }
    }
    if (method === "Runtime.evaluate") {
      return { result: { type: "string", value: "Login page" } }
    }
    return {}
  }

  onEvent(listener: EventListener) {
    this.events.add(listener)
    return () => {
      this.events.delete(listener)
    }
  }

  onDetach() {
    return () => undefined
  }

  emit(method: string, params: unknown) {
    for (const listener of this.events) listener({ tabId: this.tabId }, method, params)
  }
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
    { nodeId: "3", parentId: "1", role: { value: "textbox" }, name: { value: "Email" }, backendDOMNodeId: 5 },
    { nodeId: "4", parentId: "1", role: { value: "textbox" }, name: { value: "Password" }, backendDOMNodeId: 6 },
    { nodeId: "5", parentId: "1", role: { value: "button" }, name: { value: "Save" }, backendDOMNodeId: 7 },
  ]
}

function request(id: string | number, method: string, params: Json = {}) {
  return { jsonrpc: "2.0", id, method, params }
}

function resultOf(value: unknown): Json {
  const response = value as { result?: unknown; error?: { data: { kind: string } } }
  if (response.error) throw new RpcFailure(response.error.data.kind as "INVALID_PARAMS", {})
  return response.result as Json
}

async function setup() {
  const fake = new FakeCdp()
  const refs = new RefRegistry()
  const session = new CdpSession({ api: fake, refs, console: new ConsoleBuffer(), network: new NetworkBuffer() })
  const router = new Router()
  registerTools(router, {
    session,
    refs,
    console: new ConsoleBuffer(),
    network: new NetworkBuffer(),
    allowlist: async () => ["http://localhost:3000"],
    paired: () => true,
    approval: new ApprovalRegistry(),
    onEvent: () => undefined,
  })
  await session.attach(42)
  return { fake, refs, router }
}

function refFor(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  if (!match?.[1]) throw new Error("ref not found")
  return match[1]
}

test("click/type/press/wait_for/reload work through the router with a fake CDP", async () => {
  const { fake, router } = await setup()
  const snapshot = resultOf(await router.handle(request(1, "browser.snapshot", {})))
  const text = String(snapshot.text)
  const buttonRef = refFor(text, /button "Save" \[ref=(e\d+)\]/)
  const emailRef = refFor(text, /textbox "Email" \[ref=(e\d+)\]/)

  const clicked = resultOf(await router.handle(request(2, "browser.click", { ref: buttonRef })))
  expect(clicked).toMatchObject({ clicked: true, ref: buttonRef })
  expect(fake.inputEvents.filter((event) => event.method === "Input.dispatchMouseEvent")).toHaveLength(3)

  const typed = resultOf(
    await router.handle(request(3, "browser.type", { ref: emailRef, text: "hello", clear: true, submit: true })),
  )
  expect(typed).toMatchObject({ typed: 5, submitted: true })
  expect(fake.inputEvents.filter((event) => event.method === "Input.dispatchKeyEvent" && event.params.type === "char")).toHaveLength(5)

  const pressed = resultOf(await router.handle(request(4, "browser.press", { ref: buttonRef, key: "Enter" })))
  expect(pressed).toMatchObject({ pressed: "Enter" })

  const waited = resultOf(
    await router.handle(
      request(5, "browser.wait_for", {
        text: "Login page",
        selector: "button",
        urlIncludes: "localhost",
        timeoutMs: 500,
      }),
    ),
  )
  expect(waited.matched).toBe(true)

  const reloaded = resultOf(await router.handle(request(6, "browser.reload", { waitUntil: "load" })))
  expect(reloaded).toMatchObject({ status: 200, url: "http://localhost:3000/" })
})

test("a stale ref is rejected before any input event", async () => {
  const { fake, router } = await setup()
  const first = resultOf(await router.handle(request(1, "browser.snapshot", {})))
  const ref = refFor(String(first.text), /button "Save" \[ref=(e\d+)\]/)
  resultOf(await router.handle(request(2, "browser.snapshot", {})))
  const before = fake.inputEvents.length
  const response = (await router.handle(request(3, "browser.click", { ref }))) as {
    error?: { data: { kind: string } }
  }
  expect(response.error?.data.kind).toBe("STALE_REF")
  expect(fake.inputEvents.length).toBe(before)
})

test("disabled and readonly elements are rejected", async () => {
  const { fake, router } = await setup()
  const snapshot = resultOf(await router.handle(request(1, "browser.snapshot", {})))
  const text = String(snapshot.text)
  const passwordRef = refFor(text, /textbox "Password" \[ref=(e\d+)\]/)
  const buttonRef = refFor(text, /button "Save" \[ref=(e\d+)\]/)

  fake.disabled.add(7)
  const disabled = (await router.handle(request(2, "browser.click", { ref: buttonRef }))) as {
    error?: { data: { kind: string } }
  }
  expect(disabled.error?.data.kind).toBe("NO_TARGET")
  expect(fake.inputEvents).toHaveLength(0)

  fake.readOnly.add(6)
  const readonly = (await router.handle(request(3, "browser.type", { ref: passwordRef, text: "x" }))) as {
    error?: { data: { kind: string } }
  }
  expect(readonly.error?.data.kind).toBe("NO_TARGET")
})