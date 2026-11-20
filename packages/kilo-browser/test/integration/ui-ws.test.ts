import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../src/config/schema"
import { BridgeServer } from "../../src/bridge/server"
import type { BridgeEvent, KiloBackend } from "../../src/bridge/kilo"

type Message = Record<string, unknown>
type Envelope = { kind?: string; id?: string; message?: Message }

function fakeKilo() {
  const calls = {
    createSession: 0,
    promptAsync: [] as Record<string, unknown>[],
    reply: [] as Record<string, unknown>[],
    questionReply: [] as Record<string, unknown>[],
    questionReject: [] as Record<string, unknown>[],
    forkSession: [] as Record<string, unknown>[],
    revertSession: [] as Record<string, unknown>[],
    unrevertSession: [] as Record<string, unknown>[],
    deleteMessage: [] as Record<string, unknown>[],
    authSet: [] as Record<string, unknown>[],
    authRemove: [] as Record<string, unknown>[],
    oauthAuthorize: [] as Record<string, unknown>[],
    oauthCallback: [] as Record<string, unknown>[],
    globalConfig: [] as Record<string, unknown>[],
    disposeGlobal: 0,
  }
  let emit: ((event: BridgeEvent) => void) | undefined
  const backend = {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => {
      calls.createSession += 1
      const now = Date.now()
      return { id: `ses_${calls.createSession}`, title: "New session", time: { created: now, updated: now } }
    },
    promptAsync: async (input: unknown) => {
      calls.promptAsync.push(input as Record<string, unknown>)
    },
    prompt: async () => ({ id: "msg_test" }),
    abort: async () => undefined,
    getMessages: async () => [],
    listSessions: async () => [],
    forkSession: async (input: unknown) => {
      calls.forkSession.push(input as Record<string, unknown>)
      const now = Date.now()
      return { id: "ses_fork", title: "Forked", time: { created: now, updated: now } }
    },
    revertSession: async (input: unknown) => {
      calls.revertSession.push(input as Record<string, unknown>)
      return true
    },
    unrevertSession: async (input: unknown) => {
      calls.unrevertSession.push(input as Record<string, unknown>)
      return true
    },
    deleteMessage: async (input: unknown) => {
      calls.deleteMessage.push(input as Record<string, unknown>)
      return true
    },
    reply: async (input: unknown) => {
      calls.reply.push(input as Record<string, unknown>)
      return {}
    },
    questionReply: async (input: unknown) => {
      calls.questionReply.push(input as Record<string, unknown>)
      return {}
    },
    questionReject: async (input: unknown) => {
      calls.questionReject.push(input as Record<string, unknown>)
      return {}
    },
    providers: async () => ({ all: [], connected: [], default: {}, failures: [] }),
    providerAuth: async () => ({}),
    authSet: async (input: unknown) => {
      calls.authSet.push(input as Record<string, unknown>)
    },
    authRemove: async (input: unknown) => {
      calls.authRemove.push(input as Record<string, unknown>)
    },
    oauthAuthorize: async (input: unknown) => {
      calls.oauthAuthorize.push(input as Record<string, unknown>)
      return { url: "https://example.com/oauth", method: "code", instructions: "Enter the code" }
    },
    oauthCallback: async (input: unknown) => {
      calls.oauthCallback.push(input as Record<string, unknown>)
      return true
    },
    disposeGlobal: async () => {
      calls.disposeGlobal += 1
      return true
    },
    globalConfigGet: async () => ({ disabled_providers: [] }),
    globalConfigUpdate: async (config: unknown) => {
      calls.globalConfig.push(config as Record<string, unknown>)
      return {}
    },
    startEvents: (handler: (event: BridgeEvent) => void) => {
      emit = handler
      return () => {
        emit = undefined
      }
    },
  }
  return {
    backend: backend as unknown as KiloBackend,
    calls,
    dump(event: BridgeEvent) {
      emit?.(event)
    },
  }
}

