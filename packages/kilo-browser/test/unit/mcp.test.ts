import { test, expect } from "bun:test"
import { SERVER_INSTRUCTIONS, TOOLS } from "../../src/mcp"

const NAMES = [
  "status",
  "tabs",
  "switch_tab",
  "navigate",
  "snapshot",
  "screenshot",
  "console",
  "network",
  "click",
  "type",
  "press",
  "reload",
  "wait_for",
  "eval",
]

test("shim advertises browser-assistant instructions", () => {
  expect(typeof SERVER_INSTRUCTIONS).toBe("string")
  expect(SERVER_INSTRUCTIONS.trim().length).toBeGreaterThan(0)
  expect(SERVER_INSTRUCTIONS).toContain("browser")
  expect(SERVER_INSTRUCTIONS).toContain("browser_snapshot")
  expect(SERVER_INSTRUCTIONS).toContain("browser_*")
})

test("shim exposes the 14 browser tools with descriptions", () => {
  expect(TOOLS.map((tool) => tool.name).sort()).toEqual([...NAMES].sort())
  expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length)
  for (const tool of TOOLS) {
    expect(typeof tool.description).toBe("string")
    expect(tool.description.trim().length).toBeGreaterThan(20)
  }
})
