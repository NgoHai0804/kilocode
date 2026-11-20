import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import guard from "../../src/plugin/kilo-browser-guard"

type Config = Record<string, unknown>

async function sandbox(config?: Config) {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-guard-"))
  const root = path.join(base, "root")
  const outside = path.join(base, "outside")
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(path.join(root, "inside.txt"), "ok")
  await writeFile(path.join(outside, "secret.txt"), "no")
  const merged: Config = { logging: { level: "error" }, ...(config ?? {}) }
  await mkdir(path.join(root, ".kilo"), { recursive: true })
  await writeFile(path.join(root, ".kilo", "kilo-browser.json"), `${JSON.stringify(merged, null, 2)}\n`)
  const hooks = await guard({ directory: root, worktree: root })
  return { base, root, outside, hooks }
}

async function reject(fn: () => Promise<unknown>) {
  const failure = await fn().then(() => undefined, (err: unknown) => err)
  expect(failure).toBeInstanceOf(Error)
  return failure as Error
}

test("read, write, edit, glob, grep and list cannot escape the workspace", async () => {
  const { base, root, outside, hooks } = await sandbox()
  try {
    const target = path.join(outside, "secret.txt")
    await reject(() => hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: target } }))
    await reject(() => hooks["tool.execute.before"]({ tool: "write" }, { args: { filePath: "../outside/x.txt", content: "x" } }))
    await reject(() => hooks["tool.execute.before"]({ tool: "edit" }, { args: { filePath: target } }))
    await reject(() => hooks["tool.execute.before"]({ tool: "glob" }, { args: { pattern: path.join(outside, "*.txt") } }))
    await reject(() => hooks["tool.execute.before"]({ tool: "grep" }, { args: { pattern: "x", path: outside } }))
    await reject(() => hooks["tool.execute.before"]({ tool: "list" }, { args: { path: outside } }))
    await hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: "inside.txt" } })
    await hooks["tool.execute.before"]({ tool: "write" }, { args: { filePath: path.join(root, "new.txt"), content: "x" } })
    await hooks["tool.execute.before"]({ tool: "glob" }, { args: { pattern: "*.ts" } })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("bash best-effort scan denies absolute writes outside the jail", async () => {
  const { base, root, outside, hooks } = await sandbox()
  const target = path.join(outside, "written.txt")
  const inside = path.join(root, "inside.txt")
  const commands = [
    `echo x > "${target}"`,
    `echo x >> "${target}"`,
    `echo x | tee "${target}"`,
    `cp a "${target}"`,
    `mv a "${target}"`,
    `rm "${target}"`,
    `curl -o "${target}" http://localhost:3000`,
    `wget -O "${target}" http://localhost:3000`,
    `Out-File "${target}"`,
    `Set-Content "${target}"`,
  ]
  try {
    for (const command of commands) {
      const failure = await reject(() => hooks["tool.execute.before"]({ tool: "bash" }, { args: { command } }))
      expect(failure.message).toContain("bash_path_escape")
    }
    await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: `echo x > "${inside}"` } })
    await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "npm test" } })
    await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "echo x 2>/dev/null" } })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("browser tools reject file, chrome, devtools, data and javascript schemes", async () => {
  const { base, hooks } = await sandbox()
  try {
    const urls = [
      "file:///C:/Windows/win.ini",
      "chrome://settings",
      "devtools://devtools/bundled/inspector.html",
      "data:text/html,<h1>x</h1>",
      "javascript:alert(1)",
    ]
    for (const url of urls) {
      const failure = await reject(() => hooks["tool.execute.before"]({ tool: "browser_navigate" }, { args: { url } }))
      expect(failure.message).toContain("blocked_scheme")
    }
    await hooks["tool.execute.before"]({ tool: "browser_navigate" }, { args: { url: "about:blank" } })
    await hooks["tool.execute.before"]({ tool: "browser_navigate" }, { args: { url: "http://localhost:3000/login" } })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("any http/https origin is controllable without allowlist configuration", async () => {
  const { base, hooks } = await sandbox()
  try {
    await hooks["tool.execute.before"]({ tool: "browser_navigate" }, { args: { url: "https://staging.example.com/app" } })
    await hooks["tool.execute.before"]({ tool: "browser_navigate" }, { args: { url: "https://any.example.org/path?q=1" } })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("browser_eval is denied by default and ask when configured", async () => {
  const denied = await sandbox()
  try {
    await reject(() => denied.hooks["tool.execute.before"]({ tool: "browser_eval" }, { args: { expression: "1+1" } }))
    const status = { status: "allow" as "allow" | "ask" | "deny" }
    await denied.hooks["permission.ask"]({ type: "browser_eval" }, status)
    expect(status.status).toBe("deny")
  } finally {
    await rm(denied.base, { recursive: true, force: true })
  }

  const asked = await sandbox({ tools: { eval: "ask" } })
  try {
    const status = { status: "allow" as "allow" | "ask" | "deny" }
    await asked.hooks["permission.ask"]({ type: "browser_eval" }, status)
    expect(status.status).toBe("ask")
    await asked.hooks["tool.execute.before"]({ tool: "browser_eval" }, { args: { expression: "1+1" } })
  } finally {
    await rm(asked.base, { recursive: true, force: true })
  }
})

test("permission.ask denies external paths and browser origins", async () => {
  const { base, outside, hooks } = await sandbox()
  try {
    const ext = { status: "allow" as "allow" | "ask" | "deny" }
    await hooks["permission.ask"]({ type: "external_directory", pattern: [path.join(outside, "secret.txt")] }, ext)
    expect(ext.status).toBe("deny")

    const read = { status: "allow" as "allow" | "ask" | "deny" }
    await hooks["permission.ask"]({ type: "read", pattern: [outside] }, read)
    expect(read.status).toBe("deny")

    const nav = { status: "allow" as "allow" | "ask" | "deny" }
    await hooks["permission.ask"]({ type: "browser_navigate", metadata: { mcpInput: { url: "file:///etc/passwd" } } }, nav)
    expect(nav.status).toBe("deny")
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("tool.execute.after redacts browser output", async () => {
  const { base, hooks } = await sandbox()
  try {
    const output = {
      output: "Authorization: Bearer abcdefghij",
      metadata: { cookie: "sid=abcdef", "x-api-key": "sk-abcdefghijklmnopqrstuvwx" },
    }
    await hooks["tool.execute.after"]({ tool: "browser_console" }, output)
    const text = JSON.stringify(output)
    expect(text).not.toContain("abcdefghij")
    expect(text).not.toContain("sid=abcdef")
    expect(text).toContain("[REDACTED]")
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("two guard instances keep their own workspace roots", async () => {
  const a = await sandbox()
  const b = await sandbox()
  try {
    const shared = path.join(a.root, "inside.txt")
    await a.hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: shared } })
    await reject(() => b.hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: shared } }))
  } finally {
    await rm(a.base, { recursive: true, force: true })
    await rm(b.base, { recursive: true, force: true })
  }
})
test("jail denials are logged with root and resolved path", async () => {
  const { base, root, outside, hooks } = await sandbox({ logging: { level: "warn" } })
  try {
    const target = path.join(outside, "secret.txt")
    await reject(() => hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: target } }))
    const file = path.join(root, ".kilo", "kilo-browser", "logs", "bridge.jsonl")
    const deadline = Date.now() + 3000
    let text = ""
    while (Date.now() < deadline) {
      if (await Bun.file(file).exists()) {
        text = await Bun.file(file).text()
        if (text.includes("jail.deny")) break
      }
      await Bun.sleep(25)
    }
    expect(text).toContain('"event":"jail.deny"')
    expect(text).toContain('"root"')
    expect(text).toContain('"resolved"')
    expect(text).toContain('"path"')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})