function inbox(socket: WebSocket) {
  const messages: Message[] = []
  const waiters: { match: (message: Message) => boolean; resolve: (message: Message) => void }[] = []
  socket.addEventListener("message", (event) => {
    const envelope = JSON.parse(String(event.data)) as Envelope
    if (envelope.kind !== "ui" || !envelope.message) return
    const message = envelope.message
    let matched = false
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!
      if (waiter.match(message)) {
        waiters.splice(index, 1)
        matched = true
        waiter.resolve(message)
      }
    }
    if (matched) return
    messages.push(message)
  })
  return {
    messages,
    next(match: (message: Message) => boolean, timeoutMs = 3000) {
      const existing = messages.find(match)
      if (existing) {
        messages.splice(messages.indexOf(existing), 1)
        return Promise.resolve(existing)
      }
      const deferred = Promise.withResolvers<Message>()
      const timer = setTimeout(() => {
        const index = waiters.findIndex((item) => item.resolve === deferred.resolve)
        if (index >= 0) waiters.splice(index, 1)
        deferred.reject(new Error("ui websocket message timeout"))
      }, timeoutMs)
      waiters.push({
        match,
        resolve: (message) => {
          clearTimeout(timer)
          deferred.resolve(message)
        },
      })
      return deferred.promise
    },
  }
}

type SocketCtor = new (url: string, options: Bun.WebSocketOptions) => WebSocket

function connectUi(url: string, token: string) {
  const Ctor = WebSocket as unknown as SocketCtor
  const target = `${url}?role=ui`
  return new Ctor(target, {
    protocols: ["kilo-browser.v1", `token.${token}`],
    headers: { Origin: "chrome-extension://kilotest" },
  })
}

function open(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error("socket failed to open")), { once: true })
    socket.addEventListener("close", () => reject(new Error("socket closed before open")), { once: true })
  })
}

async function makeBridge(options: { workspace: string; home: string; token: string }) {
  const config = parse(
    merge(DEFAULT_CONFIG, {
      browser: { allowedExtensionIds: ["kilotest"], defaultTimeoutMs: 300 },
      logging: { level: "error" },
      bridge: { heartbeatMs: 60_000, pongTimeoutMs: 120_000 },
    }),
  )
  const fake = fakeKilo()
  const bridge = new BridgeServer({
    workspace: options.workspace,
    config,
    kilo: fake.backend,
    home: options.home,
    token: options.token,
  })
  return { bridge, fake }
}

