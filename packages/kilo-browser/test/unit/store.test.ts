import { test, expect } from "bun:test"
import { SCHEMA_VERSION, Store, type StorageArea } from "../../extension/src/storage/store"

class MemoryArea implements StorageArea {
  readonly data: Record<string, unknown>

  constructor(data: Record<string, unknown> = {}) {
    this.data = { ...data }
  }

  async get(keys?: string | string[] | null) {
    if (keys === undefined || keys === null) return { ...this.data }
    const list = Array.isArray(keys) ? keys : [keys]
    const out: Record<string, unknown> = {}
    for (const key of list) {
      if (key in this.data) out[key] = this.data[key]
    }
    return out
  }

  async set(items: Record<string, unknown>) {
    Object.assign(this.data, items)
  }

  async remove(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.data[key]
  }
}

test("migrates a version zero state and persists the schema version", async () => {
  const area = new MemoryArea({
    settings: { autoReconnect: false, redactInUi: true },
    pairing: {
      extensionId: "kilotest",
      token: "a".repeat(64),
      bridgeUrl: "ws://127.0.0.1:1234/ws",
      pairedAt: "2026-11-19T00:00:00Z",
    },
    allowlist: { origins: ["http://localhost:3000"] },
    tab: { tabId: 5, windowId: 2 },
  })
  const store = new Store(area)
  const state = await store.load()
  expect(state.schemaVersion).toBe(SCHEMA_VERSION)
  expect(state.settings.autoReconnect).toBe(false)
  expect(state.settings.redactInUi).toBe(true)
  expect(state.allowlist.origins).toEqual(["http://localhost:3000"])
  expect(state.tab).toEqual({ tabId: 5, windowId: 2 })
  expect(state.pairing?.token).toBe("a".repeat(64))
  expect(area.data.schemaVersion).toBe(SCHEMA_VERSION)
})

test("patch merges nested settings, allowlist, and ui", async () => {
  const area = new MemoryArea()
  const store = new Store(area)
  await store.load()
  const state = await store.patch({
    settings: { bridgePort: 4444 },
    allowlist: { origins: ["http://127.0.0.1:3000"] },
    ui: { lastError: "DEVTOOLS_CONFLICT" },
  })
  expect(state.settings.bridgePort).toBe(4444)
  expect(state.settings.autoReconnect).toBe(true)
  expect(state.allowlist.origins).toEqual(["http://127.0.0.1:3000"])
  expect(state.ui.lastError).toBe("DEVTOOLS_CONFLICT")
  expect(state.ui.pageMode).toBe("sidepanel")
})

test("invalid pairing data is discarded during migration", async () => {
  const store = new Store(new MemoryArea({ pairing: { token: "short" } }))
  const state = await store.load()
  expect(state.pairing).toBeNull()
})