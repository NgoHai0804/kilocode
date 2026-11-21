import { test, expect } from "bun:test"
import { SERVER_INSTRUCTIONS, TOOLS, callTool, type RuntimeCache } from "../../src/mcp"

const NAMES = [
  "status",
  "tabs",
  "switch_tab",
  "new_tab",
  "close_tab",
  "navigate",
  "snapshot",
  "screenshot",
  "console",
  "network",
  "get_text",
  "get_html",
  "find",
  "attrs",
  "outline",
  "click",
  "type",
  "press",
  "hover",
  "select",
  "fill",
  "scroll",
  "history",
  "batch",
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

test("shim exposes the 27 browser tools with descriptions", () => {
  expect(TOOLS.map((tool) => tool.name).sort()).toEqual([...NAMES].sort())
  expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length)
  for (const tool of TOOLS) {
    expect(typeof tool.description).toBe("string")
    expect(tool.description.trim().length).toBeGreaterThan(20)
  }
})

const cache: RuntimeCache = {
  path: "test",
  invalidate() {},
  read: async () => ({ httpUrl: "http://127.0.0.1:9", token: "a".repeat(64) }),
}

function bridgeResponse(error: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: false, error }), { status: 200 })
}

test("no_target errors surface the specific reason so the cause is visible", async () => {
  const original = globalThis.fetch
  const response = bridgeResponse({
    code: -32003,
    message: "NO_TARGET",
    data: { kind: "NO_TARGET", retryable: true, remediation: "Chọn tab hợp lệ.", reason: "element_covered" },
  })
  globalThis.fetch = (async () => response) as unknown as typeof fetch
  try {
    const result = await callTool("click", { ref: "e1" }, cache)
    const text = (result as { content: { text: string }[] }).content[0]!.text
    expect(text).toContain("[browser:no_target]")
    expect(text).toContain("element_covered")
  } finally {
    globalThis.fetch = original
  }
})
