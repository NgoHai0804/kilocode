import { afterAll, beforeAll, expect, test } from "bun:test"
import { createUiEnv, uiSkipReason, waitForBridge, type UiEnv } from "./harness"
import { until } from "../harness"

const reason = uiSkipReason()
let env: UiEnv | undefined

beforeAll(async () => {
  if (!reason) env = await createUiEnv()
}, 60000)

afterAll(async () => {
  if (env) await env.cleanup()
}, 30000)

test.skipIf(Boolean(reason))("saves a settings value and keeps it after reopening", async () => {
  const page = await env!.open("settings.html")
  await waitForBridge(env!)
  await page.getByRole("tab", { name: "Display" }).click()

  const toggle = page.getByRole("switch", { name: /Cycle Reasoning Effort/i }).first()
  await toggle.waitFor({ timeout: 20000 })
  const initial = await toggle.getAttribute("aria-checked")
  const expected = initial === "true" ? false : true

  const inputId = (await toggle.getAttribute("id")) ?? ""
  const control = page.locator(`#${inputId.replace(/-input$/, "-control")}`)
  await control.click()
  await until(async () => (await toggle.getAttribute("aria-checked")) === String(expected), 10000, "switch to flip")
  const saveBar = page.locator(".settings-save-bar")
  await saveBar.waitFor({ timeout: 10000 })
  await saveBar.getByRole("button", { name: /^save$/i }).click()
  await until(
    async () => {
      const state = await env!.readUiState()
      const settings = state.settings as Record<string, unknown> | undefined
      return !!settings && Object.values(settings).includes(expected)
    },
    10000,
    "setting to persist to the bridge state file",
  )

  const reopened = await env!.open("settings.html")
  await waitForBridge(env!)
  await reopened.getByRole("tab", { name: "Display" }).click()
  const toggle2 = reopened.getByRole("switch", { name: /Cycle Reasoning Effort/i }).first()
  await toggle2.waitFor({ timeout: 20000 })
  await until(async () => (await toggle2.getAttribute("aria-checked")) === String(expected), 10000, "persisted value to reload")
}, 60000)




