import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../../src/config/schema"
import { BridgeServer } from "../../../src/bridge/server"
import type { KiloBackend } from "../../../src/bridge/kilo"

function kilo(): KiloBackend {
  return {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => ({}),
    promptAsync: async () => undefined,
    prompt: async () => ({}),
    abort: async () => undefined,
    getMessages: async () => [],
  }
}

test("the bridge shuts down after the idle timeout and removes runtime.json", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-idle-"))
  const config = parse(
    merge(DEFAULT_CONFIG, {
      bridge: { idleTimeoutMs: 100 },
      logging: { level: "error" },
    }),
  )
  const bridge = new BridgeServer({ workspace, config, kilo: kilo(), token: "c".repeat(64) })
  try {
    await bridge.start()
    expect(await Bun.file(bridge.runtimePath).exists()).toBe(true)
    await bridge.closed
    expect(await Bun.file(bridge.runtimePath).exists()).toBe(false)
  } finally {
    await bridge.stop()
    await rm(workspace, { recursive: true, force: true })
  }
}, 10000)