import path from "node:path"
import os from "node:os"
import { createServer } from "node:net"
import { mkdir, rm, statfs, writeFile } from "node:fs/promises"
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { ConfigError, isLoopback, type BrowserConfig } from "../config/schema"
import { checkJail } from "../policy/jail"

export type Check = {
  id: string
  ok: boolean
  detail?: string
  warning?: boolean
}

export type Lock = {
  path: string
  release: () => Promise<void>
}

export type PreflightOptions = {
  workspace: string
  config: BrowserConfig
  skipKilo?: boolean
}

export type PreflightResult = {
  ok: boolean
  checks: Check[]
  lock?: Lock
  running?: {
    healthy: boolean
    runtime?: Record<string, unknown>
  }
}

export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  const workspace = path.resolve(options.workspace)
  const checks: Check[] = []
  const root = path.join(workspace, ".kilo", "kilo-browser")
  const lockPath = path.join(root, "bridge.lock")

  const info = await statSafe(workspace)
  const isDir = info?.isDirectory() ?? false
  checks.push({ id: "workspace", ok: isDir, detail: isDir ? workspace : "workspace does not exist" })
  if (!isDir) return fail(checks)

  try {
    await checkJail([workspace], root)
    await mkdir(root, { recursive: true, mode: 0o700 })
    await chmodBestEffort(root, 0o700)
    checks.push({ id: "state_dir", ok: true, detail: root })
  } catch (err) {
    checks.push({ id: "state_dir", ok: false, detail: message(err) })
    return fail(checks)
  }

  try {
    const probe = path.join(root, `.write-${process.pid}-${Date.now()}`)
    await writeFile(probe, "ok")
    await rm(probe, { force: true })
    checks.push({ id: "writable", ok: true })
  } catch (err) {
    checks.push({ id: "writable", ok: false, detail: message(err) })
    return fail(checks)
  }

  const acquired = await acquireLock(lockPath)
  if (!acquired.ok) {
    checks.push({ id: "lock", ok: false, detail: "bridge lock is held", warning: true })
    return {
      ok: false,
      checks,
      running: { healthy: acquired.healthy, runtime: acquired.runtime },
    }
  }

  if (!isLoopback(options.config.bridge.host)) {
    await acquired.lock.release()
    checks.push({ id: "loopback", ok: false, detail: options.config.bridge.host })
    return fail(checks)
  }
  checks.push({ id: "loopback", ok: true, detail: options.config.bridge.host })

  const git = await isGit(workspace)
  checks.push({
    id: "git",
    ok: true,
    warning: !git,
    detail: git ? "inside git work tree" : "not a git repository; external_directory protection is weaker",
  })

  if (options.skipKilo) {
    checks.push({ id: "kilo", ok: true, warning: true, detail: "spawn skipped" })
  } else {
    const works = await commandWorks(options.config.kilo.command, workspace)
    checks.push({
      id: "kilo",
      ok: works,
      detail: works ? options.config.kilo.command : `cannot run ${options.config.kilo.command} --version`,
    })
  }

  if (options.config.bridge.port !== 0) {
    const free = await portAvailable(options.config.bridge.host, options.config.bridge.port)
    checks.push({ id: "port", ok: free, detail: free ? String(options.config.bridge.port) : "port is in use" })
  } else {
    checks.push({ id: "port", ok: true, detail: "ephemeral" })
  }

  checks.push({ id: "schema", ok: true })

  const free = await freeBytes(workspace)
  checks.push({
    id: "disk",
    ok: free === undefined || free >= 100 * 1024 * 1024,
    warning: free === undefined,
    detail: free === undefined ? "disk usage unavailable" : `${Math.round(free / 1024 / 1024)} MB free`,
  })

  checks.push({
    id: "extension",
    ok: true,
    detail:
      options.config.browser.allowedExtensionIds.length > 0
        ? options.config.browser.allowedExtensionIds.join(",")
        : "pairing required",
  })

  const uid = process.getuid?.()
  checks.push({
    id: "root",
    ok: true,
    warning: uid === 0,
    detail: uid === 0 ? "running as root" : undefined,
  })

  const failed = checks.filter((check) => !check.ok)
  if (failed.length > 0) {
    await acquired.lock.release()
    return fail(checks)
  }
  return { ok: true, checks, lock: acquired.lock }
}

function fail(checks: Check[]): PreflightResult {
  return { ok: false, checks }
}

async function acquireLock(
  file: string,
  retried = false,
): Promise<{ ok: true; lock: Lock } | { ok: false; runtime?: Record<string, unknown>; healthy: boolean }> {
  try {
    const fd = openSync(file, "wx", 0o600)
    writeFileSync(
      fd,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      "utf8",
    )
    closeSync(fd)
    return {
      ok: true,
      lock: {
        path: file,
        async release() {
          await rm(file, { force: true })
        },
      },
    }
  } catch (err) {
    if (codeOf(err) !== "EEXIST") throw new ConfigError("bridge.lock", message(err))
    const runtime = readRuntime(file)
    const healthy = await healthProbe(runtime)
    if (!healthy && !retried) {
      const owner = readLockOwner(file)
      if (owner === undefined || !alive(owner)) {
        try {
          unlinkSync(file)
        } catch (inner) {
          if (codeOf(inner) !== "ENOENT") throw inner
        }
        return acquireLock(file, true)
      }
    }
    return { ok: false, runtime, healthy }
  }
}

function readLockOwner(file: string) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown }
    return typeof parsed.pid === "number" ? parsed.pid : undefined
  } catch (err) {
    if (codeOf(err) === "ENOENT") return undefined
    return undefined
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return codeOf(err) === "EPERM"
  }
}

function readRuntime(lock: string): Record<string, unknown> | undefined {
  const file = path.join(path.dirname(lock), "runtime.json")
  try {
    const text = readFileSync(file, "utf8")
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch (err) {
    if (codeOf(err) === "ENOENT") return undefined
    return undefined
  }
}

async function healthProbe(runtime: Record<string, unknown> | undefined) {
  if (!runtime || typeof runtime.httpUrl !== "string") return false
  try {
    const response = await fetch(`${runtime.httpUrl}/health`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

async function isGit(workspace: string) {
  try {
    const child = Bun.spawn({
      cmd: ["git", "rev-parse", "--is-inside-work-tree"],
      cwd: workspace,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 && out.trim() === "true"
  } catch {
    return false
  }
}

async function commandWorks(command: string, cwd: string) {
  try {
    const child = Bun.spawn({
      cmd: [command, "--version"],
      cwd,
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    })
    const timer = setTimeout(() => child.kill(), 5000)
    const code = await child.exited
    clearTimeout(timer)
    return code === 0
  } catch {
    return false
  }
}

function portAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

async function freeBytes(workspace: string) {
  try {
    const stats = await statfs(workspace)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return undefined
  }
}

async function chmodBestEffort(target: string, mode: number) {
  if (os.platform() === "win32") return
  const { chmod } = await import("node:fs/promises")
  await chmod(target, mode)
}

async function statSafe(target: string) {
  try {
    const { stat } = await import("node:fs/promises")
    return await stat(target)
  } catch {
    return undefined
  }
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function codeOf(err: unknown) {
  if (!(err instanceof Error)) return undefined
  return (err as NodeJS.ErrnoException).code
}



