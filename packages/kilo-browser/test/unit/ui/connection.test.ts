import { test, expect } from "bun:test"
import {
  connectionBanner,
  describeBridgeError,
  initialPairingState,
  reducePairing,
  type PairingState,
} from "../../../../kilo-vscode/webview-ui/browser/pairing"

function connected(): PairingState {
  return reducePairing(reducePairing(initialPairingState(7373), { type: "submit", port: 7373 }), {
    type: "success",
    port: 7373,
  })
}

test("hides the banner while connected", () => {
  expect(connectionBanner(connected()).visible).toBe(false)
})

test("shows reconnect guidance with Pair again after the socket drops", () => {
  const state = reducePairing(connected(), { type: "lost" })
  const model = connectionBanner(state)
  expect(state.status).toBe("reconnecting")
  expect(model.visible).toBe(true)
  expect(model.tone).toBe("warn")
  expect(model.action).toBe("pair-again")
  expect(model.actionLabel).toBe("Pair again")
})

test("shows actionable DevTools guidance when a tool error carries DEVTOOLS_CONFLICT", () => {
  const error = describeBridgeError("DEVTOOLS_CONFLICT")
  expect(error).toBeDefined()
  const model = connectionBanner(connected(), error)
  expect(model.visible).toBe(true)
  expect(model.tone).toBe("error")
  expect(model.action).toBe("retry")
  expect(model.text.toLowerCase()).toContain("devtools")
})

test("routes token errors to Pair again and policy errors to settings", () => {
  expect(describeBridgeError("UNAUTHORIZED")?.action).toBe("pair-again")
  expect(describeBridgeError("NOT_PAIRED")?.action).toBe("pair-again")
  expect(describeBridgeError("POLICY_DENIED")?.action).toBe("open-settings")
  expect(describeBridgeError("NO_TARGET")?.action).toBe("select-tab")
  expect(describeBridgeError("UNKNOWN_CODE")).toBeUndefined()
})
