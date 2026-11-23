import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { UiHost } from "../../../src/bridge/ui"
import type { KiloBackend } from "../../../src/bridge/kilo"
import type { UiMessage } from "../../../src/bridge/ui-ws"
import type { WebviewMessage } from "@kilo-webview/src/types/messages"

/**
 * Mirrors `KiloClient`: each method reaches private helpers through `this`.
 * Copying a method into a local and calling it unbound leaves `this` undefined,
 * so the method throws and the host reports the request as failed.
 */
class ThisBoundBackend implements KiloBackend {
  url = "http://127.0.0.1:1"
  readonly calls: string[] = []

  async healthy() {
    return true
  }
  async createSession() {
    this.calls.push("createSession")
    return { id: "ses_1" }
  }
  async promptAsync() {
    this.calls.push("promptAsync")
  }
  async prompt() {
    this.calls.push("prompt")
    return { id: "msg_1" }
  }
  async abort() {
    this.calls.push("abort")
  }
  async getMessages() {
    this.calls.push("getMessages")
    return []
  }
  async forkSession(input: { sessionID: string; messageID?: string }) {
    this.calls.push("forkSession")
    return { id: "ses_2", parentID: input.sessionID, title: "fork" }
  }
  async authSet(input: { providerID: string }) {
    this.calls.push("authSet")
    return { providerID: input.providerID }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("condition timed out")
}

async function withHost(run: (host: UiHost, sent: UiMessage[], backend: ThisBoundBackend) => Promise<void>) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-binding-"))
  const backend = new ThisBoundBackend()
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: backend })
  host.bind((message) => sent.push(message))
  try {
    await run(host, sent, backend)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

test("forkSession invokes the backend method with its receiver bound", async () => {
  await withHost(async (host, sent, backend) => {
    const message: WebviewMessage = { type: "forkSession", sessionId: "ses_1" }
    host.handle(message)
    await waitFor(() => sent.some((item) => item.type === "sessionForked" || item.type === "error"))
    expect(backend.calls).toContain("forkSession")
    expect(sent.some((item) => item.type === "error")).toBe(false)
    expect(sent.some((item) => item.type === "sessionForked")).toBe(true)
  })
})

test("connectProvider invokes authSet with its receiver bound", async () => {
  await withHost(async (host, sent, backend) => {
    const message: WebviewMessage = { type: "connectProvider", requestId: "r1", providerID: "openai", apiKey: "sk-x" }
    host.handle(message)
    await waitFor(() => sent.some((item) => item.type === "providerConnected" || item.type === "providerActionError"))
    expect(backend.calls).toContain("authSet")
    expect(sent.some((item) => item.type === "providerActionError")).toBe(false)
    expect(sent.some((item) => item.type === "providerConnected")).toBe(true)
  })
})
