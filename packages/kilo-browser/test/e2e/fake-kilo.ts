import type { BridgeEvent, CreateSessionInput, KiloBackend, PromptInput } from "../../src/bridge/kilo"

/**
 * Deterministic stand-in for a running `kilo serve`.
 *
 * The E2E specs drive real browser/extension UI, so the backend must be a real
 * KiloBackend implementation (no per-call mocks). It records calls and lets the
 * test push bridge events (`emit`) to simulate streamed model output.
 */

export type FakeKilo = {
  backend: KiloBackend
  calls: {
    createSession: number
    promptAsync: PromptInput[]
    prompt: PromptInput[]
    reply: { requestID: string; reply: string; message?: string; interactive?: boolean }[]
    questionReply: { requestID: string; answers: string[][] }[]
    questionReject: { requestID: string }[]
    abort: { sessionID: string; scope: "session" | "tree" }[]
    deleted: string[]
    renamed: { sessionID: string; title: string }[]
  }
  sessions: { id: string; title: string }[]
  emit: (event: BridgeEvent) => void
  reset: () => void
}

export function createFakeKilo(): FakeKilo {
  const calls: FakeKilo["calls"] = {
    createSession: 0,
    promptAsync: [],
    prompt: [],
    reply: [],
    questionReply: [],
    questionReject: [],
    abort: [],
    deleted: [],
    renamed: [],
  }
  const sessions: { id: string; title: string }[] = []
  let emit: ((event: BridgeEvent) => void) | undefined

  const time = () => {
    const now = Date.now()
    return { created: now, updated: now }
  }

  const backend: KiloBackend = {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async (input: CreateSessionInput) => {
      calls.createSession += 1
      const session = { id: `ses_${calls.createSession}`, title: input.title ?? `Session ${calls.createSession}` }
      sessions.push(session)
      return { id: session.id, title: session.title, time: time() }
    },
    promptAsync: async (input: PromptInput) => {
      calls.promptAsync.push(input)
    },
    prompt: async (input: PromptInput) => {
      calls.prompt.push(input)
      return { id: "msg_prompt" }
    },
    abort: async (input) => {
      calls.abort.push(input)
    },
    getMessages: async () => [],
    listSessions: async () => sessions.map((session) => ({ id: session.id, title: session.title, time: time() })),
    deleteSession: async (input) => {
      calls.deleted.push(input.sessionID)
      return {}
    },
    renameSession: async (input) => {
      calls.renamed.push(input)
      return { id: input.sessionID, title: input.title, time: time() }
    },
    providers: async () => ({
      all: [{ id: "kilo", name: "Kilo", models: { auto: { id: "auto", name: "Auto" } } }],
      connected: ["kilo"],
      default: { kilo: "auto" },
      failures: [],
    }),
    providerAuth: async () => ({}),
    reply: async (input) => {
      calls.reply.push(input)
      return {}
    },
    questionReply: async (input) => {
      calls.questionReply.push(input)
      return {}
    },
    questionReject: async (input) => {
      calls.questionReject.push(input)
      return {}
    },
    startEvents: (handler) => {
      emit = handler
      return () => {
        emit = undefined
      }
    },
  }

  return {
    backend,
    calls,
    sessions,
    emit(event) {
      if (!emit) throw new Error("fake kilo events not subscribed (bridge not started)")
      emit(event)
    },
    reset() {
      calls.promptAsync.length = 0
      calls.prompt.length = 0
      calls.reply.length = 0
      calls.questionReply.length = 0
      calls.questionReject.length = 0
      calls.abort.length = 0
      calls.deleted.length = 0
      calls.renamed.length = 0
    },
  }
}
