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

test.skipIf(Boolean(reason))("round-trips a permission approval through the UI", async () => {
  const page = await env!.open("sidepanel.html")
  await waitForBridge(env!)

  await sendPrompt(page, `needs approval ${Date.now()}`)
  await until(() => env!.kilo.calls.promptAsync.length > 0, 15000, "backend promptAsync call")
  const sessionID = env!.kilo.calls.promptAsync.at(-1)!.sessionID

  env!.kilo.emit({
    channel: "ui",
    type: "permission.asked",
    data: {
      id: "per_e2e",
      sessionID,
      permission: "browser_eval",
      patterns: [],
      always: [],
      metadata: { expression: "document.title" },
      tool: { messageID: "msg_e2e", callID: "call_e2e" },
    },
  })

  const allow = page.getByRole("button", { name: "Allow once", exact: true })
  await allow.waitFor({ timeout: 20000 })
  await allow.click()

  await until(
    () => env!.kilo.calls.reply.some((value) => value.requestID === "per_e2e" && value.reply === "once"),
    15000,
    "backend permission reply",
  )
  expect(env!.kilo.calls.reply.some((value) => value.requestID === "per_e2e")).toBe(true)
}, 60000)
