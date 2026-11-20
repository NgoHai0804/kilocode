import { afterAll, beforeAll, expect, test } from "bun:test"
import { createUiEnv, uiSkipReason, waitForBridge, type UiEnv } from "./harness"

const reason = uiSkipReason()
let env: UiEnv | undefined

beforeAll(async () => {
  if (!reason) env = await createUiEnv()
}, 60000)

afterAll(async () => {
  if (env) await env.cleanup()
}, 30000)

test.skipIf(Boolean(reason))("pairs the extension UI through POST /pair/claim and connects", async () => {
  const page = await env!.open("sidepanel.html")
  await waitForBridge(env!)
  expect(env!.bridge.ui.connected).toBe(true)
  const stored = await page.evaluate(() => ({
    port: localStorage.getItem("kilo.browser.bridge.port"),
    token: localStorage.getItem("kilo.browser.bridge.token"),
  }))
  expect(Number(stored.port)).toBe(Number(env!.bridge.port))
  expect(stored.token).toBe(env!.bridge.token())
}, 30000)

