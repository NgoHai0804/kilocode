import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../src/config/schema"
import { Supervisor } from "../../src/bridge/supervisor"
import { KiloClient } from "../../src/bridge/kilo"

const binary = Bun.which("kilo")

if (!binary) {
  test.skip("kilo serve integration (binary 'kilo' not found on PATH)", () => undefined)
} else {
  test(
    "spawns kilo serve, reports health, and creates a session",
    async () => {
      const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-kilo-"))
      const config = parse(
        merge(DEFAULT_CONFIG, {
          kilo: { command: binary, startupTimeoutMs: 20_000 },
          logging: { level: "error" },
        }),
      )
      const supervisor = new Supervisor({ config, cwd: workspace })
      try {
        const info = await supervisor.start()
        const client = new KiloClient(info.url, supervisor.credentials)
        expect(await client.healthy()).toBe(true)
        const session = (await client.createSession({ title: "kilo-browser integration" })) as Record<string, unknown>
        expect(typeof session.id).toBe("string")
        await client.stop()
      } finally {
        await supervisor.stop()
        await rm(workspace, { recursive: true, force: true })
      }
    },
    40_000,
  )
}
