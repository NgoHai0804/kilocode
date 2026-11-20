import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, parse } from "../../src/config/schema"
import { executeTool, type HttpBridge } from "../../src/bridge/http"

function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes[24] = 8
  bytes[25] = 6
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

test("the bridge persists screenshot tool output as a PNG artifact", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-shot-"))
  try {
    const config = parse(DEFAULT_CONFIG)
    const hub = {
      request: async () => ({ data: pngBase64(1280, 720), format: "png", width: 1280, height: 720, bytes: 33 }),
    }
    const bridge = {
      workspace,
      config,
      hub,
      token: () => "a".repeat(64),
      authorized: () => true,
      pairingOpen: () => false,
      tab: () => undefined,
      setTab: () => undefined,
    } as unknown as HttpBridge

    const result = (await executeTool(bridge, { method: "browser.screenshot", params: {} })) as Record<string, unknown>
    expect(String(result.artifactId)).toMatch(/^\d{3}-screenshot-[0-9a-f]{8}\.png$/)
    expect(result.width).toBe(1280)
    expect(result.height).toBe(720)
    const file = path.join(workspace, String(result.artifactPath))
    expect(await Bun.file(file).exists()).toBe(true)
    const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})