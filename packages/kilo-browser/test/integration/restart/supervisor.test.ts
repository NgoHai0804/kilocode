import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_CONFIG, merge, parse } from "../../../src/config/schema"
import { Supervisor } from "../../../src/bridge/supervisor"

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test("supervisor starts, restarts after exit, and kills its process tree", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-supervisor-"))
  const script = path.join(import.meta.dir, "..", "..", "fixture", "fake-kilo.ts")
  const config = parse(
    merge(DEFAULT_CONFIG, {
      kilo: {
        command: process.execPath,
        args: [script],
        startupTimeoutMs: 5000,
        healthIntervalMs: 100,
        healthTimeoutMs: 500,
        restartMax: 3,
        restartWindowMs: 10000,
      },
      logging: { level: "error" },
    }),
  )
  const events: { type: string; data: Record<string, unknown> }[] = []
  const supervisor = new Supervisor({
    config,
    cwd: workspace,
    onEvent: (event) => events.push(event),
  })
  try {
    const first = await supervisor.start()
    expect(first.url.startsWith("http://127.0.0.1:")).toBe(true)
    expect(first.pid).toBeGreaterThan(0)
    expect(await supervisor.healthy()).toBe(true)
    expect(supervisor.state).toBe("running")

    process.kill(first.pid, "SIGKILL")
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (events.filter((event) => event.type === "kilo.ready").length >= 2 && supervisor.state === "running") break
      await Bun.sleep(50)
    }
    expect(events.some((event) => event.type === "kilo.exit")).toBe(true)
    expect(events.some((event) => event.type === "kilo.ready")).toBe(true)
    expect(supervisor.state).toBe("running")
    const restarted = supervisor.pid
    expect(restarted).toBeDefined()
    await supervisor.stop()
    await Bun.sleep(250)
    expect(alive(restarted!)).toBe(false)
  } finally {
    await supervisor.stop()
    await rm(workspace, { recursive: true, force: true })
  }
}, 20000)

test("supervisor enters degraded after the restart budget is exhausted", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-degraded-"))
  const script = path.join(import.meta.dir, "..", "..", "fixture", "fake-kilo.ts")
  const config = parse(
    merge(DEFAULT_CONFIG, {
      kilo: {
        command: process.execPath,
        args: [script],
        startupTimeoutMs: 5000,
        healthIntervalMs: 100,
        healthTimeoutMs: 500,
        restartMax: 1,
        restartWindowMs: 10000,
      },
      logging: { level: "error" },
    }),
  )
  const events: { type: string }[] = []
  const supervisor = new Supervisor({ config, cwd: workspace, onEvent: (event) => events.push(event) })
  try {
    const first = await supervisor.start()
    process.kill(first.pid, "SIGKILL")
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && events.filter((event) => event.type === "kilo.ready").length < 2) {
      await Bun.sleep(50)
    }
    const restarted = supervisor.pid
    expect(restarted).toBeDefined()
    process.kill(restarted!, "SIGKILL")
    const degraded = Date.now() + 5000
    while (Date.now() < degraded && supervisor.state !== "degraded") {
      await Bun.sleep(50)
    }
    expect(supervisor.state).toBe("degraded")
    expect(events.some((event) => event.type === "kilo.degraded")).toBe(true)
  } finally {
    await supervisor.stop()
    await rm(workspace, { recursive: true, force: true })
  }
}, 20000)