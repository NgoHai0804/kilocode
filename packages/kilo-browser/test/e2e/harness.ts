import { chromium, type BrowserContext } from "@playwright/test"
import { existsSync } from "node:fs"
import path from "node:path"

/**
 * Shared E2E harness plumbing: browser discovery with explicit skip reasons,
 * extension loading, and the fixture app.
 *
 * The specs must never hardcode a port or a secret. Everything here is derived
 * from the environment or the running bridge.
 */

export const EXTENSION_DIR = path.resolve(import.meta.dir, "../../extension/dist")

export type Candidate = { path: string; label: string }

function push(list: Candidate[], value: string | undefined, label: string) {
  if (value && existsSync(value)) list.push({ path: value, label })
}

/**
 * Chromium-family executables that can load an unpacked extension.
 *
 * Priority: explicit override, Playwright's bundled Chromium, Chrome for
 * Testing, Microsoft Edge, then branded Chrome. Branded Chrome 137+ ignores
 * `--load-extension`, so it is last and the launcher retries the next candidate
 * when no service worker appears.
 */
export function browserCandidates(): Candidate[] {
  const list: Candidate[] = []
  push(list, process.env["KILO_E2E_BROWSER"], "KILO_E2E_BROWSER")
  try {
    push(list, chromium.executablePath(), "playwright-chromium")
  } catch (err) {
    if (process.env["KILO_E2E_DEBUG"]) console.warn("playwright chromium unavailable", err)
  }
  const env = process.env
  if (process.platform === "win32") {
    push(list, path.join(env["PROGRAMFILES"] ?? "C:/Program Files", "Google/Chrome for Testing/chrome.exe"), "chrome-for-testing")
    push(list, path.join(env["LOCALAPPDATA"] ?? "", "Google/Chrome for Testing/chrome.exe"), "chrome-for-testing")
    push(list, path.join(env["PROGRAMFILES(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"), "edge")
    push(list, path.join(env["PROGRAMFILES"] ?? "C:/Program Files", "Microsoft/Edge/Application/msedge.exe"), "edge")
    push(list, path.join(env["PROGRAMFILES"] ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"), "chrome")
    push(list, path.join(env["PROGRAMFILES(x86)"] ?? "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"), "chrome")
    push(list, path.join(env["LOCALAPPDATA"] ?? "", "Google/Chrome/Application/chrome.exe"), "chrome")
    return list
  }
  if (process.platform === "darwin") {
    push(list, "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-for-testing")
    push(list, "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "edge")
    push(list, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "chrome")
    push(list, "/Applications/Chromium.app/Contents/MacOS/Chromium", "chromium")
    return list
  }
  push(list, "/usr/bin/microsoft-edge", "edge")
  push(list, "/usr/bin/google-chrome", "chrome")
  push(list, "/usr/bin/google-chrome-stable", "chrome")
  push(list, "/usr/bin/chromium", "chromium")
  push(list, "/usr/bin/chromium-browser", "chromium")
  return list
}

/** Explicit skip reason when no browser/extension is available, never a silent pass. */
export function e2eSkipReason(): string | undefined {
  if (browserCandidates().length === 0) {
    return "no Chromium-based browser found; install Chrome for Testing/Chromium or set KILO_E2E_BROWSER to an executable path"
  }
  if (!existsSync(path.join(EXTENSION_DIR, "manifest.json"))) {
    return `extension build missing at ${EXTENSION_DIR}; run 'bun run build:extension' first`
  }
  return undefined
}

async function serviceWorker(context: BrowserContext, timeoutMs: number) {
  const existing = context.serviceWorkers()[0]
  if (existing) return existing
  try {
    return await context.waitForEvent("serviceworker", { timeout: timeoutMs })
  } catch (err) {
    if (process.env["KILO_E2E_DEBUG"]) console.warn("service worker wait failed", err)
    return undefined
  }
}

export type Launched = { context: BrowserContext; extensionId: string; label: string }

export type LaunchOptions = {
  userDataDir: string
  extensionDir: string
  timeoutMs?: number
}

export async function launchExtension(options: LaunchOptions): Promise<Launched> {
  const candidates = browserCandidates()
  const failures: string[] = []
  for (const candidate of candidates) {
    let context: BrowserContext | undefined
    try {
      context = await chromium.launchPersistentContext(options.userDataDir, {
        headless: false,
        executablePath: candidate.path,
        args: [
          `--disable-extensions-except=${options.extensionDir}`,
          `--load-extension=${options.extensionDir}`,
          "--disable-features=DisableLoadExtensionCommandLineSwitch",
          "--no-first-run",
          "--no-default-browser-check",
        ],
        viewport: { width: 1000, height: 800 },
      })
      const worker = await serviceWorker(context, options.timeoutMs ?? 8000)
      if (!worker) {
        await context.close()
        failures.push(`${candidate.label}: extension service worker did not start (backend may ignore --load-extension)`)
        continue
      }
      const extensionId = new URL(worker.url()).host
      if (!extensionId) {
        await context.close()
        failures.push(`${candidate.label}: extension id missing from ${worker.url()}`)
        continue
      }
      return { context, extensionId, label: candidate.label }
    } catch (err) {
      if (context) await context.close().catch((err: unknown) => { if (process.env["KILO_E2E_DEBUG"]) console.warn("kilo e2e cleanup error", err) })
      failures.push(`${candidate.label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`could not launch a Chromium browser with the extension loaded:\n${failures.join("\n")}`)
}

export type Fixture = { url: string; loginUrl: string; stop: () => void }

/** Real fixture app from `test/fixture/app` on an OS-assigned port. */
export async function startFixture(): Promise<Fixture> {
  const { start } = await import("../fixture/app")
  const server = start(0)
  return {
    url: `http://127.0.0.1:${server.port}`,
    loginUrl: `http://127.0.0.1:${server.port}/login`,
    stop: () => server.stop(true),
  }
}

export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
  label = "condition",
  intervalMs = 100,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await Bun.sleep(intervalMs)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
}

