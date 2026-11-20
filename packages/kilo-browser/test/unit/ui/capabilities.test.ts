import { describe, expect, test } from "bun:test"
import {
  NO_HOST_CAPABILITIES,
  hostCapabilities,
} from "../../../../kilo-vscode/webview-ui/src/host/HostBridge"
import { BROWSER_V1_CAPABILITIES, hasCapability } from "../../../../kilo-vscode/webview-ui/src/host/capabilities"

describe("host capabilities", () => {
  test("every capability defaults to false", () => {
    for (const enabled of Object.values(NO_HOST_CAPABILITIES)) {
      expect(enabled).toBe(false)
    }
  })

  test("overrides only the requested capabilities", () => {
    const caps = hostCapabilities({ "file.open": true, worktree: true })
    expect(caps["file.open"]).toBe(true)
    expect(caps.worktree).toBe(true)
    expect(caps.chat).toBe(false)
    expect(caps.settings).toBe(false)
  })

  test("browser v1 keeps the experimental runtime surface off", () => {
    const caps = hostCapabilities(BROWSER_V1_CAPABILITIES)
    expect(hasCapability(caps, "settings.experimental")).toBe(false)
    expect(hasCapability(caps, "settings")).toBe(true)
  })
})