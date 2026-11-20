import { test, expect } from "bun:test"
import { isAttachable, pickAttachTab } from "../../extension/src/background/attach"

test("auto-attach follows the active tab", () => {
  expect(pickAttachTab({ autoAttach: true, selected: null, active: { tabId: 5 } })).toEqual({ tabId: 5 })
  expect(
    pickAttachTab({ autoAttach: true, selected: { tabId: 2 }, active: { tabId: 5, windowId: 1 } }),
  ).toEqual({ tabId: 5, windowId: 1 })
  expect(pickAttachTab({ autoAttach: true, selected: { tabId: 2 }, active: null })).toBeUndefined()
})

test("manual mode keeps the selected tab and attaches nothing without one", () => {
  expect(
    pickAttachTab({ autoAttach: false, selected: { tabId: 2, windowId: 1 }, active: { tabId: 5 } }),
  ).toEqual({ tabId: 2, windowId: 1 })
  expect(pickAttachTab({ autoAttach: false, selected: null, active: { tabId: 5 } })).toBeUndefined()
})

test("browser-internal pages are not attachable", () => {
  expect(isAttachable("https://example.com")).toBe(true)
  expect(isAttachable("http://localhost:3000")).toBe(true)
  expect(isAttachable(undefined)).toBe(true)
  expect(isAttachable("chrome://extensions")).toBe(false)
  expect(isAttachable("chrome-extension://abc/sidepanel.html")).toBe(false)
  expect(isAttachable("devtools://devtools/bundled/inspector.html")).toBe(false)
})
