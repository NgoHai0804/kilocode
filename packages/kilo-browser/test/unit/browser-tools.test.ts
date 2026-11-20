import { test, expect } from "bun:test"
import type { ToolContext } from "../../extension/src/tools/context"
import { RpcFailure } from "../../src/protocol/rpc"
import * as find from "../../extension/src/tools/find"
import * as select from "../../extension/src/tools/select"
import * as fill from "../../extension/src/tools/fill"
import * as closeTab from "../../extension/src/tools/close_tab"
import * as newTab from "../../extension/src/tools/new_tab"
import * as press from "../../extension/src/tools/press"

const ctx = {} as unknown as ToolContext
const signal = new AbortController().signal

async function failureOf(fn: () => Promise<unknown>): Promise<RpcFailure> {
  try {
    await fn()
    throw new Error("expected failure")
  } catch (err) {
    expect(err).toBeInstanceOf(RpcFailure)
    return err as RpcFailure
  }
}

test("find requires at least one lookup condition", async () => {
  const failure = await failureOf(() => find.run({}, ctx, signal))
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("condition")
})

test("select requires value, label, or index", async () => {
  const failure = await failureOf(() => select.run({ selector: "#x" }, ctx, signal))
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("option")
})

test("fill requires a text string", async () => {
  const failure = await failureOf(() => fill.run({ selector: "#x" }, ctx, signal))
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("text")
})

test("close_tab requires a tab id", async () => {
  const failure = await failureOf(() => closeTab.run({}, ctx, signal))
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("tabId")
})

test("new_tab reports missing tab control instead of crashing", async () => {
  const failure = await failureOf(() => newTab.run({}, ctx, signal))
  expect(failure.kind).toBe("INTERNAL_ERROR")
  expect(failure.data.reason).toBe("tab_control_unavailable")
})

test("press without a ref dispatches page-level keys without requiring focus", async () => {
  const calls: string[] = []
  const attached = {
    session: {
      tab: { id: 1, url: "https://example.com/", attached: true },
      url: "https://example.com/",
      send: async (method: string) => {
        calls.push(method)
        return {}
      },
      readPageInfo: async () => ({ url: "https://example.com/", title: "Example" }),
    },
    refs: {},
    allowlist: async () => [],
  } as unknown as ToolContext
  const result = await press.run({ key: "End" }, attached, signal)
  expect(result).toMatchObject({ pressed: "End" })
  expect(calls).toContain("Input.dispatchKeyEvent")
})
