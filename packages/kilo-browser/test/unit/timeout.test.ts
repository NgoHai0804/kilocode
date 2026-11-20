import { test, expect } from "bun:test"
import { RpcPeer, RpcFailure } from "../../src/protocol/rpc"

test("RpcPeer timeout rejects TIMEOUT and sends browser.cancel", async () => {
  const sent: Record<string, unknown>[] = []
  const peer = new RpcPeer({ send: (message) => sent.push(message), defaultTimeoutMs: 10 })
  let failure: unknown
  try {
    await peer.call("browser.status", {})
  } catch (err) {
    failure = err
  }
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("TIMEOUT")
  expect(sent).toHaveLength(2)
  const request = sent[0]!
  const cancel = sent[1]!
  expect(request.method).toBe("browser.status")
  expect(cancel.method).toBe("browser.cancel")
  expect((cancel.params as Record<string, unknown>).requestId).toBe(request.id)
})

test("RpcPeer accepts a late response only for the pending request", async () => {
  const sent: Record<string, unknown>[] = []
  const peer = new RpcPeer({ send: (message) => sent.push(message), defaultTimeoutMs: 1000 })
  const pending = peer.call("browser.snapshot", {})
  const request = sent[0]!
  expect(peer.accept({ jsonrpc: "2.0", id: request.id, result: { refs: 1 } })).toBe(true)
  expect(await pending).toEqual({ refs: 1 })
})