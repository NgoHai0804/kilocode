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

test.skipIf(Boolean(reason))("streams a prompt response into the transcript without reloading", async () => {
  const page = await env!.open("sidepanel.html")
  await waitForBridge(env!)

  const prompt = `hello ${Date.now()}`
  await page.evaluate(() => {
    ;(window as Window & { __kiloE2EAlive?: boolean }).__kiloE2EAlive = true
  })
  await sendPrompt(page, prompt)

  await until(() => env!.kilo.calls.promptAsync.length > 0, 15000, "backend promptAsync call")
  const call = env!.kilo.calls.promptAsync.at(-1)!
  expect(JSON.stringify(call.parts)).toContain(prompt)
  const sessionID = call.sessionID
  expect(typeof sessionID).toBe("string")

  await until(
    async () => (await page.evaluate(() => document.body.innerText)).includes(prompt),
    15000,
    "optimistic user prompt to render",
  )

  const marker = `STREAM_${Math.random().toString(36).slice(2, 10)}`
  env!.kilo.emit({
    channel: "ui",
    type: "message.updated",
    data: { info: { id: "msg_e2e", sessionID, role: "assistant", time: { created: Date.now() } } },
  })
  env!.kilo.emit({
    channel: "ui",
    type: "message.part.delta",
    data: { sessionID, messageID: "msg_e2e", partID: "prt_e2e", field: "text", delta: marker },
  })

  await until(
    async () => (await page.evaluate(() => document.body.innerText)).includes(marker),
    15000,
    "streamed delta to render",
  )

  const alive = await page.evaluate(() => (window as Window & { __kiloE2EAlive?: boolean }).__kiloE2EAlive === true)
  expect(alive).toBe(true)
}, 60000)

