import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../src/config/schema"
import { BridgeServer } from "../../src/bridge/server"
import type { BridgeEvent, KiloBackend } from "../../src/bridge/kilo"

function fakeKilo(target: { emit?: (event: BridgeEvent) => void }): KiloBackend {
  return {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => ({ id: "ses_test" }),
    promptAsync: async () => undefined,
    prompt: async () => ({ id: "msg_test" }),
    abort: async () => undefined,
    getMessages: async () => [],
    startEvents(onEvent) {
      target.emit = onEvent
      return () => {
        target.emit = undefined
      }
    },
  }
}

test("bridge seeds instructions and creates a session note on session.turn.close", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-memory-integration-"))
  const events: { emit?: (event: BridgeEvent) => void } = {}
  const config = parse(merge(DEFAULT_CONFIG, { logging: { level: "error" }, memory: { enabled: true, sessionLog: true } }))
  const bridge = new BridgeServer({ workspace, config, kilo: fakeKilo(events) })
  try {
    await bridge.start()
    expect(await Bun.file(path.join(workspace, ".kilo", "kilo-browser", "AGENTS.md")).exists()).toBe(true)
    expect(events.emit).toBeDefined()
    events.emit?.({
      channel: "ui",
      type: "session.turn.close",
      data: { sessionID: "ses_turn", goal: "login fails", url: "http://localhost:3000", status: "fixed" },
    })
    const note = path.join(workspace, ".kilo", "kilo-browser", "sessions", "ses_turn.md")
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (await Bun.file(note).exists()) break
      await Bun.sleep(25)
    }
    const text = await Bun.file(note).text()
    expect(text).toContain("login fails")
    expect(text).toContain("http://localhost:3000")
    expect(text).toContain("Status: fixed")
  } finally {
    await bridge.stop()
    await rm(workspace, { recursive: true, force: true })
  }
})