import { test, expect } from "bun:test"
import { RpcFailure, RpcPeer, rpcError } from "../../src/protocol/rpc"
import { negotiate } from "../../src/protocol/version"

test("error table matches the protocol codes", () => {
  expect(rpcError("PARSE_ERROR").code).toBe(-32700)
  expect(rpcError("STALE_REF").code).toBe(-32004)
  expect(rpcError("STALE_REF").data.retryable).toBe(true)
  expect(rpcError("POLICY_DENIED").data.retryable).toBe(false)
  expect(rpcError("TIMEOUT").code).toBe(-32005)
  expect(rpcError("RATE_LIMIT").code).toBe(-32005)
  expect(rpcError("KILO_UNAVAILABLE").code).toBe(-32006)
})

test("version negotiation accepts same major and lower minor", () => {
  expect(negotiate("1.0").ok).toBe(true)
  expect(negotiate("1.1").ok).toBe(false)
  expect(negotiate("2.0").ok).toBe(false)
  expect(negotiate("bad").ok).toBe(false)
})

test("requests execute serially", async () => {
  const sent: Record<string, unknown>[] = []
  const peer = new RpcPeer({ send: (message) => sent.push(message) })
  const first = peer.call("browser.status", {}, 1000)
  const second = peer.call("browser.snapshot", {}, 1000)
  expect(sent.length).toBe(1)
  expect(sent[0]!.method).toBe("browser.status")
  expect(peer.accept({ jsonrpc: "2.0", id: sent[0]!.id, result: { ok: 1 } })).toBe(true)
  expect(await first).toEqual({ ok: 1 })
  expect(sent.length).toBe(2)
  expect(sent[1]!.method).toBe("browser.snapshot")
  peer.accept({ jsonrpc: "2.0", id: sent[1]!.id, result: { ok: 2 } })
  expect(await second).toEqual({ ok: 2 })
})

test("timeout rejects with TIMEOUT", async () => {
  const peer = new RpcPeer({ send: () => undefined })
  const failure = await peer.call("browser.status", {}, 20).catch((err: unknown) => err)
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("TIMEOUT")
  expect((failure as RpcFailure).code).toBe(-32005)
})

test("queued request becomes BUSY after the wait budget", async () => {
  const peer = new RpcPeer({ send: () => undefined, busyWaitMs: 20 })
  const first = peer.call("browser.status", {}, 1000)
  const second = peer.call("browser.snapshot", {}, 1000)
  const failure = await second.catch((err: unknown) => err)
  expect((failure as RpcFailure).kind).toBe("BUSY")
  peer.close()
  await first.catch(() => undefined)
})
