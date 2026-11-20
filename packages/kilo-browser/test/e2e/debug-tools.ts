import { createUiEnv } from "./ui/harness"

const env = await createUiEnv()
async function tool(name: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${env.bridge.url}/tool`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.bridge.token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: `browser.${name}`, params, timeoutMs: 8000 }),
  })
  return (await response.json()) as Record<string, unknown>
}
try {
  env.context.on("serviceworker", (worker) => {
    worker.on("console", (msg) => console.log("[SW]", msg.type(), msg.text()))
  })
  const panel = await env.open("sidepanel.html")
  panel.on("console", (msg) => console.log("[panel]", msg.type(), msg.text()))
  for (let i = 0; i < 40; i++) {
    if (env.bridge.hub.authenticated) break
    await Bun.sleep(250)
  }
  console.log("authenticated:", env.bridge.hub.authenticated)
  console.log("status(before new tab):", JSON.stringify(await tool("status")))

  const page = await env.context.newPage()
  await page.goto(env.fixture.loginUrl)
  await page.bringToFront()
  console.log("new tab url:", page.url())

  for (let i = 0; i < 20; i++) {
    await Bun.sleep(500)
    const status = await tool("status")
    console.log(`status[${i}]:`, JSON.stringify(status))
    const tab = status.result as Record<string, unknown> | undefined
    const inner = tab?.tab as Record<string, unknown> | undefined
    if (typeof inner?.url === "string" && (inner.url as string).includes("/login")) {
      console.log("AUTO-ATTACH OK")
      break
    }
  }
} finally {
  await env.cleanup()
}
