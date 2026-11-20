import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { BROWSER_PERMISSIONS, DEFAULT_CONFIG } from "../../src/config/schema"
import { GUARD_MARKER, ensureBrowserConfig, ensureGuard, generateKiloConfig, guardModule } from "../../src/config/generate"
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

async function workspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-config-"))
  await mkdir(path.join(dir, ".kilo"), { recursive: true })
  return dir
}

test("fresh generation writes the exact spec blocks", async () => {
  const dir = await workspace()
  try {
    const result = await generateKiloConfig({ workspace: dir })
    const config = result.config
    const permission = config.permission as Record<string, string>
    expect(Object.keys(permission)).toEqual(Object.keys(BROWSER_PERMISSIONS))
    expect(permission).toEqual(BROWSER_PERMISSIONS)
    expect(config.instructions).toEqual([".kilo/kilo-browser/AGENTS.md"])
    expect(config.plugin).toEqual(["./.kilo/plugins/kilo-browser-guard.ts"])

    const mcp = (config.mcp as Record<string, Record<string, unknown>>).browser!
    expect(mcp.type).toBe("local")
    expect(mcp.enabled).toBe(true)
    expect(mcp.timeout).toBe(60000)
    const command = mcp.command as string[]
    const runtime = path.join(dir, ".kilo", "kilo-browser", "runtime.json")
    expect(command.slice(-2)).toEqual(["--runtime", runtime])
    expect(command.slice(0, -2).every((item) => path.isAbsolute(item) || item === process.execPath)).toBe(true)
    expect((mcp.environment as Record<string, string>).KILO_BROWSER_RUNTIME).toBe(runtime)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("merge preserves user keys, values, and ordering", async () => {
  const dir = await workspace()
  const file = path.join(dir, ".kilo", "kilo.json")
  const existing = {
    $schema: "https://app.kilo.ai/config.json",
    custom: { keep: true },
    permission: { browser_navigate: "ask", bash: "allow" },
    instructions: ["docs/custom.md"],
    plugin: ["./custom-plugin.ts"],
    mcp: { other: { type: "local", command: ["echo"], enabled: true } },
  }
  await Bun.write(file, `${JSON.stringify(existing, null, 2)}\n`)
  try {
    const result = await generateKiloConfig({ workspace: dir })
    const config = result.config
    expect(config.custom).toEqual({ keep: true })
    const permission = config.permission as Record<string, string>
    expect(permission.browser_navigate).toBe("ask")
    expect(permission.bash).toBe("allow")
    expect(permission.external_directory).toBe("deny")
    expect(permission.browser_eval).toBe("deny")
    expect(config.instructions).toEqual(["docs/custom.md", ".kilo/kilo-browser/AGENTS.md"])
    expect(config.plugin).toEqual(["./custom-plugin.ts", "./.kilo/plugins/kilo-browser-guard.ts"])
    expect((config.mcp as Record<string, unknown>).other).toEqual(existing.mcp.other)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("generation is idempotent and does not rewrite an already merged file", async () => {
  const dir = await workspace()
  try {
    const first = await generateKiloConfig({ workspace: dir })
    const second = await generateKiloConfig({ workspace: dir })
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("existing .kilo/kilo-browser.json is never overwritten", async () => {
  const dir = await workspace()
  const file = path.join(dir, ".kilo", "kilo-browser.json")
  const custom = { ...DEFAULT_CONFIG, browser: { ...DEFAULT_CONFIG.browser, defaultTimeoutMs: 99 } }
  await Bun.write(file, `${JSON.stringify(custom, null, 2)}\n`)
  const before = await Bun.file(file).text()
  try {
    const result = await ensureBrowserConfig(dir)
    expect(result.created).toBe(false)
    expect(await Bun.file(file).text()).toBe(before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("generated guard plugin imports an absolute working module", async () => {
  const dir = await workspace()
  try {
    const first = await ensureGuard(dir)
    expect(first.created).toBe(true)
    const file = path.join(dir, ".kilo", "plugins", "kilo-browser-guard.ts")
    const source = await Bun.file(file).text()
    expect(source.startsWith(GUARD_MARKER)).toBe(true)
    const match = /from "(.+)"/.exec(source)
    expect(match?.[1]).toBeDefined()
    const target = fileURLToPath(match![1]!)
    expect(path.isAbsolute(target)).toBe(true)
    expect(existsSync(target)).toBe(true)
    expect(target).toBe(guardModule())

    const second = await ensureGuard(dir)
    expect(second.created).toBe(false)
    expect(await Bun.file(file).text()).toBe(source)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("stale generated guard entries are refreshed but user files are left alone", async () => {
  const dir = await workspace()
  try {
    const file = path.join(dir, ".kilo", "plugins", "kilo-browser-guard.ts")
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, `${GUARD_MARKER}\nexport { default } from "file:///stale/path.ts"\n`)
    await ensureGuard(dir)
    expect(await Bun.file(file).text()).toContain(pathToFileURL(guardModule()).href)
    await Bun.write(file, "// user-owned plugin\nexport default async () => ({})\n")
    const before = await Bun.file(file).text()
    const result = await ensureGuard(dir)
    expect(result.created).toBe(false)
    expect(await Bun.file(file).text()).toBe(before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})