test(
  "verifies token, allows multiple UI surfaces, and reports ready capabilities",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge } = await makeBridge({ workspace, home, token: "a".repeat(64) })
    let first: WebSocket | undefined
    let second: WebSocket | undefined
    let rejected: WebSocket | undefined
    try {
      await bridge.start()

      const Ctor = WebSocket as unknown as SocketCtor
      const noToken = new Ctor(`${bridge.wsUrl}?role=ui`, {
        protocols: ["kilo-browser.v1"],
        headers: { Origin: "chrome-extension://kilotest" },
      })
      const noTokenCode = await new Promise<number>((resolve) => {
        noToken.addEventListener("close", (event) => resolve(event.code))
        noToken.addEventListener("error", () => resolve(-1))
        setTimeout(() => resolve(-2), 2000)
      })
      expect(noTokenCode).not.toBe(1000)
      noToken.close()

      rejected = connectUi(bridge.wsUrl, "b".repeat(64))
      const rejectedCode = await new Promise<number>((resolve) => {
        rejected!.addEventListener("close", (event) => resolve(event.code))
        rejected!.addEventListener("error", () => resolve(-1))
        setTimeout(() => resolve(-2), 2000)
      })
      expect(rejectedCode).not.toBe(1000)

      first = connectUi(bridge.wsUrl, bridge.token())
      const firstInbox = inbox(first)
      await open(first)
      first.send(JSON.stringify({ kind: "ui", id: "1", message: { type: "webviewReady" } }))
      const ready = await firstInbox.next((message) => message.type === "ready")
      const capabilities = ready.capabilities as Record<string, boolean>
      expect(capabilities.chat).toBe(true)
      expect(capabilities.agentManager).toBe(false)
      expect(capabilities.cloud).toBe(false)
      expect(capabilities["settings.indexing"]).toBe(false)
      expect(capabilities["file.open"]).toBe(true)
      await firstInbox.next((message) => message.type === "connectionState")

      second = connectUi(bridge.wsUrl, bridge.token())
      const secondInbox = inbox(second)
      await open(second)
      second.send(JSON.stringify({ kind: "ui", id: "2", message: { type: "webviewReady" } }))
      const secondReady = await secondInbox.next((message) => message.type === "ready")
      expect(secondReady.capabilities).toBeDefined()

      // Host pushes fan out to every connected surface.
      first.send(JSON.stringify({ kind: "ui", id: "3", message: { type: "requestProviders" } }))
      await firstInbox.next((message) => message.type === "providersLoaded")
      await secondInbox.next((message) => message.type === "providersLoaded")
    } finally {
      first?.close()
      second?.close()
      rejected?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "creates a session, forwards sendMessage to promptAsync, and streams part deltas",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge, fake } = await makeBridge({ workspace, home, token: "c".repeat(64) })
    let socket: WebSocket | undefined
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      socket.send(JSON.stringify({ kind: "ui", id: "2", message: { type: "createSession" } }))
      const created = await box.next((message) => message.type === "sessionCreated")
      const session = created.session as Record<string, unknown>
      expect(session.id).toBe("ses_1")

      const messageID = "msg_1"
      socket.send(
        JSON.stringify({
          kind: "ui",
          id: "3",
          message: { type: "sendMessage", text: "hello", sessionID: "ses_1", messageID, providerID: "kilo", modelID: "auto" },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(fake.calls.promptAsync.length).toBe(1)
      const prompt = fake.calls.promptAsync[0]!
      expect(prompt.sessionID).toBe("ses_1")
      expect(prompt.messageID).toBe(messageID)
      const parts = prompt.parts as Record<string, unknown>[]
      expect(parts.some((part) => part.type === "text" && part.text === "hello")).toBe(true)
      expect(prompt.model).toEqual({ providerID: "kilo", modelID: "auto" })

      fake.dump({
        channel: "ui",
        type: "message.part.delta",
        data: { sessionID: "ses_1", messageID, partID: "prt_1", field: "text", delta: "hello" },
      })
      const update = await box.next((message) => message.type === "partUpdated")
      expect(update.sessionID).toBe("ses_1")
      expect(update.messageID).toBe(messageID)
      const delta = update.delta as Record<string, unknown>
      expect(delta.type).toBe("text-delta")
      expect(delta.textDelta).toBe("hello")

      fake.dump({ channel: "ui", type: "session.status", data: { sessionID: "ses_1", status: { type: "busy" } } })
      const status = await box.next((message) => message.type === "sessionStatus")
      expect(status.status).toBe("busy")
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "permissionResponse posts the UI decision to the backend reply route",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge, fake } = await makeBridge({ workspace, home, token: "d".repeat(64) })
    let socket: WebSocket | undefined
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      socket.send(
        JSON.stringify({
          kind: "ui",
          id: "4",
          message: {
            type: "permissionResponse",
            permissionId: "per_1",
            sessionID: "ses_1",
            response: "once",
            feedback: "looks good",
          },
        }),
      )
      const resolved = await box.next((message) => message.type === "permissionResolved")
      expect(resolved.permissionID).toBe("per_1")
      expect(fake.calls.reply.length).toBe(1)
      expect(fake.calls.reply[0]).toEqual({ requestID: "per_1", reply: "once", message: "looks good", interactive: true })

      socket.send(
        JSON.stringify({
          kind: "ui",
          id: "5",
          message: { type: "questionReply", requestID: "q_1", answers: [["yes"]] },
        }),
      )
      await box.next((message) => message.type === "questionResolved")
      expect(fake.calls.questionReply[0]).toEqual({ requestID: "q_1", answers: [["yes"]] })
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "wires provider connect, oauth, disconnect, and custom provider flows to the backend",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge, fake } = await makeBridge({ workspace, home, token: "g".repeat(64) })
    const models = Bun.serve({ port: 0, fetch: () => Response.json({ data: [{ id: "m1", name: "M1" }] }) })
    let socket: WebSocket | undefined
    const send = (id: string, message: Record<string, unknown>) =>
      socket!.send(JSON.stringify({ kind: "ui", id, message }))
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      send("p1", { type: "connectProvider", requestId: "r1", providerID: "openai", apiKey: "sk-test" })
      const connected = await box.next((message) => message.type === "providerConnected")
      expect(connected.requestId).toBe("r1")
      expect(connected.providerID).toBe("openai")
      expect(fake.calls.authSet[0]).toEqual({ providerID: "openai", auth: { type: "api", key: "sk-test" } })
      expect(fake.calls.disposeGlobal).toBe(1)
      await box.next((message) => message.type === "providersLoaded")

      send("p2", { type: "authorizeProviderOAuth", requestId: "r2", providerID: "openai", method: 1 })
      const ready = await box.next((message) => message.type === "providerOAuthReady")
      expect(ready.requestId).toBe("r2")
      expect((ready.authorization as Record<string, unknown>).url).toBe("https://example.com/oauth")

      send("p3", { type: "completeProviderOAuth", requestId: "r3", providerID: "openai", method: 1, code: "abc" })
      const completed = await box.next((message) => message.type === "providerConnected" && message.requestId === "r3")
      expect(completed.providerID).toBe("openai")
      expect(fake.calls.oauthCallback[0]).toEqual({ providerID: "openai", method: 1, code: "abc" })

      send("p4", { type: "disconnectProvider", requestId: "r4", providerID: "openai" })
      const disconnected = await box.next((message) => message.type === "providerDisconnected")
      expect(disconnected.requestId).toBe("r4")
      expect(fake.calls.authRemove[0]).toEqual({ providerID: "openai" })

      send("p5", {
        type: "saveCustomProvider",
        requestId: "r5",
        providerID: "my-custom",
        config: {
          npm: "@ai-sdk/openai-compatible",
          name: "My",
          options: { baseURL: "https://x" },
          models: { m1: { name: "M1" } },
        },
        apiKey: "k",
        apiKeyChanged: true,
      })
      await box.next((message) => message.type === "providerConnected" && message.requestId === "r5")
      expect(fake.calls.globalConfig[0]).toEqual({
        provider: {
          "my-custom": {
            npm: "@ai-sdk/openai-compatible",
            name: "My",
            options: { baseURL: "https://x" },
            models: { m1: { name: "M1" } },
          },
        },
        disabled_providers: [],
      })

      send("p6", { type: "fetchCustomProviderModels", requestId: "r6", baseURL: `http://127.0.0.1:${models.port}`, apiKey: "k" })
      const fetched = await box.next((message) => message.type === "customProviderModelsFetched")
      expect(fetched.requestId).toBe("r6")
      expect(fetched.models).toEqual([{ id: "m1", name: "M1" }])
    } finally {
      socket?.close()
      models.stop(true)
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "forks a session through the backend and notifies the webview",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge, fake } = await makeBridge({ workspace, home, token: "i".repeat(64) })
    let socket: WebSocket | undefined
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      socket.send(
        JSON.stringify({ kind: "ui", id: "fk", message: { type: "forkSession", sessionId: "ses_1", messageId: "msg_1" } }),
      )
      const forked = await box.next((message) => message.type === "sessionForked")
      expect(forked.sessionID).toBe("ses_fork")
      expect(forked.forkedFromID).toBe("ses_1")
      expect(fake.calls.forkSession[0]).toEqual({ sessionID: "ses_1", messageID: "msg_1" })
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "handles language, telemetry, and settings reset host messages",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    await mkdir(path.join(workspace, ".kilo"), { recursive: true })
    await Bun.write(path.join(workspace, ".kilo", "kilo.json"), JSON.stringify({ model: "kilo/auto" }, null, 2))
    const { bridge } = await makeBridge({ workspace, home, token: "h".repeat(64) })
    let socket: WebSocket | undefined
    const send = (id: string, message: Record<string, unknown>) =>
      socket!.send(JSON.stringify({ kind: "ui", id, message }))
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      send("s1", { type: "setLanguage", locale: "de" })
      const changed = await box.next((message) => message.type === "languageChanged")
      expect(changed.locale).toBe("de")

      send("s2", { type: "setTelemetryLevel", enabled: false })
      const telemetry = await box.next((message) => message.type === "telemetryLevelResult")
      expect(telemetry).toEqual({ type: "telemetryLevelResult", ok: true, enabled: false })
      await box.next((message) => message.type === "configUpdated")
      const globalFile = JSON.parse(await Bun.file(path.join(home, ".config", "kilo", "kilo.json")).text()) as Record<string, unknown>
      expect((globalFile.experimental as Record<string, unknown>).openTelemetry).toBe(false)

      send("s3", { type: "resetReadNotifications" })
      const notifications = await box.next((message) => message.type === "notificationsLoaded")
      expect(notifications.dismissedIds).toEqual([])

      send("s4", { type: "resetAllSettings" })
      const reset = await box.next((message) => message.type === "configUpdated")
      const expectedGlobal = { experimental: { openTelemetry: false } }
      expect(reset.globalConfig).toEqual(expectedGlobal)
      expect(reset.config).toEqual(expectedGlobal)
      const preserved = JSON.parse(await Bun.file(path.join(home, ".config", "kilo", "kilo.json")).text()) as Record<string, unknown>
      expect(preserved).toEqual(expectedGlobal)
      const projectFile = JSON.parse(await Bun.file(path.join(workspace, ".kilo", "kilo.json")).text()) as Record<string, unknown>
      expect(projectFile).toEqual({})
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "requestConfig merges global and project files and updateConfig preserves unrelated keys",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    await mkdir(path.join(workspace, ".kilo"), { recursive: true })
    await mkdir(path.join(home, ".config", "kilo"), { recursive: true })
    await Bun.write(
      path.join(workspace, ".kilo", "kilo.json"),
      JSON.stringify({ $schema: "https://app.kilo.ai/config.json", permission: { bash: "allow" }, model: "kilo/auto" }, null, 2),
    )
    await Bun.write(path.join(home, ".config", "kilo", "kilo.json"), JSON.stringify({ theme: "dark" }, null, 2))

    const { bridge } = await makeBridge({ workspace, home, token: "e".repeat(64) })
    let socket: WebSocket | undefined
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      socket.send(JSON.stringify({ kind: "ui", id: "6", message: { type: "requestConfig" } }))
      const loaded = await box.next((message) => message.type === "configLoaded")
      const config = loaded.config as Record<string, unknown>
      expect(config.theme).toBe("dark")
      expect((config.permission as Record<string, unknown>).bash).toBe("allow")
      expect(config.model).toBe("kilo/auto")

      socket.send(
        JSON.stringify({
          kind: "ui",
          id: "7",
          message: { type: "updateConfig", config: { permission: { bash: "deny" } }, projectConfig: { model: "kilo/new" } },
        }),
      )
      const updated = await box.next((message) => message.type === "configUpdated")
      const effective = updated.config as Record<string, unknown>
      expect((effective.permission as Record<string, unknown>).bash).toBe("allow")
      expect(effective.model).toBe("kilo/new")
      expect(effective.theme).toBe("dark")

      const globalFile = JSON.parse(await Bun.file(path.join(home, ".config", "kilo", "kilo.json")).text()) as Record<string, unknown>
      expect(globalFile.theme).toBe("dark")
      expect((globalFile.permission as Record<string, unknown>).bash).toBe("deny")

      const projectFile = JSON.parse(await Bun.file(path.join(workspace, ".kilo", "kilo.json")).text()) as Record<string, unknown>
      expect(projectFile.model).toBe("kilo/new")
      expect(projectFile.$schema).toBe("https://app.kilo.ai/config.json")
      expect((projectFile.permission as Record<string, unknown>).bash).toBe("allow")

      socket.send(
        JSON.stringify({
          kind: "ui",
          id: "8",
          message: { type: "updateConfig", config: {}, globalUnset: [["theme"]] },
        }),
      )
      await box.next((message) => message.type === "configUpdated")
      const afterUnset = JSON.parse(await Bun.file(path.join(home, ".config", "kilo", "kilo.json")).text()) as Record<string, unknown>
      expect(afterUnset.theme).toBeUndefined()
      expect((afterUnset.permission as Record<string, unknown>).bash).toBe("deny")
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "wires session edit actions and silently drops intentionally-absent messages",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge, fake } = await makeBridge({ workspace, home, token: "j".repeat(64) })
    let socket: WebSocket | undefined
    const send = (id: string, message: Record<string, unknown>) =>
      socket!.send(JSON.stringify({ kind: "ui", id, message }))
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      // Intentionally-absent message: logs only, never a HOST_UNSUPPORTED error.
      send("x1", { type: "telemetry" })

      send("x2", { type: "revertSession", sessionID: "ses_1", messageID: "msg_1" })
      send("x3", { type: "unrevertSession", sessionID: "ses_1" })
      send("x4", { type: "deleteMessage", sessionID: "ses_1", messageID: "msg_2", requestID: "req_1" })
      const deleted = await box.next((message) => message.type === "deleteMessageResult")
      expect(deleted.success).toBe(true)
      expect(deleted.requestID).toBe("req_1")
      expect(fake.calls.deleteMessage[0]).toEqual({ sessionID: "ses_1", messageID: "msg_2", queued: true })

      send("x5", { type: "requestFilePicker", requestId: "pick_1" })
      const picker = await box.next((message) => message.type === "filePickerResult")
      expect(picker).toEqual({ type: "filePickerResult", path: "", requestId: "pick_1" })

      for (let i = 0; i < 100 && (fake.calls.revertSession.length < 1 || fake.calls.unrevertSession.length < 1); i += 1) {
        await Bun.sleep(10)
      }
      expect(fake.calls.revertSession[0]?.sessionID).toBe("ses_1")
      expect(fake.calls.revertSession[0]?.messageID).toBe("msg_1")
      expect(fake.calls.unrevertSession[0]?.sessionID).toBe("ses_1")
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "answers HOST_UNSUPPORTED without crashing and validates files through the jail",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const inside = path.join(workspace, "note.txt")
    await Bun.write(inside, "hello")
    const { bridge } = await makeBridge({ workspace, home, token: "f".repeat(64) })
    let socket: WebSocket | undefined
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      socket.send(JSON.stringify({ kind: "ui", id: "9", message: { type: "totallyUnknownMessage" } }))
      const unsupported = await box.next((message) => message.type === "error")
      expect(unsupported.code).toBe("HOST_UNSUPPORTED")

      socket.send(JSON.stringify({ kind: "ui", id: "10", message: { type: "openFile", filePath: inside } }))
      const openError = await box.next((message) => message.type === "error" && String(message.message).includes("openFile"))
      expect(openError.code).toBe("HOST_UNSUPPORTED")

      socket.send(
        JSON.stringify({
          kind: "ui",
          id: "11",
          message: { type: "validateFiles", id: "vf-1", sessionID: "ses_1", paths: [inside, path.join(home, "missing.txt")] },
        }),
      )
      const result = await box.next((message) => message.type === "validateFilesResult")
      expect(result.id).toBe("vf-1")
      expect(result.existing).toEqual([inside])

      socket.send(JSON.stringify({ kind: "ui", id: "12", message: { type: "webviewReady" } }))
      const again = await box.next((message) => message.type === "ready")
      expect((again.capabilities as Record<string, boolean>).chat).toBe(true)
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "rejects a custom provider config with a disallowed npm package",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge, fake } = await makeBridge({ workspace, home, token: "k".repeat(64) })
    let socket: WebSocket | undefined
    const send = (id: string, message: Record<string, unknown>) =>
      socket!.send(JSON.stringify({ kind: "ui", id, message }))
    try {
      await bridge.start()
      socket = connectUi(bridge.wsUrl, bridge.token())
      const box = inbox(socket)
      await open(socket)
      await box.next((message) => message.type === "ready")

      send("d1", {
        type: "saveCustomProvider",
        requestId: "r-bad",
        providerID: "evil",
        config: {
          npm: "evil-pkg",
          name: "Evil",
          options: { baseURL: "https://x" },
          models: { m1: { name: "M1" } },
        },
      })
      const error = await box.next((message) => message.type === "providerActionError")
      expect(error.requestId).toBe("r-bad")
      expect(error.providerID).toBe("evil")
      expect(fake.calls.globalConfig.length).toBe(0)
    } finally {
      socket?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)

