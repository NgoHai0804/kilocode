import { test, expect } from "bun:test"
import { DEFAULT_CONFIG, parse } from "../../../src/config/schema"
import { executeTool, type HttpBridge } from "../../../src/bridge/http"
import { RpcFailure } from "../../../src/protocol/rpc"
test("AC-16: DEVTOOLS_CONFLICT is returned without a retry", async () => {
  let calls = 0
  const bridge = {
    config: parse(DEFAULT_CONFIG),
    workspace: process.cwd(),
    hub: {
      request: async () => {
        calls += 1
        throw new RpcFailure("DEVTOOLS_CONFLICT", { reason: "Another debugger is already attached" })
      },
    },
    approvals: undefined,
    logEvent: () => undefined,
  } as unknown as HttpBridge
  let failure: unknown
  try {
    await executeTool(bridge, { method: "browser.navigate", params: { url: "http://localhost:3000/" } })
  } catch (err) {
    failure = err
  }
  expect(failure).toBeInstanceOf(RpcFailure)
  expect((failure as RpcFailure).kind).toBe("DEVTOOLS_CONFLICT")
  expect((failure as RpcFailure).body.data.remediation).toContain("DevTools")
  expect(calls).toBe(1)
})