import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { ArtifactStore } from "../../src/artifacts/store"
import {
  cleanupArtifacts,
  ensureIgnore,
  ensureSession,
  ensureTemplates,
  memoryPaths,
  seed,
  writeNote,
} from "../../src/bridge/memory"
import { generateKiloConfig, INSTRUCTIONS_ENTRY } from "../../src/config/generate"

async function workspace() {
  return mkdtemp(path.join(os.tmpdir(), "kilo-browser-memory-"))
}

test("templates seed once and never overwrite user edits", async () => {
  const ws = await workspace()
  try {
    const first = await ensureTemplates(ws)
    expect(first.created.length).toBe(2)
    expect(first.skipped.length).toBe(0)
    const paths = memoryPaths(ws)
    expect(await Bun.file(paths.agents).exists()).toBe(true)
    expect(await Bun.file(paths.memory).exists()).toBe(true)

    const custom = "# Memory\n\nUser edited content.\n"
    await writeFile(paths.memory, custom)
    const before = await Bun.file(paths.memory).text()

    const second = await ensureTemplates(ws)
    expect(second.created.length).toBe(0)
    expect(second.skipped.length).toBe(2)
    expect(await Bun.file(paths.memory).text()).toBe(before)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("seed is an alias for ensureTemplates and stays idempotent", async () => {
  const ws = await workspace()
  try {
    expect((await seed(ws)).created.length).toBe(2)
    expect((await seed(ws)).created.length).toBe(0)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("seeding ignores the generated bridge state and keeps existing rules", async () => {
  const ws = await workspace()
  try {
    const file = path.join(ws, ".kilo", ".gitignore")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "node_modules\nagent-manager.json\n")

    await ensureTemplates(ws)
    const text = await Bun.file(file).text()
    const lines = text.split(/\r?\n/).map((line) => line.trim())
    expect(lines).toContain("node_modules")
    expect(lines).toContain("agent-manager.json")
    expect(lines).toContain("kilo-browser/")
    expect(lines).toContain("plugins/kilo-browser-guard.ts")

    expect(await ensureIgnore(ws)).toBe(false)
    expect(await Bun.file(file).text()).toBe(text)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("seeding writes the ignore file when the workspace has none", async () => {
  const ws = await workspace()
  try {
    await seed(ws)
    const text = await Bun.file(path.join(ws, ".kilo", ".gitignore")).text()
    expect(text.endsWith("\n")).toBe(true)
    expect(text).toContain("kilo-browser/")
    expect(text).not.toContain("node_modules")
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("session notes are created inside the workspace and never overwritten", async () => {
  const ws = await workspace()
  try {
    await seed(ws)
    const note = await ensureSession(ws, "ses_abc", { goal: "login fails", status: "fixed" })
    expect(path.resolve(note).startsWith(path.resolve(ws))).toBe(true)
    const text = await Bun.file(note).text()
    expect(text).toContain("# Session ses_abc")
    expect(text).toContain("login fails")
    expect(text).toContain("Status: fixed")

    await writeFile(note, "# Session ses_abc\n\n- Status: blocked\n")
    const before = await Bun.file(note).text()
    await ensureSession(ws, "ses_abc", { goal: "new goal" })
    expect(await Bun.file(note).text()).toBe(before)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("session ids cannot escape the sessions directory", async () => {
  const ws = await workspace()
  try {
    await seed(ws)
    const note = await ensureSession(ws, "../../escape")
    expect(path.resolve(note).startsWith(path.resolve(memoryPaths(ws).sessions))).toBe(true)
    expect(path.basename(note)).toContain("escape.md")
    expect(path.basename(note)).not.toBe("..")
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("session notes redact secrets before writing", async () => {
  const ws = await workspace()
  try {
    await seed(ws)
    const note = await writeNote(ws, {
      sessionID: "ses_secret",
      goal: "Authorization: Bearer abcdefghij",
      url: "http://localhost:3000/?token=abc123",
      steps: "cookie: sid=abcdef",
      conclusion: "AKIAABCDEFGHIJKLMNOP leaked",
    })
    const text = await Bun.file(note).text()
    expect(text).not.toContain("abcdefghij")
    expect(text).not.toContain("abc123")
    expect(text).not.toContain("AKIAABCDEFGHIJKLMNOP")
    expect(text).toContain("[REDACTED]")
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("artifact retention deletes old matching artifacts only", async () => {
  const ws = await workspace()
  try {
    await seed(ws)
    const paths = memoryPaths(ws)
    const dir = path.join(paths.artifacts, "ses_1")
    await mkdir(dir, { recursive: true })
    const oldFile = path.join(dir, "001-console-abcdef12.json")
    const freshFile = path.join(dir, "002-console-abcdef12.json")
    const keep = path.join(dir, "notes.txt")
    await writeFile(oldFile, "{}")
    await writeFile(freshFile, "{}")
    await writeFile(keep, "keep")
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(oldFile, old, old)
    const memoryBefore = await Bun.file(paths.memory).text()

    const deleted = await cleanupArtifacts(ws, { retentionDays: 7 })
    expect(deleted).toContain(oldFile)
    expect(await Bun.file(oldFile).exists()).toBe(false)
    expect(await Bun.file(freshFile).exists()).toBe(true)
    expect(await Bun.file(keep).exists()).toBe(true)
    expect(await Bun.file(paths.memory).text()).toBe(memoryBefore)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("generated config injects AGENTS.md exactly once and keeps user instructions", async () => {
  const ws = await workspace()
  try {
    const file = path.join(ws, ".kilo", "kilo.json")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ instructions: ["docs/custom.md"] }, null, 2))
    const first = await generateKiloConfig({ workspace: ws })
    const instructions = first.config.instructions as string[]
    expect(instructions.filter((item) => item === INSTRUCTIONS_ENTRY)).toHaveLength(1)
    expect(instructions[0]).toBe("docs/custom.md")
    const second = await generateKiloConfig({ workspace: ws })
    expect((second.config.instructions as string[]).filter((item) => item === INSTRUCTIONS_ENTRY)).toHaveLength(1)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test("two workspaces do not share memory, notes, or artifacts", async () => {
  const a = await workspace()
  const b = await workspace()
  try {
    await seed(a)
    await seed(b)
    const noteA = await ensureSession(a, "ses_shared", { goal: "workspace A" })
    const noteB = await ensureSession(b, "ses_shared", { goal: "workspace B" })
    expect((await Bun.file(noteA).text()).includes("workspace A")).toBe(true)
    expect((await Bun.file(noteB).text()).includes("workspace B")).toBe(true)
    expect((await Bun.file(noteA).text()).includes("workspace B")).toBe(false)
    expect((await Bun.file(noteB).text()).includes("workspace A")).toBe(false)

    const storeA = new ArtifactStore({ workspace: a })
    const storeB = new ArtifactStore({ workspace: b })
    const artifactA = await storeA.write({ sessionID: "ses_shared", tool: "console", params: {}, data: "A", ext: "json" })
    const artifactB = await storeB.write({ sessionID: "ses_shared", tool: "console", params: {}, data: "B", ext: "json" })
    expect(artifactA.path.toLowerCase().startsWith(path.resolve(a).toLowerCase())).toBe(true)
    expect(artifactB.path.toLowerCase().startsWith(path.resolve(b).toLowerCase())).toBe(true)
    expect(artifactA.path.toLowerCase().startsWith(path.resolve(b).toLowerCase())).toBe(false)
    expect(artifactB.path.toLowerCase().startsWith(path.resolve(a).toLowerCase())).toBe(false)
    expect(await Bun.file(artifactA.path).text()).toBe("A")
    expect(await Bun.file(artifactB.path).text()).toBe("B")
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})
test("shipped templates contain the required rules, sections, and fields", async () => {
  const dir = path.join(import.meta.dir, "..", "..", "src", "templates")
  const agents = await Bun.file(path.join(dir, "AGENTS.md")).text()
  expect(agents.match(/^- /gm)?.length).toBe(9)
  expect(agents).toContain("You are the Kilo browser assistant")
  const memory = await Bun.file(path.join(dir, "MEMORY.md")).text()
  for (const heading of ["## App", "## Stable selectors", "## Traps encountered", "## Lessons"]) {
    expect(memory).toContain(heading)
  }
  const session = await Bun.file(path.join(dir, "session.md")).text()
  for (const field of ["Date", "Goal", "URL", "Steps", "Artifact", "Conclusion", "Status"]) {
    expect(session).toContain(field)
  }
  expect(session).toContain("open | fixed | blocked")
})