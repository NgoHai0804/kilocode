import { test, expect } from "bun:test"
import type { ToolContext } from "../../extension/src/tools/context"
import { assertInteractable, center } from "../../extension/src/tools/target"
import * as input from "../../extension/src/cdp/domains/input"
import * as click from "../../extension/src/tools/click"
import * as type from "../../extension/src/tools/type"
import * as waitFor from "../../extension/src/tools/wait_for"
import { RpcFailure } from "../../src/protocol/rpc"

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    session: { url: "http://localhost:3000/", tab: { id: 1, url: "http://localhost:3000/", attached: true } } as unknown as ToolContext["session"],
    refs: { resolve: () => ({ backendNodeId: 1 }) } as unknown as ToolContext["refs"],
    console: {} as ToolContext["console"],
    network: {} as ToolContext["network"],
    allowlist: async () => ["http://localhost:3000"],
    paired: () => true,
    ...overrides,
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

test("keyInfo maps named keys, characters, and function keys", () => {
  expect(input.keyInfo("Enter")).toMatchObject({ code: "Enter", keyCode: 13 })
  expect(input.keyInfo("a")).toMatchObject({ code: "a", keyCode: 97, text: "a" })
  expect(input.keyInfo("F12")).toMatchObject({ code: "F12", keyCode: 123 })
  expect(input.keyInfo("NotAKey")).toBeUndefined()
})

test("centerOf reads the content quad", () => {
  expect(input.centerOf({ content: { quad: [0, 0, 20, 0, 20, 10, 0, 10] } })).toEqual({ x: 10, y: 5 })
  expect(input.centerOf({ content: { quad: [0, 0] } })).toBeUndefined()
})

test("assertInteractable rejects disabled, hidden, and covered elements", () => {
  const state = { tag: "button", disabled: false, readOnly: false, visible: true, hit: true, x: 1, y: 2, width: 3, height: 4, dpr: 1 }
  expect(() => assertInteractable(state)).not.toThrow()
  expect(() => assertInteractable({ ...state, disabled: true })).toThrow("NO_TARGET")
  expect(() => assertInteractable({ ...state, visible: false })).toThrow("NO_TARGET")
  expect(() => assertInteractable({ ...state, hit: false })).toThrow("NO_TARGET")
})

test("click requires a ref or selector before touching CDP", async () => {
  const failure = await failureOf(() => click.run({}, context(), new AbortController().signal))
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("ref")
})

test("type validates text length before touching CDP", async () => {
  const failure = await failureOf(() =>
    type.run({ ref: "e1", text: "x".repeat(4001) }, context(), new AbortController().signal),
  )
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("text")
})

test("wait_for requires at least one condition", async () => {
  const failure = await failureOf(() => waitFor.run({}, context(), new AbortController().signal))
  expect(failure.kind).toBe("INVALID_PARAMS")
  expect(failure.data.field).toBe("condition")
})

test("center falls back to the inspected rect when CDP has no box model", async () => {
  const ctx = context({
    session: {
      send: async () => ({}),
    } as unknown as ToolContext["session"],
  })
  const point = await center(ctx, { backendNodeId: 1 }, {
    tag: "button",
    disabled: false,
    readOnly: false,
    visible: true,
    hit: true,
    x: 40,
    y: 50,
    width: 10,
    height: 20,
    dpr: 1,
  })
  expect(point).toEqual({ x: 40, y: 50 })
})