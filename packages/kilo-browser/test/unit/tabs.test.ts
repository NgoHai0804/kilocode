import { test, expect } from "bun:test"
import type { TabControl, TabSummary, ToolContext } from "../../extension/src/tools/context"
import * as tabs from "../../extension/src/tools/tabs"
import * as switchTab from "../../extension/src/tools/switch_tab"
import { RpcFailure } from "../../src/protocol/rpc"

const OPEN: TabSummary[] = [
  { id: 1, windowId: 10, url: "https://example.com/", title: "Example", active: true, attached: false, attachable: true },
  { id: 2, windowId: 10, url: "chrome://extensions", title: "Extensions", active: false, attached: false, attachable: false },
]

function control(overrides: Partial<TabControl> = {}): TabControl {
  return {
    list: async () => OPEN,
    switchTo: async (tabId) => ({ id: tabId, active: true, attached: true, attachable: true, url: "https://example.com/" }),
    ...overrides,
  }
}

function context(tabControl: TabControl | undefined): ToolContext {
  return {
    session: {} as ToolContext["session"],
    refs: {} as ToolContext["refs"],
    console: {} as ToolContext["console"],
    network: {} as ToolContext["network"],
    allowlist: async () => [],
    paired: () => true,
    tabs: tabControl,
  }
}

async function failureOf(fn: () => Promise<unknown>): Promise<RpcFailure> {
  try {
    await fn()
    throw new Error("expected failure")
  } catch (err) {
    expect(err).toBeInstanceOf(RpcFailure)
    return err as RpcFailure
  }
}

test("tabs lists every open tab with its attachable flag", async () => {
  const result = await tabs.run({}, context(control()), new AbortController().signal)
  expect(result.count).toBe(2)
  expect(result.tabs).toEqual(OPEN)
})

test("switch_tab attaches exactly the requested tab", async () => {
  const calls: number[] = []
  const ctx = context(
    control({
      switchTo: async (tabId) => {
        calls.push(tabId)
        return { id: tabId, active: true, attached: true, attachable: true }
      },
    }),
  )
  const result = await switchTab.run({ tabId: 7 }, ctx, new AbortController().signal)
  expect(calls).toEqual([7])
  expect(result).toMatchObject({ id: 7, active: true, attached: true })
})

test("switch_tab requires a numeric tabId", async () => {
  const missing = await failureOf(() => switchTab.run({}, context(control()), new AbortController().signal))
  expect(missing.kind).toBe("INVALID_PARAMS")
  expect(missing.data.field).toBe("tabId")

  const wrong = await failureOf(() => switchTab.run({ tabId: "1" }, context(control()), new AbortController().signal))
  expect(wrong.kind).toBe("INVALID_PARAMS")
})

test("tab tools report unavailability when no tab control is wired", async () => {
  const list = await failureOf(() => tabs.run({}, context(undefined), new AbortController().signal))
  expect(list.kind).toBe("INTERNAL_ERROR")
  const swap = await failureOf(() => switchTab.run({ tabId: 1 }, context(undefined), new AbortController().signal))
  expect(swap.kind).toBe("INTERNAL_ERROR")
})
