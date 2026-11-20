import { test, expect } from "bun:test"
import { CdpSession } from "../../extension/src/cdp/session"
import type { DebuggerApi } from "../../extension/src/cdp/types"
import { RpcFailure } from "../../src/protocol/rpc"

function api(attachError: string): DebuggerApi {
  return {
    async attach() {
      throw new Error(attachError)
    },
    async detach() {},
    async sendCommand() {
      return {}
    },
    async getTargets() {
      return []
    },
    onEvent() {
      return () => {}
    },
    onDetach() {
      return () => {}
    },
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

test("a debugger conflict surfaces on later calls instead of a generic no_target", async () => {
  const session = new CdpSession({ api: api("Another debugger is already attached") })
  const first = await failureOf(() => session.attach(1))
  expect(first.kind).toBe("DEVTOOLS_CONFLICT")

  const next = await failureOf(() => session.ensure())
  expect(next.kind).toBe("DEVTOOLS_CONFLICT")
})

test("a non-conflict attach failure stays a no_target", async () => {
  const session = new CdpSession({ api: api("Cannot attach to this target") })
  const failure = await failureOf(() => session.attach(1))
  expect(failure.kind).toBe("NO_TARGET")
  expect(failure.data.reason).toBe("attach_failed:Cannot attach to this target")
})
