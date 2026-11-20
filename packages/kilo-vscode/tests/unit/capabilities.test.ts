import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BROWSER_V1_CAPABILITIES,
  capabilityForView,
  filterSettingsTabs,
  hasCapability,
  settingsTabCapability,
} from "../../webview-ui/src/host/capabilities"
import { ALL_HOST_CAPABILITIES, NO_HOST_CAPABILITIES, hostCapabilities } from "../../webview-ui/src/host/HostBridge"
import { SETTINGS_TABS } from "../../webview-ui/src/components/settings/settings-search"

const BROWSER = hostCapabilities(BROWSER_V1_CAPABILITIES)

describe("hasCapability", () => {
  it("is false for every capability on an empty host", () => {
    expect(hasCapability(NO_HOST_CAPABILITIES, "chat")).toBe(false)
    expect(hasCapability(NO_HOST_CAPABILITIES, "settings.models")).toBe(false)
    expect(hasCapability(NO_HOST_CAPABILITIES, "agentManager")).toBe(false)
  })

  it("is false for an undefined host and true only for explicit true", () => {
    expect(hasCapability(undefined, "chat")).toBe(false)
    expect(hasCapability({ ...NO_HOST_CAPABILITIES, chat: true }, "chat")).toBe(true)
  })

  it("enables every capability in the VS Code default", () => {
    for (const name of Object.keys(NO_HOST_CAPABILITIES) as (keyof typeof NO_HOST_CAPABILITIES)[]) {
      expect(hasCapability(ALL_HOST_CAPABILITIES, name)).toBe(true)
    }
  })
})

describe("capabilityForView", () => {
  it("maps each known view to its owning capability", () => {
    expect(capabilityForView("newTask")).toBe("chat")
    expect(capabilityForView("history")).toBe("history")
    expect(capabilityForView("profile")).toBe("profile")
    expect(capabilityForView("settings")).toBe("settings")
    expect(capabilityForView("subAgentViewer")).toBe("subAgentViewer")
  })

  it("has no gate for an unknown view", () => {
    expect(capabilityForView("marketplace")).toBeUndefined()
  })
})

describe("filterSettingsTabs", () => {
  const ids = (caps: Parameters<typeof filterSettingsTabs>[1]) =>
    filterSettingsTabs(SETTINGS_TABS, caps).map((tab) => tab.id)

  it("keeps only the v1 subset for the browser host", () => {
    expect(ids(BROWSER)).toEqual([
      "models",
      "providers",
      "agentBehaviour",
      "autoApprove",
      "display",
      "language",
      "aboutKiloCode",
    ])
  })

  it("drops v1 host-only tabs for the browser host", () => {
    const visible = new Set(ids(BROWSER))
    for (const tab of ["agentManager", "browser", "checkpoints", "autocomplete", "notifications", "context", "commitMessage", "indexing", "sandboxing", "experimental"]) {
      expect(visible.has(tab)).toBe(false)
    }
  })

  it("does not advertise the experimental runtime tab to the browser host", () => {
    expect(hasCapability(BROWSER, "settings.experimental")).toBe(false)
  })

  it("keeps every tab when the host enables them all", () => {
    expect(ids(ALL_HOST_CAPABILITIES)).toEqual(SETTINGS_TABS.map((tab) => tab.id))
  })

  it("drops tabs whose capability the host does not advertise", () => {
    const partial = hostCapabilities({ "settings.models": true })
    expect(ids(partial)).toEqual(["models"])
  })

  it("ignores unknown tabs", () => {
    expect(filterSettingsTabs([{ id: "models" }, { id: "mystery" }], BROWSER).map((tab) => tab.id)).toEqual(["models"])
  })
})

describe("CapabilityBoundary", () => {
  const source = readFileSync(join(__dirname, "..", "..", "webview-ui", "src", "host", "capability-context.tsx"), "utf8")

  it("exports the boundary and gates through useCapability", () => {
    expect(source).toMatch(/export const CapabilityBoundary/)
    expect(source).toMatch(/useCapability\(props\.capability\)/)
    expect(source).toMatch(/<Show when=\{useCapability/)
  })

  it("does not hide unsupported surfaces with CSS", () => {
    expect(source).not.toMatch(/display:\s*["']none["']/)
    expect(source).not.toMatch(/visibility:\s*["']hidden["']/)
  })
})