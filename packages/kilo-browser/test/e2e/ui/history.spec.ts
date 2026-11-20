import { afterAll, beforeAll, expect, test } from "bun:test"
import { createUiEnv, sendPrompt, uiSkipReason, waitForBridge, type UiEnv } from "./harness"
import { until } from "../harness"

const reason = uiSkipReason()
let env: UiEnv | undefined

beforeAll(async () => {
  if (!reason) env = await createUiEnv()
}, 60000)

afterAll(async () => {
  if (env) await env.cleanup()
}, 30000)

async function tabTitles(page: Awaited<ReturnType<UiEnv["open"]>>) {
  return (await page.locator(".am-tab-title").allInnerTexts()).map((value) => value.trim())
}

test.skipIf(Boolean(reason))("keeps session tabs and history across a reload", async () => {
  const page = await env!.open("sidepanel.html")
  await waitForBridge(env!)

  await sendPrompt(page, `first ${Date.now()}`)
  await until(() => env!.kilo.calls.promptAsync.length === 1, 15000, "first prompt")
  await page.getByRole("button", { name: "New Task", exact: true }).click()
  await sendPrompt(page, `second ${Date.now()}`)
  await until(() => env!.kilo.calls.promptAsync.length === 2, 15000, "second prompt")
  await until(async () => (await tabTitles(page)).length >= 2, 15000, "two session tabs")

  const before = (await tabTitles(page)).slice(0, 2)
  expect(before.length).toBe(2)

  // Wait for the debounced tab persistence to land before reloading, otherwise
  // the reload cancels the pending write.
  await until(
    async () => {
      const raw = await page.evaluate(() => localStorage.getItem("kilo.browser.ui.state"))
      if (!raw) return false
      try {
        const state = JSON.parse(raw) as { sidebarSessionTabIDs?: string[] }
        return Array.isArray(state.sidebarSessionTabIDs) && state.sidebarSessionTabIDs.length >= 2
      } catch (err) {
        return false
      }
    },
    15000,
    "tab ids to persist",
  )

  await page.reload()
  await waitForBridge(env!)
  await until(async () => (await tabTitles(page)).length >= 2, 15000, "tabs after reload")
  const after = (await tabTitles(page)).slice(0, 2)
  expect(after).toEqual(before)
}, 60000)

