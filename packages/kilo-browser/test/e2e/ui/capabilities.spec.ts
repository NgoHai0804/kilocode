import { afterAll, beforeAll, expect, test } from "bun:test"
import { createUiEnv, uiSkipReason, waitForBridge, type UiEnv } from "./harness"

const reason = uiSkipReason()
let env: UiEnv | undefined

const FORBIDDEN = ["agent manager", "marketplace", "terminal", "worktree", "pull request", "migration"]

beforeAll(async () => {
  if (!reason) env = await createUiEnv()
}, 60000)

afterAll(async () => {
  if (env) await env.cleanup()
}, 30000)

test.skipIf(Boolean(reason))("hides unsupported surfaces in the chat page", async () => {
  const page = await env!.open("sidepanel.html")
  await waitForBridge(env!)
  const capabilities = await page.evaluate(() => (window as Window & { KILO_CAPABILITIES?: Record<string, boolean> }).KILO_CAPABILITIES ?? {})
  expect(capabilities.agentManager ?? false).toBe(false)
  expect(capabilities.marketplace ?? false).toBe(false)
  expect(capabilities.terminal ?? false).toBe(false)
  expect(capabilities.worktree ?? false).toBe(false)

  for (const label of FORBIDDEN) {
    expect(await page.getByRole("button", { name: new RegExp(label, "i") }).count()).toBe(0)
  }
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase()
  for (const label of ["agent manager", "marketplace"]) {
    expect(text.includes(label)).toBe(false)
  }
}, 60000)

test.skipIf(Boolean(reason))("hides unsupported settings tabs in the settings page", async () => {
  const page = await env!.open("settings.html")
  await waitForBridge(env!)
  await page.getByRole("tab", { name: "Display" }).waitFor({ timeout: 20000 })
  const tabs = await page.getByRole("tab").allInnerTexts()
  const joined = tabs.join("\n").toLowerCase()
  for (const label of FORBIDDEN) {
    expect(joined.includes(label)).toBe(false)
  }
}, 60000)
