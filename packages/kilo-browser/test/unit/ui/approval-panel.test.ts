import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { UiHost } from "../../../src/bridge/ui"
import type { BridgeEvent, KiloBackend } from "../../../src/bridge/kilo"
import type { UiMessage } from "../../../src/bridge/ui-ws"
import type { WebviewMessage } from "@kilo-webview/src/types/messages"

type ReplyCall = { requestID: string; reply: string; message?: string; interactive?: boolean }

function fakeKilo(replies: ReplyCall[]) {
  const backend: KiloBackend = {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => ({ id: "ses_1" }),
    promptAsync: async () => undefined,
    prompt: async () => ({ id: "msg_1" }),
    abort: async () => undefined,
    getMessages: async () => [],
    reply: async (input) => {
      replies.push(input)
      return {}
    },
  }
  return backend
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("condition timed out")
}

function asked(): BridgeEvent {
  return {
    channel: "ui",
    type: "permission.asked",
    data: {
      id: "per_1",
      sessionID: "ses_1",
      permission: "bash",
      patterns: ["git *"],
      metadata: { command: "git status", rules: ["git *"] },
      always: ["git *"],
      tool: { messageID: "msg_1", callID: "call_1" },
    },
  }
}

test("maps permission.asked into the shared PermissionRequest shape", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-approval-"))
  const replies: ReplyCall[] = []
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: fakeKilo(replies) })
  host.bind((message) => sent.push(message))
  try {
    host.event(asked())
    const request = sent.find((message) => message.type === "permissionRequest")
    expect(request).toBeDefined()
    if (!request || request.type !== "permissionRequest") throw new Error("missing permission request")
    expect(request.permission.id).toBe("per_1")
    expect(request.permission.sessionID).toBe("ses_1")
    expect(request.permission.toolName).toBe("bash")
    expect(request.permission.patterns).toEqual(["git *"])
    expect(request.permission.always).toEqual(["git *"])
    expect(request.permission.args).toEqual({ command: "git status", rules: ["git *"] })
    expect(request.permission.tool).toEqual({ messageID: "msg_1", callID: "call_1" })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("a fake UI client reply reaches POST /permission/:requestID/reply and resolves", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-approval-"))
  const replies: ReplyCall[] = []
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: fakeKilo(replies) })
  host.bind((message) => sent.push(message))
  try {
    host.event(asked())

    const response: WebviewMessage = {
      type: "permissionResponse",
      permissionId: "per_1",
      sessionID: "ses_1",
      response: "once",
      approvedAlways: [],
      deniedAlways: [],
      feedback: "go",
    }
    host.handle(response)

    await waitFor(() => replies.length === 1)
    expect(replies[0]).toEqual({ requestID: "per_1", reply: "once", message: "go", interactive: true })

    const resolved = sent.find((message) => message.type === "permissionResolved")
    expect(resolved).toBeDefined()
    if (resolved && resolved.type === "permissionResolved") expect(resolved.permissionID).toBe("per_1")
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("permission.replied from the backend resolves the dock", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-approval-"))
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: fakeKilo([]) })
  host.bind((message) => sent.push(message))
  try {
    host.event({ channel: "ui", type: "permission.replied", data: { requestID: "per_9", sessionID: "ses_1", reply: "reject" } })
    const resolved = sent.find((message) => message.type === "permissionResolved")
    expect(resolved).toBeDefined()
    if (resolved && resolved.type === "permissionResolved") expect(resolved.permissionID).toBe("per_9")
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("a failed reply surfaces permissionError for the dock", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-approval-"))
  const sent: UiMessage[] = []
  const backend = fakeKilo([])
  backend.reply = async () => {
    throw new Error("backend down")
  }
  const host = new UiHost({ workspace, kilo: backend })
  host.bind((message) => sent.push(message))
  try {
    host.event(asked())
    const response: WebviewMessage = {
      type: "permissionResponse",
      permissionId: "per_1",
      sessionID: "ses_1",
      response: "reject",
      approvedAlways: [],
      deniedAlways: [],
    }
    host.handle(response)
    await waitFor(() => sent.some((message) => message.type === "permissionError"))
    const error = sent.find((message) => message.type === "permissionError")
    if (error && error.type === "permissionError") expect(error.permissionID).toBe("per_1")
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
test("saves always-rules before replying so per-rule approvals persist", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-approval-"))
  const order: string[] = []
  const sent: UiMessage[] = []
  const backend = fakeKilo([])
  backend.saveAlwaysRules = async (input) => {
    order.push(`save:${input.approvedAlways.join(",")}`)
    return {}
  }
  backend.reply = async (input) => {
    order.push(`reply:${input.reply}`)
    return {}
  }
  const host = new UiHost({ workspace, kilo: backend })
  host.bind((message) => sent.push(message))
  try {
    host.event(asked())
    const response: WebviewMessage = {
      type: "permissionResponse",
      permissionId: "per_1",
      sessionID: "ses_1",
      response: "once",
      approvedAlways: ["git *"],
      deniedAlways: [],
    }
    host.handle(response)
    await waitFor(() => order.length === 2)
    expect(order).toEqual(["save:git *", "reply:once"])
    expect(sent.some((message) => message.type === "permissionResolved")).toBe(true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})