import { afterAll, beforeAll, expect, test } from "bun:test"
import { until } from "./harness"
import { createUiEnv, uiSkipReason, type UiEnv } from "./ui/harness"

/**
 * End-to-end proof that the agent drives a real browser through the bridge +
 * extension with no manual tab pick: the extension auto-attaches to the active
 * tab, and `browser.*` tools then act on that live page.
 */

const reason = uiSkipReason()
let env: UiEnv | undefined

beforeAll(async () => {
  if (!reason) env = await createUiEnv()
}, 60000)

afterAll(async () => {
  if (env) await env.cleanup()
}, 30000)

async function tool(name: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${env!.bridge.url}/tool`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env!.bridge.token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: `browser.${name}`, params, timeoutMs: 8000 }),
  })
  return (await response.json()) as { ok: boolean; result?: Record<string, unknown>; error?: { data?: { kind?: string } } }
}

function settled(promise: Promise<void>): Promise<boolean> {
  return promise.then(() => true).catch(() => false)
}

test.skipIf(Boolean(reason))("auto-attaches the active tab and drives it without a manual pick", async () => {
  const steps: Record<string, unknown> = {}
  try {
    const sidepanel = await env!.open("sidepanel.html")
    await until(() => env!.bridge.hub.authenticated, 20000, "extension tool channel")
    // Drop the panel so the fixture tab is the only active tab; the WS keeps the
    // worker alive, and auto-attach must target the page the user is viewing.
    await sidepanel.close()

    // A brand-new tab the user just opened; the agent must follow it on its own.
    const page = await env!.context.newPage()
    await page.goto(env!.fixture.loginUrl)
    await page.bringToFront()

    steps.attached = await settled(
      until(
        async () => {
          const status = await tool("status")
          const tab = status.result?.tab as Record<string, unknown> | undefined
          return typeof tab?.url === "string" && (tab.url as string).includes("/login")
        },
        30000,
        "auto-attach to the new active tab",
        500,
      ),
    )
    expect(steps.attached).toBe(true)

    const status = await tool("status")
    steps.status = status
    expect(status.ok).toBe(true)
    const tab = status.result?.tab as Record<string, unknown> | undefined
    expect(String(tab?.url ?? "")).toContain("/login")
    expect(status.result?.cdp).toBe(true)

    const snapshot = await tool("snapshot")
    steps.snapshot = snapshot
    expect(snapshot.ok).toBe(true)
    expect(String(snapshot.result?.text ?? "")).toContain("Sign in")

    const click = await tool("click", { selector: "#save" })
    steps.click = click
    expect(click.ok).toBe(true)
    expect(click.result?.clicked).toBe(true)

    // The real page reacted to the agent's click.
    steps.reacted = await settled(
      until(async () => (await page.locator("#status").innerText()) === "Save failed", 10000, "page status"),
    )
    expect(steps.reacted).toBe(true)

    const waited = await tool("wait_for", { text: "Save failed" })
    steps.waited = waited
    expect(waited.ok).toBe(true)
    expect(waited.result?.matched).toBe(true)

    const logged = await tool("console")
    steps.console = logged
    expect(logged.ok).toBe(true)
    expect(JSON.stringify(logged.result)).toContain("Failed to save")

    const network = await tool("network")
    steps.network = network
    expect(network.ok).toBe(true)
    expect(JSON.stringify(network.result)).toContain("/api/save")
  } finally {
    await Bun.write("test/e2e/tools-last.json", JSON.stringify(steps, null, 2))
  }
}, 90000)
