export type KiloAuth = {
  username: string
  password: string
}

export type CreateSessionInput = {
  title?: string
  parentID?: string
}

export type PromptInput = {
  sessionID: string
  messageID?: string
  parts: unknown[]
  model?: unknown
  agent?: string
  variant?: string
  editorContext?: unknown
}

export type AlwaysRulesInput = {
  requestID: string
  approvedAlways: string[]
  deniedAlways: string[]
}

export type AuthProviderInput = {
  providerID: string
  auth: unknown
}

export type OAuthInput = {
  providerID: string
  method: number
  inputs?: Record<string, string>
  code?: string
  directory?: string
}

export type BridgeEvent = {
  channel: "ui" | "tool"
  type: string
  data: unknown
  directory?: string
  id?: string
}

export type KiloBackend = {
  url: string
  healthy: () => Promise<boolean>
  createSession: (input: CreateSessionInput) => Promise<unknown>
  promptAsync: (input: PromptInput) => Promise<void>
  prompt: (input: PromptInput) => Promise<unknown>
  abort: (input: { sessionID: string; scope: "session" | "tree" }) => Promise<void>
  getMessages: (sessionID: string) => Promise<unknown>
  listSessions?: () => Promise<unknown>
  renameSession?: (input: { sessionID: string; title: string }) => Promise<unknown>
  deleteSession?: (input: { sessionID: string }) => Promise<unknown>
  forkSession?: (input: { sessionID: string; messageID?: string; directory?: string }) => Promise<unknown>
  revertSession?: (input: { sessionID: string; messageID: string; partID?: string }) => Promise<unknown>
  unrevertSession?: (input: { sessionID: string }) => Promise<unknown>
  deleteMessage?: (input: { sessionID: string; messageID: string; queued?: boolean }) => Promise<unknown>
  sessionModelUsage?: (sessionID: string) => Promise<unknown>
  providers?: () => Promise<unknown>
  providerAuth?: () => Promise<unknown>
  questionReply?: (input: { requestID: string; answers: string[][] }) => Promise<unknown>
  questionReject?: (input: { requestID: string }) => Promise<unknown>
  status?: () => Promise<unknown>
  permissions?: (directory: string) => Promise<unknown>
  reply?: (input: { requestID: string; reply: string; message?: string; interactive?: boolean }) => Promise<unknown>
  saveAlwaysRules?: (input: AlwaysRulesInput) => Promise<unknown>
  authSet?: (input: AuthProviderInput) => Promise<unknown>
  authRemove?: (input: { providerID: string }) => Promise<unknown>
  oauthAuthorize?: (input: OAuthInput) => Promise<unknown>
  oauthCallback?: (input: OAuthInput) => Promise<unknown>
  disposeGlobal?: () => Promise<unknown>
  globalConfigGet?: () => Promise<unknown>
  globalConfigUpdate?: (config: unknown) => Promise<unknown>
  startEvents?: (onEvent: (event: BridgeEvent) => void) => () => void
  stop?: () => Promise<void>
}

export class KiloHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`kilo request failed: ${status} ${path}`)
    this.name = "KiloHttpError"
  }
}

export class KiloClient implements KiloBackend {
  private endpoint: string
  private readonly auth: string
  private controller?: AbortController
  private eventHandler?: (event: BridgeEvent) => void
  private stopCurrent?: () => void