test(
  "rate limits one UI surface without closing another",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-ui-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-home-"))
    const { bridge } = await makeBridge({ workspace, home, token: "l".repeat(64) })
    let noisy: WebSocket | undefined
    let quiet: WebSocket | undefined
    try {
      await bridge.start()

      noisy = connectUi(bridge.wsUrl, bridge.token())
      const noisyBox = inbox(noisy)
      await open(noisy)
      await noisyBox.next((message) => message.type === "ready")

      quiet = connectUi(bridge.wsUrl, bridge.token())
      const quietBox = inbox(quiet)
      await open(quiet)
      quiet.send(JSON.stringify({ kind: "ui", id: "quiet", message: { type: "webviewReady" } }))
      await quietBox.next((message) => message.type === "ready")

      for (let index = 0; index < 200; index += 1) {
        noisy.send(JSON.stringify({ kind: "ui", id: `flood-${index}`, message: { type: "webviewReady" } }))
      }
      const noisyClose = new Promise<number>((resolve) => {
        noisy!.addEventListener("close", (event) => resolve(event.code))
        setTimeout(() => resolve(-2), 3000)
      })
      expect(await noisyClose).toBe(4008)

      // The quiet surface keeps its own budget, so it is neither limited nor closed.
      expect(quiet.readyState).toBe(WebSocket.OPEN)
      quiet.send(JSON.stringify({ kind: "ui", id: "after-flood", message: { type: "webviewReady" } }))
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(quiet.readyState).toBe(WebSocket.OPEN)
    } finally {
      noisy?.close()
      quiet?.close()
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)
