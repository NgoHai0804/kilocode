import { afterAll, beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { createUiEnv, uiSkipReason, type UiEnv } from "./harness"

const reason = uiSkipReason()
let env: UiEnv | undefined

beforeAll(async () => {
  if (!reason) env = await createUiEnv()
}, 60000)

afterAll(async () => {
  if (env) await env.cleanup()
}, 30000)

test.skipIf(Boolean(reason))("renders a file link in the read-only viewer", async () => {
  const target = "sample-viewer.txt"
  await Bun.write(path.join(env!.workspace, target), "hello from the kilo file viewer\n")
  const page = await env!.open(`file.html?path=${encodeURIComponent(target)}`)
  await page.getByText(target, { exact: true }).waitFor({ timeout: 20000 })
  await page.locator("[data-component='file-viewer']").first().waitFor({ timeout: 20000 })
  // Pierre renders into an open shadow root; its line elements prove the file
  // content (not just the header) rendered from the bridge response.
  await page.locator("diffs-container [data-line]").first().waitFor({ timeout: 20000 })
  expect(await page.locator("diffs-container [data-line]").count()).toBeGreaterThan(0)
}, 60000)