  constructor(url: string, auth: KiloAuth) {
    this.endpoint = url.replace(/\/+$/, "")
    this.auth = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`
  }

  get url() {
    return this.endpoint
  }

  setEndpoint(url: string) {
    const next = url.replace(/\/+$/, "")
    if (next === this.endpoint) return
    this.endpoint = next
    if (this.eventHandler) this.beginEvents()
  }

  async healthy() {
    return this.ok("/global/health", 3000)
  }

  async createSession(input: CreateSessionInput) {
    return this.request("/session", {
      method: "POST",
      body: JSON.stringify({ title: input.title, parentID: input.parentID }),
    })
  }

  async promptAsync(input: PromptInput) {
    await this.request(`/session/${encodeURIComponent(input.sessionID)}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        messageID: input.messageID,
        parts: input.parts,
        model: input.model,
        agent: input.agent,
        variant: input.variant,
        editorContext: input.editorContext,
      }),
    })
  }

  async prompt(input: PromptInput) {
    return this.request(`/session/${encodeURIComponent(input.sessionID)}/message`, {
      method: "POST",
      body: JSON.stringify({ parts: input.parts, model: input.model, agent: input.agent }),
    })
  }

  async abort(input: { sessionID: string; scope: "session" | "tree" }) {
    const query = new URLSearchParams({ scope: input.scope })
    await this.request(`/session/${encodeURIComponent(input.sessionID)}/abort?${query}`, { method: "POST" })
  }

  async getMessages(sessionID: string) {
    return this.request(`/session/${encodeURIComponent(sessionID)}/message`)
  }

  async listSessions() {
    return this.request("/session")
  }

  async renameSession(input: { sessionID: string; title: string }) {
    return this.request(`/session/${encodeURIComponent(input.sessionID)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: input.title }),
    })
  }

  async deleteSession(input: { sessionID: string }) {
    return this.request(`/session/${encodeURIComponent(input.sessionID)}`, { method: "DELETE" })
  }

  async forkSession(input: { sessionID: string; messageID?: string; directory?: string }) {
    return this.request(`/session/${encodeURIComponent(input.sessionID)}/fork${directoryQuery(input.directory)}`, {
      method: "POST",
      body: JSON.stringify({ messageID: input.messageID }),
    })
  }

  async revertSession(input: { sessionID: string; messageID: string; partID?: string }) {
    return this.request(`/session/${encodeURIComponent(input.sessionID)}/revert`, {
      method: "POST",
      body: JSON.stringify({ messageID: input.messageID, partID: input.partID }),
    })
  }

  async unrevertSession(input: { sessionID: string }) {
    return this.request(`/session/${encodeURIComponent(input.sessionID)}/unrevert`, { method: "POST" })
  }

  async deleteMessage(input: { sessionID: string; messageID: string; queued?: boolean }) {
    const query = input.queued ? "?queued=true" : ""
    return this.request(
      `/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}${query}`,
      { method: "DELETE" },
    )
  }

  async sessionModelUsage(sessionID: string) {
    return this.request(`/session/${encodeURIComponent(sessionID)}/model-usage`)
  }

  async providers() {
    return this.request("/provider")
  }

  async providerAuth() {
    return this.request("/provider/auth")
  }

  async questionReply(input: { requestID: string; answers: string[][] }) {
    return this.request(`/question/${encodeURIComponent(input.requestID)}/reply`, {
      method: "POST",
      body: JSON.stringify({ answers: input.answers }),
    })
  }

  async questionReject(input: { requestID: string }) {
    return this.request(`/question/${encodeURIComponent(input.requestID)}/reject`, {
      method: "POST",
    })
  }

  async status() {
    return this.request("/session/status")
  }

  async permissions(directory: string) {
    const query = new URLSearchParams({ directory })
    return this.request(`/permission?${query}`)
  }

  async reply(input: { requestID: string; reply: string; message?: string; interactive?: boolean }) {
    return this.request(`/permission/${encodeURIComponent(input.requestID)}/reply`, {
      method: "POST",
      body: JSON.stringify({ reply: input.reply, message: input.message, interactive: input.interactive }),
    })
  }

  async saveAlwaysRules(input: AlwaysRulesInput) {
    return this.request(`/permission/${encodeURIComponent(input.requestID)}/always-rules`, {
      method: "POST",
      body: JSON.stringify({ approvedAlways: input.approvedAlways, deniedAlways: input.deniedAlways }),
    })
  }

  async authSet(input: AuthProviderInput) {
    await this.request(`/auth/${encodeURIComponent(input.providerID)}`, {
      method: "PUT",
      body: JSON.stringify(input.auth),
    })
  }

  async authRemove(input: { providerID: string }) {
    await this.request(`/auth/${encodeURIComponent(input.providerID)}`, { method: "DELETE" })
  }

  async oauthAuthorize(input: OAuthInput) {
    return this.request(`/provider/${encodeURIComponent(input.providerID)}/oauth/authorize${directoryQuery(input.directory)}`, {
      method: "POST",
      body: JSON.stringify({ method: input.method, inputs: input.inputs }),
    })
  }

  async oauthCallback(input: OAuthInput) {
    return this.request(`/provider/${encodeURIComponent(input.providerID)}/oauth/callback${directoryQuery(input.directory)}`, {
      method: "POST",
      body: JSON.stringify({ method: input.method, code: input.code }),
    })
  }

  async disposeGlobal() {
    return this.request(`/global/dispose`, { method: "POST" })
  }

  async globalConfigGet() {
    return this.request(`/global/config`)
  }

  async globalConfigUpdate(config: unknown) {
    return this.request(`/global/config`, { method: "PATCH", body: JSON.stringify(config) })
  }

  startEvents(onEvent: (event: BridgeEvent) => void) {
    this.eventHandler = onEvent
    this.beginEvents()
    return () => this.stopCurrent?.()
  }

  private beginEvents() {
    this.stopCurrent?.()
    const onEvent = this.eventHandler
    if (!onEvent) return
    this.controller = new AbortController()
    const signal = this.controller.signal
    let stopped = false
    let attempt = 0
    const ring: BridgeEvent[] = []
    const turns = new Map<string, ReturnType<typeof setTimeout>>()
    let lastNumericID: number | undefined

    const emit = (event: BridgeEvent) => {
      ring.push(event)
      if (ring.length > 100) ring.shift()
      if (event.id !== undefined) {
        const numeric = Number(event.id)
        if (Number.isInteger(numeric)) {
          if (lastNumericID !== undefined && numeric > lastNumericID + 1) {
            onEvent({ channel: "ui", type: "sse.gap", data: { lastId: lastNumericID, id: event.id } })
          }
          lastNumericID = numeric
        }
      }
      onEvent(event)
    }

    const handle = (payload: Record<string, unknown>, directory?: string) => {
      const type = typeof payload.type === "string" ? payload.type : undefined
      if (!type) return
      const data = payload.properties ?? {}
      const id = typeof payload.id === "string" ? payload.id : undefined

      if (type === "session.turn.close") {
        const sessionID = sessionOf(data)
        if (sessionID) {
          const timer = turns.get(sessionID)
          if (timer) clearTimeout(timer)
          turns.delete(sessionID)
        }
        emit({ channel: "ui", type, data, directory, id })
        return
      }

      if (type === "session.status") {
        emit({ channel: "ui", type, data, directory, id })
        const sessionID = sessionOf(data)
        if (sessionID && statusOf(data) === "idle" && !turns.has(sessionID)) {
          const timer = setTimeout(() => {
            turns.delete(sessionID)
            emit({
              channel: "ui",
              type: "session.turn.close",
              data: { sessionID, reason: "fallback" },
              directory,
            })
          }, 2000)
          turns.set(sessionID, timer)
        }
        return
      }

      const channel = uiTypes.has(type) ? "ui" : type.startsWith("tool.") ? "tool" : undefined
      if (!channel) return
      if (channel === "tool" && type.includes("delta")) return
      emit({ channel, type, data, directory, id })
    }

    const consume = async (response: Response) => {
      if (!response.body) throw new Error("event stream has no body")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf("\n\n")
        while (index >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          handleBlock(block, handle)
          index = buffer.indexOf("\n\n")
        }
      }
    }

    const loop = async () => {
      while (!stopped) {
        try {
          const response = await fetch(`${this.url}/global/event`, {
            headers: { Authorization: this.auth, Accept: "text/event-stream" },
            signal,
          })
          if (!response.ok) throw new KiloHttpError(response.status, "/global/event", await response.text())
          attempt = 0
          await consume(response)
        } catch (err) {
          if (stopped || signal.aborted) break
          attempt += 1
          if (attempt > 10) {
            onEvent({
              channel: "ui",
              type: "kilo.sse.down",
              data: { attempt, reason: err instanceof Error ? err.message : "sse disconnected" },
            })
            break
          }
          const base = Math.min(8000, 250 * 2 ** (attempt - 1))
          const jitter = base * (0.8 + Math.random() * 0.4)
          onEvent({ channel: "ui", type: "sse.reconnect", data: { attempt, delayMs: Math.round(jitter) } })
          await sleep(jitter, signal)
        }
      }
    }

    loop().catch((err: unknown) => {
      onEvent({
        channel: "ui",
        type: "kilo.sse.down",
        data: { reason: err instanceof Error ? err.message : "sse loop failed" },
      })
    })

    this.stopCurrent = () => {
      stopped = true
      this.controller?.abort()
      for (const timer of turns.values()) clearTimeout(timer)
      turns.clear()
    }
  }

  async stop() {
    this.stopCurrent?.()
  }

  private async ok(pathname: string, timeoutMs: number) {
    try {
      const response = await this.fetch(pathname, { method: "GET" }, timeoutMs)
      return response.ok
    } catch {
      return false
    }
  }

  private async request(pathname: string, init: RequestInit = {}, timeoutMs = 20000) {
    const response = await this.fetch(pathname, init, timeoutMs)
    if (!response.ok) throw new KiloHttpError(response.status, pathname, await response.text())
    if (response.status === 204) return undefined
    const text = await response.text()
    if (text.length === 0) return undefined
    return JSON.parse(text) as unknown
  }

  private fetch(pathname: string, init: RequestInit, timeoutMs: number) {
    return fetch(`${this.url}${pathname}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: this.auth,
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
}

