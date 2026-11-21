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

function asked(id = "per_1"): BridgeEvent {
  return {
    channel: "ui",
    type: "permission.asked",
    data: {
      id,
      sessionID: "ses_1",
      permission: "bash",
      patterns: ["git *"],
      metadata: { command: "git status" },
      always: ["git *"],
    },
  }
}

const activeStates = (sent: UiMessage[]) =>
  sent.filter((message) => message.type === "autoApproveState").map((message) => (message as { active: boolean }).active)

test("toggleAutoApprove flips the persisted state and broadcasts autoApproveState", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-autoapprove-"))
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: fakeKilo([]) })
  host.bind((message) => sent.push(message))
  try {
    host.handle({ type: "toggleAutoApprove" } as WebviewMessage)
    await waitFor(() => activeStates(sent).includes(true))

    host.handle({ type: "requestAutoApproveState" } as WebviewMessage)
    await waitFor(() => activeStates(sent).length >= 2)
    expect(activeStates(sent).at(-1)).toBe(true)

    host.handle({ type: "toggleAutoApprove" } as WebviewMessage)
    await waitFor(() => activeStates(sent).at(-1) === false)
    expect(activeStates(sent).at(-1)).toBe(false)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("permission.asked is auto-approved and never shown while auto-approve is active", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-autoapprove-"))
  const replies: ReplyCall[] = []
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: fakeKilo(replies) })
  host.bind((message) => sent.push(message))
  try {
    host.handle({ type: "toggleAutoApprove" } as WebviewMessage)
    await waitFor(() => activeStates(sent).includes(true))

    host.event(asked())

    await waitFor(() => replies.length === 1)
    expect(replies[0]).toEqual({ requestID: "per_1", reply: "once" })
    expect(sent.some((message) => message.type === "permissionRequest")).toBe(false)
    await waitFor(() => sent.some((message) => message.type === "permissionResolved"))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("permission.asked still prompts the user while auto-approve is off", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-autoapprove-"))
  const replies: ReplyCall[] = []
  const sent: UiMessage[] = []
  const host = new UiHost({ workspace, kilo: fakeKilo(replies) })
  host.bind((message) => sent.push(message))
  try {
    host.event(asked())
    await waitFor(() => sent.some((message) => message.type === "permissionRequest"))
    expect(replies).toHaveLength(0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("enabling auto-approve drains permissions already waiting", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-autoapprove-"))
  const replies: ReplyCall[] = []
  const sent: UiMessage[] = []
  const backend = fakeKilo(replies)
  backend.permissions = async () => ({ data: [{ id: "per_2" }, { id: "per_3" }] })
  const host = new UiHost({ workspace, kilo: backend })
  host.bind((message) => sent.push(message))
  try {
    host.handle({ type: "toggleAutoApprove" } as WebviewMessage)
    await waitFor(() => replies.length === 2)
    expect(replies.map((call) => call.requestID)).toEqual(["per_2", "per_3"])
    expect(replies.every((call) => call.reply === "once")).toBe(true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
