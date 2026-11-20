import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { BrowserContext, Page } from "@playwright/test"
import { DEFAULT_CONFIG, merge, parse } from "../../../src/config/schema"
import { BridgeServer } from "../../../src/bridge/server"
import { createFakeKilo, type FakeKilo } from "../fake-kilo"
import { browserCandidates, e2eSkipReason, launchExtension, startFixture, until, type Fixture } from "../harness"

const EXTENSION_DIR = path.resolve(import.meta.dir, "../../../extension/dist")

export function uiSkipReason(): string | undefined {
  const reason = e2eSkipReason()
  if (reason) console.warn(`[kilo-browser e2e] skipping UI specs: ${reason}`)
  return reason
}

type ClaimResponse = { ok?: boolean; token?: string; port?: number }

export type UiEnv = {
  context: BrowserContext
  extensionId: string
  browser: string
  bridge: BridgeServer
  kilo: FakeKilo
  fixture: Fixture
  workspace: string
  home: string
  userDataDir: string
  statePath: string
  open: (name: string) => Promise<Page>
  readWorkspaceConfig: () => Promise<Record<string, unknown>>
  readUiState: () => Promise<Record<string, unknown>>
  cleanup: () => Promise<void>
}

/**
 * Launch the real unpacked extension against an in-process bridge with a
 * deterministic fake Kilo backend, then pair through `POST /pair/claim` from the
 * extension origin (no secrets are hardcoded; the bridge token is read back).
 */
export async function createUiEnv(): Promise<UiEnv> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-ws-"))
  const home = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-home-"))
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-profile-"))
  await mkdir(path.join(workspace, ".kilo"), { recursive: true })
  await writeFile(path.join(workspace, ".kilo", "kilo.json"), JSON.stringify({ model: "kilo/auto" }, null, 2))

  const kilo = createFakeKilo()
  const config = parse(
    merge(DEFAULT_CONFIG, {
      browser: { allowedExtensionIds: [], defaultTimeoutMs: 300 },
      logging: { level: "error" },
      bridge: { heartbeatMs: 60_000, pongTimeoutMs: 120_000 },
    }),
  )
  const bridge = new BridgeServer({ workspace, config, kilo: kilo.backend, home })
  await bridge.start()
  const fixture = await startFixture()
  const launched = await launchExtension({ userDataDir, extensionDir: EXTENSION_DIR })

  const pair = async () => {
    const port = bridge.port
    if (typeof port !== "number") throw new Error("bridge did not expose a port")
    const page = await launched.context.newPage()
    await page.goto(`chrome-extension://${launched.extensionId}/ui-dist/sidepanel.html`)
    const claim = await page.evaluate(
      async (input: { port: number; code: string }): Promise<ClaimResponse> => {
        const response = await fetch(`http://127.0.0.1:${input.port}/pair/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pairCode: input.code, extensionId: chrome.runtime.id }),
        })
        return (await response.json()) as ClaimResponse
      },
      { port, code: bridge.pairCode },
    )
    if (!claim.ok || typeof claim.token !== "string") throw new Error(`pair/claim failed: ${JSON.stringify(claim)}`)
    const claimedPort = typeof claim.port === "number" ? claim.port : port
    await page.evaluate(
      (value: { token: string; port: number }) => {
        localStorage.setItem("kilo.browser.bridge.token", value.token)
        localStorage.setItem("kilo.browser.bridge.port", String(value.port))
      },
      { token: claim.token, port: claimedPort },
    )
    await page.close()
  }

  try {
    await pair()
  } catch (err) {
    await launched.context.close().catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
    await bridge.stop()
    fixture.stop()
    await rm(userDataDir, { recursive: true, force: true }).catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
    await rm(workspace, { recursive: true, force: true }).catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
    await rm(home, { recursive: true, force: true }).catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
    throw err
  }

  const statePath = path.join(workspace, ".kilo", "kilo-browser", "ui-state.json")

  return {
    context: launched.context,
    extensionId: launched.extensionId,
    browser: launched.label,
    bridge,
    kilo,
    fixture,
    workspace,
    home,
    userDataDir,
    statePath,
    open: async (name) => {
      const page = await launched.context.newPage()
      await page.goto(`chrome-extension://${launched.extensionId}/ui-dist/${name}`)
      return page
    },
    readWorkspaceConfig: readJsonFile(path.join(workspace, ".kilo", "kilo.json")),
    readUiState: readJsonFile(statePath),
    cleanup: async () => {
      await launched.context.close().catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
      await bridge.stop()
      fixture.stop()
      await rm(userDataDir, { recursive: true, force: true }).catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
      await rm(workspace, { recursive: true, force: true }).catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
      await rm(home, { recursive: true, force: true }).catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
    },
  }
}

function readJsonFile(file: string) {
  return async () => {
    if (!existsSync(file)) return {}
    const text = await readFile(file, "utf8")
    if (text.trim().length === 0) return {}
    return JSON.parse(text) as Record<string, unknown>
  }
}

/** Wait until a UI page has connected to the bridge. */
export async function waitForBridge(env: UiEnv, timeoutMs = 15000) {
  if (browserCandidates().length === 0) throw new Error("no browser")
  await until(() => env.bridge.ui.connected, timeoutMs, "UI websocket to connect")
}

/** Type a prompt into the shared composer and submit it. */
export async function sendPrompt(page: Page, text: string) {
  const input = page.locator("textarea.prompt-input").first()
  await input.waitFor({ timeout: 20000 })
  await input.click()
  await input.pressSequentially(text, { delay: 5 })
  await page.getByRole("button", { name: "Send", exact: true }).click()
}