const uiTypes = new Set([
  "permission.asked",
  "permission.replied",
  "session.turn.close",
  "session.status",
  "session.idle",
  "session.diff",
  "session.error",
  "session.created",
  "session.updated",
  "session.deleted",
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.removed",
  "message.part.delta",
  "todo.updated",
  "question.asked",
  "question.replied",
  "question.rejected",
])

function handleBlock(block: string, handle: (payload: Record<string, unknown>, directory?: string) => void) {
  const lines = block.split("\n")
  const data: string[] = []
  for (const line of lines) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return
  try {
    const parsed = JSON.parse(data.join("\n")) as unknown
    if (!isRecord(parsed)) return
    const payload = isRecord(parsed.payload) ? parsed.payload : parsed
    const directory = typeof parsed.directory === "string" ? parsed.directory : undefined
    handle(payload, directory)
  } catch {
    return
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function directoryQuery(directory?: string) {
  return directory ? `?${new URLSearchParams({ directory })}` : ""
}

export { fetchOpenAIModels, FetchModelsError } from "@kilo-shared/fetch-models"

function sessionOf(data: unknown) {
  if (!isRecord(data)) return undefined
  return typeof data.sessionID === "string" ? data.sessionID : undefined
}

function statusOf(data: unknown) {
  if (!isRecord(data)) return undefined
  if (typeof data.status === "string") return data.status
  if (isRecord(data.status) && typeof data.status.type === "string") return data.status.type
  return undefined
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    const abort = () => {
      clearTimeout(timer)
      done()
    }
    function done() {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}

