import { test, expect } from "bun:test"
import { RefRegistry, type SnapshotNode } from "../../extension/src/refs/registry"
import { RpcFailure } from "../../src/protocol/rpc"

function node(backendNodeId: number, role: string, name: string, tag: string, depth = 0): SnapshotNode {
  return { backendNodeId, role, name, tag, depth }
}

function failureOf(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (err) {
    return err
  }
}

test("refs are stable inside one snapshot and stale after a new snapshot", async () => {
  const registry = new RefRegistry()
  const nodes = [
    node(101, "heading", "Sign in", "h1"),
    node(102, "textbox", "Email", "input", 1),
    node(103, "button", "Save", "button", 1),
  ]
  const first = await registry.build(nodes)
  expect(first.snapshotId).toMatch(/^[0-9a-f]{8}$/)
  expect(first.refs).toBe(3)
  expect(first.text).toContain('button "Save"')
  expect(first.truncated).toBe(false)

  const target = registry.resolve("e1")
  expect(target.backendNodeId).toBe(101)
  expect(target.hash).toMatch(/^[0-9a-f]{8}$/)
  expect(target.snapshotId).toBe(first.snapshotId)
  expect(registry.resolve("e3").backendNodeId).toBe(103)

  const second = await registry.build(nodes)
  expect(second.snapshotId).not.toBe(first.snapshotId)
  const failure = failureOf(() => registry.resolve("e1"))
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("STALE_REF")
  expect(registry.resolve("e4").backendNodeId).toBe(101)
})

test("nodes without a backendNodeId and cross-origin frames are skipped", async () => {
  const registry = new RefRegistry()
  const view = await registry.build(
    [
      node(201, "button", "Save", "button"),
      node(0, "button", "Hidden frame button", "button"),
      node(202, "link", "Docs", "a"),
    ],
    { skippedFrames: 2 },
  )
  expect(view.refs).toBe(2)
  expect(view.skippedFrames).toBe(2)
  expect(view.text).not.toContain("Hidden frame button")
})

test("reference TTL expires and invalidates the snapshot", async () => {
  let clock = 1_000
  const registry = new RefRegistry({ ttlMs: 50, now: () => clock })
  await registry.build([node(301, "button", "Save", "button")])
  expect(registry.resolve("e1").backendNodeId).toBe(301)
  clock += 51
  const failure = failureOf(() => registry.resolve("e1"))
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("STALE_REF")
})

test("maxNodes caps the snapshot and marks it truncated", async () => {
  const registry = new RefRegistry()
  const nodes = Array.from({ length: 5 }, (_, index) => node(400 + index, "button", `B${index}`, "button"))
  const view = await registry.build(nodes, { maxNodes: 2 })
  expect(view.refs).toBe(2)
  expect(view.truncated).toBe(true)
  expect(view.text.split("\n")).toHaveLength(2)
})

test("text mode omits roles", async () => {
  const registry = new RefRegistry()
  const view = await registry.build([node(501, "button", "Save", "button")], { mode: "text" })
  expect(view.text).toBe('"Save" [ref=e1]')
})