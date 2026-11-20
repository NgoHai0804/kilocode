import { randomBytes } from "node:crypto"
import type { BrowserConfig } from "../config/schema"

export type SpawnInfo = {
  url: string
  pid: number
}

export type SupervisorOptions = {
  config: BrowserConfig
  cwd: string
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
  onReady?: (info: SpawnInfo) => void
}

type Process = ReturnType<typeof Bun.spawn>

export class Supervisor {
  private readonly config: BrowserConfig
  private readonly cwd: string
  private readonly onEvent?: SupervisorOptions["onEvent"]
  private readonly onReady?: SupervisorOptions["onReady"]
  private readonly password = randomBytes(32).toString("hex")
  private readonly username = "kilo"
  private child?: Process
  private url?: string
  private stopping = false
  private healthTimer?: ReturnType<typeof setInterval>
  private restartTimer?: ReturnType<typeof setTimeout>
  private failures = 0
  private restarts: number[] = []
  private degraded = false
  private ready = false

  constructor(options: SupervisorOptions) {
    this.config = options.config
    this.cwd = options.cwd
    this.onEvent = options.onEvent
    this.onReady = options.onReady
  }

  get credentials() {
    return { username: this.username, password: this.password }
  }

  get endpoint() {
    return this.url
  }

  get pid() {
    return this.child?.pid
  }

  get state() {
    if (this.stopping) return "stopped"
    if (this.degraded) return "degraded"
    return this.child ? "running" : "stopped"
  }

  async start(): Promise<SpawnInfo> {
    this.stopping = false
    const info = await this.spawn()
    this.startHealth()
    return info
  }

