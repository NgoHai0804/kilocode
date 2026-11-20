import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../src/config/schema"
import { BridgeServer } from "../../src/bridge/server"
import { UI_FILE_LIMIT } from "../../src/bridge/ui-files"
import type { BridgeEvent, KiloBackend } from "../../src/bridge/kilo"

function fakeKilo() {
  let emit: ((event: BridgeEvent) => void) | undefined
  const backend = {
    url: "http://127.0.0.1:1",
    healthy: async () => true,
    createSession: async () => ({ id: "ses_1" }),
    promptAsync: async () => undefined,
    prompt: async () => ({ id: "msg_1" }),
    abort: async () => undefined,
    getMessages: async () => [
      {
        parts: [
          {
            type: "tool",
            state: { metadata: { filediff: { file: "src/a.ts", patch: "@@ -1 +1 @@", additions: 1, deletions: 1 } } },
          },
        ],
      },
    ],
    startEvents: (handler: (event: BridgeEvent) => void) => {
      emit = handler
      return () => {
        emit = undefined
      }
    },
  }
  return {
    backend: backend as unknown as KiloBackend,
    emit: (event: BridgeEvent) => emit?.(event),
  }
}

test(
  "serves /ui/file through the jail, /ui/diff from the session, and /ui/url-guard",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-files-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-home-"))
    const kilo = fakeKilo()
    const config = parse(
      merge(DEFAULT_CONFIG, {
        logging: { level: "error" },
        bridge: { heartbeatMs: 60_000, pongTimeoutMs: 120_000 },
      }),
    )
    const bridge = new BridgeServer({ workspace, config, kilo: kilo.backend, home, token: "a".repeat(64) })
    try {
      await Bun.write(path.join(workspace, "note.txt"), "hello world")
      await Bun.write(path.join(workspace, "big.txt"), "x".repeat(UI_FILE_LIMIT + 10))
      await bridge.start()
      const auth = { Authorization: `Bearer ${bridge.token()}` }

      const ok = await fetch(`${bridge.url}/ui/file?path=note.txt`, { headers: auth })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({
        ok: true,
        result: { path: "note.txt", text: "hello world", truncated: false },
      })

      const outside = await fetch(`${bridge.url}/ui/file?path=${encodeURIComponent(path.join("..", "outside.txt"))}`, {
        headers: auth,
      })
      expect(outside.status).toBe(403)
      expect(await outside.json()).toMatchObject({ ok: false, error: { message: "POLICY_DENIED" } })

      const big = await fetch(`${bridge.url}/ui/file?path=big.txt`, { headers: auth })
      const bigBody = (await big.json()) as { result: { truncated: boolean; text: string } }
      expect(bigBody.result.truncated).toBe(true)
      expect(bigBody.result.text.length).toBe(UI_FILE_LIMIT)

      const missingParam = await fetch(`${bridge.url}/ui/file`, { headers: auth })
      expect(missingParam.status).toBe(400)

      const noAuth = await fetch(`${bridge.url}/ui/file?path=note.txt`)
      expect(noAuth.status).toBe(401)

      const diff = await fetch(`${bridge.url}/ui/diff?session=ses_1`, { headers: auth })
      const diffBody = (await diff.json()) as { ok: boolean; result: { session: string; files: { path: string }[] } }
      expect(diffBody.ok).toBe(true)
      expect(diffBody.result.session).toBe("ses_1")
      expect(diffBody.result.files[0]?.path).toBe("src/a.ts")

      const diffNoSession = await fetch(`${bridge.url}/ui/diff`, { headers: auth })
      expect(diffNoSession.status).toBe(400)

      kilo.emit({
        channel: "ui",
        type: "session.diff",
        data: { sessionID: "ses_2", diff: [{ file: "b.ts", before: "old", after: "new", additions: 1, deletions: 1 }] },
      })
      const captured = await fetch(`${bridge.url}/ui/diff?session=ses_2`, { headers: auth })
      const capturedBody = (await captured.json()) as { result: { files: unknown[] } }
      expect(capturedBody.result.files).toEqual([
        { path: "b.ts", before: "old", after: "new", additions: 1, deletions: 1 },
      ])

      const guard = await fetch(`${bridge.url}/ui/url-guard?url=${encodeURIComponent("https://example.com/x")}`, {
        headers: auth,
      })
      expect(await guard.json()).toMatchObject({ ok: true, result: { allowed: true } })

      const blocked = await fetch(`${bridge.url}/ui/url-guard?url=${encodeURIComponent("javascript:alert(1)")}`, {
        headers: auth,
      })
      expect(await blocked.json()).toMatchObject({ ok: true, result: { allowed: false } })
    } finally {
      await bridge.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  },
  15000,
)