  async stop() {
    this.stopping = true
    this.ready = false
    if (this.healthTimer) clearInterval(this.healthTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.healthTimer = undefined
    this.restartTimer = undefined
    const pid = this.child?.pid
    if (pid) await this.kill(pid, false)
    this.child = undefined
    this.url = undefined
  }

  async healthy() {
    if (!this.url) return false
    try {
      const response = await fetch(`${this.url}/global/health`, {
        headers: { Authorization: this.authHeader() },
        signal: AbortSignal.timeout(this.config.kilo.healthTimeoutMs),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async spawn(): Promise<SpawnInfo> {
    const args = this.config.kilo.args.length > 0 ? this.config.kilo.args : ["serve", "--port", "0", "--hostname", "127.0.0.1"]
    const child = Bun.spawn({
      cmd: [this.config.kilo.command, ...args],
      cwd: this.cwd,
      env: {
        ...process.env,
        KILO_SERVER_USERNAME: this.username,
        KILO_SERVER_PASSWORD: this.password,
        KILO_PARENT_PID: String(process.pid),
        KILO_CLIENT: "kilo-browser",
      },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
      detached: process.platform !== "win32",
    })
    this.child = child
    this.onEvent?.({ type: "kilo.spawn", data: { pid: child.pid } })

    const deferred = Promise.withResolvers<SpawnInfo>()
    let buffer = ""
    let settled = false
    const finish = (value: SpawnInfo) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      deferred.resolve(value)
    }
    const fail = (reason: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      deferred.reject(new Error(reason))
    }
    const inspect = (chunk: string) => {
      buffer += chunk
      if (buffer.length > 64 * 1024) buffer = buffer.slice(-32 * 1024)
      const match = /kilo server listening on http:\/\/([^:\s]+):(\d+)/.exec(buffer)
      if (!match) return
      const url = `http://${match[1]}:${match[2]}`
      void this.waitHealthy(url)
        .then((ok) => (ok ? finish({ url, pid: child.pid }) : fail("kilo health check failed")))
        .catch((err: unknown) => fail(err instanceof Error ? err.message : "kilo health check failed"))
    }

    const timer = setTimeout(() => fail("timed out waiting for kilo server"), this.config.kilo.startupTimeoutMs)
    const output = (stream: ReadableStream<Uint8Array> | number) => {
      if (typeof stream === "number") return
      void readLines(stream, inspect).catch((err: unknown) => {
        this.onEvent?.({
          type: "kilo.output.error",
          data: { message: err instanceof Error ? err.message : "output stream failed" },
        })
      })
    }
    output(child.stdout)
    output(child.stderr)

    void child.exited.then((code) => {
      this.onEvent?.({ type: "kilo.exit", data: { pid: child.pid, code } })
      if (this.child?.pid === child.pid) this.child = undefined
      if (!settled) fail(`kilo exited before listening (code ${code})`)
      this.restart()
    })

    try {
      const info = await deferred.promise
      this.url = info.url
      this.ready = true
      this.degraded = false
      this.failures = 0
      this.onEvent?.({ type: "kilo.ready", data: { pid: info.pid, url: info.url } })
      return info
    } catch (err) {
      await this.kill(child.pid, true)
      throw err
    }
  }

  private async waitHealthy(url: string) {
    const deadline = Date.now() + this.config.kilo.startupTimeoutMs
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${url}/global/health`, {
          headers: { Authorization: this.authHeader() },
          signal: AbortSignal.timeout(this.config.kilo.healthTimeoutMs),
        })
        if (response.ok) return true
      } catch (err) {
        if (!(err instanceof Error)) throw err
      }
      await Bun.sleep(200)
    }
    return false
  }

  private startHealth() {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = setInterval(() => {
      void this.checkHealth()
    }, this.config.kilo.healthIntervalMs)
  }

  private async checkHealth() {
    if (this.stopping || !this.child) return
    const ok = await this.healthy()
    if (ok) {
      this.failures = 0
      return
    }
    this.failures += 1
    this.onEvent?.({ type: "kilo.health.fail", data: { failures: this.failures } })
    if (this.failures < 3) return
    const pid = this.child.pid
    this.onEvent?.({ type: "kilo.hung", data: { pid } })
    await this.kill(pid, false)
  }

  private restart() {
    if (this.stopping) return
    if (this.restartTimer) return
    const now = Date.now()
    this.restarts = this.restarts.filter((stamp) => now - stamp < this.config.kilo.restartWindowMs)
    if (this.restarts.length >= this.config.kilo.restartMax) {
      this.degraded = true
      this.onEvent?.({ type: "kilo.degraded", data: { restarts: this.restarts.length } })
      return
    }
    const delay = [1000, 2000, 4000, 8000, 8000][this.restarts.length] ?? 8000
    this.restarts.push(now)
    this.onEvent?.({ type: "kilo.restart", data: { attempt: this.restarts.length, delayMs: delay } })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.spawn()
        .then((info) => {
          this.failures = 0
          this.ready = true
          this.degraded = false
          this.startHealth()
          this.onReady?.(info)
        })
        .catch((err: unknown) => {
          this.onEvent?.({
            type: "kilo.restart.failed",
            data: { reason: err instanceof Error ? err.message : "restart failed" },
          })
          this.restart()
        })
    }, delay)
  }

  private async kill(pid: number, force: boolean) {
    if (pid === process.pid) return
    if (process.platform === "win32") {
      const args = ["/PID", String(pid), "/T"]
      if (force) args.push("/F")
      const child = Bun.spawn({
        cmd: ["taskkill", ...args],
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
      })
      await child.exited
      if (force) return
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (!alive(pid)) return
        await Bun.sleep(100)
      }
      await this.kill(pid, true)
      return
    }
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM")
    } catch (err) {
      if (codeOf(err) === "ESRCH") return
      try {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM")
      } catch (inner) {
        if (codeOf(inner) !== "ESRCH") throw inner
      }
    }
    if (!force) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (!alive(pid)) return
        await Bun.sleep(100)
      }
      await this.kill(pid, true)
    }
  }

  private authHeader() {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`
  }
}

async function readLines(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    onChunk(decoder.decode(value, { stream: true }))
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

function codeOf(err: unknown) {
  if (!(err instanceof Error)) return undefined
  return (err as NodeJS.ErrnoException).code
}

