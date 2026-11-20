import path from "node:path"
import { existsSync } from "node:fs"
import { mkdir, readdir, stat, unlink } from "node:fs/promises"
import { checkJail, safeSegment } from "../policy/jail"
import { DEFAULT_REDACTION, redactText, type RedactionOptions } from "../policy/redact"

export type SeedResult = {
  created: string[]
  skipped: string[]
}

export type NoteStatus = "open" | "fixed" | "blocked"

export type SessionNote = {
  sessionID: string
  date?: string
  goal?: string
  url?: string
  steps?: string
  artifacts?: string
  conclusion?: string
  status?: NoteStatus
}

export type MemoryOptions = {
  redaction?: RedactionOptions
}

const TEMPLATES = ["AGENTS.md", "MEMORY.md"] as const
const ARTIFACT = /^\d{3}-[a-z0-9_-]+-[a-f0-9]{8}\.[a-z0-9]+$/i

export function memoryPaths(workspace: string) {
  const root = path.join(workspace, ".kilo", "kilo-browser")
  const sessions = path.join(root, "sessions")
  return {
    workspace,
    root,
    agents: path.join(root, "AGENTS.md"),
    memory: path.join(root, "MEMORY.md"),
    sessions,
    artifacts: path.join(root, "artifacts"),
    logs: path.join(root, "logs"),
    runtime: path.join(root, "runtime.json"),
    sessionNote(sessionID: string) {
      return path.join(sessions, `${safeSegment(sessionID)}.md`)
    },
  }
}

export async function seed(workspace: string): Promise<SeedResult> {
  return ensureTemplates(workspace)
}

export async function ensureTemplates(workspace: string): Promise<SeedResult> {
  const paths = memoryPaths(workspace)
  await mkdir(paths.sessions, { recursive: true })
  const created: string[] = []
  const skipped: string[] = []
  for (const name of TEMPLATES) {
    const target = name === "AGENTS.md" ? paths.agents : paths.memory
    await assertInside(workspace, target)
    if (await Bun.file(target).exists()) {
      skipped.push(target)
      continue
    }
    await Bun.write(target, await template(name))
    created.push(target)
  }
  return { created, skipped }
}

export async function ensureSession(
  workspace: string,
  sessionID: string,
  note: Partial<Omit<SessionNote, "sessionID">> = {},
  options: MemoryOptions = {},
): Promise<string> {
  const paths = memoryPaths(workspace)
  const target = paths.sessionNote(sessionID)
  await assertInside(workspace, target)
  if (await Bun.file(target).exists()) return target
  await mkdir(paths.sessions, { recursive: true })
  const text = renderSession(await template("session.md"), { ...note, sessionID }, options)
  await Bun.write(target, text)
  return target
}

export async function writeNote(workspace: string, note: SessionNote, options: MemoryOptions = {}): Promise<string> {
  return ensureSession(workspace, note.sessionID, note, options)
}

export async function cleanupArtifacts(
  workspace: string,
  options: { retentionDays?: number; now?: number } = {},
): Promise<string[]> {
  const days = options.retentionDays ?? 7
  if (days <= 0) return []
  const root = memoryPaths(workspace).artifacts
  await assertInside(workspace, root)
  const cutoff = (options.now ?? Date.now()) - days * 24 * 60 * 60 * 1000
  const deleted: string[] = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    if (codeOf(err) === "ENOENT") return deleted
    throw err
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    let files
    try {
      files = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      if (codeOf(err) === "ENOENT") continue
      throw err
    }
    for (const file of files) {
      if (!file.isFile() || !ARTIFACT.test(file.name)) continue
      const target = path.join(dir, file.name)
      await assertInside(workspace, target)
      const info = await stat(target)
      if (info.mtimeMs >= cutoff) continue
      await unlink(target)
      deleted.push(target)
    }
  }
  return deleted
}

function renderSession(raw: string, note: SessionNote, options: MemoryOptions) {
  const redaction = options.redaction ?? DEFAULT_REDACTION
  const clean = (value: string | undefined) => (value ? redactText(value, redaction) : undefined)
  const status = note.status === "fixed" || note.status === "blocked" ? note.status : "open"
  return raw
    .replaceAll("<sessionID>", safeSegment(note.sessionID))
    .replaceAll("<date>", clean(note.date) ?? new Date().toISOString().slice(0, 10))
    .replaceAll("<symptom reported by the user>", clean(note.goal) ?? "TBD")
    .replaceAll("<starting url>", clean(note.url) ?? "TBD")
    .replaceAll("<tool + key result>", clean(note.steps) ?? "TBD")
    .replaceAll("<relative path>", clean(note.artifacts) ?? "none")
    .replaceAll("<cause, fix, evidence>", clean(note.conclusion) ?? "TBD")
    .replaceAll("open | fixed | blocked", status)
}

async function assertInside(workspace: string, target: string) {
  await checkJail([workspace], target)
}

async function template(name: string) {
  const file = path.join(templateDir(), name)
  if (!existsSync(file)) throw new Error(`kilo-browser template is missing: ${name}`)
  return Bun.file(file).text()
}

function templateDir() {
  let dir = import.meta.dir
  while (true) {
    const nested = path.join(dir, "src", "templates")
    if (existsSync(path.join(nested, "AGENTS.md"))) return nested
    const direct = path.join(dir, "templates")
    if (existsSync(path.join(direct, "AGENTS.md"))) return direct
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("kilo-browser templates directory not found")
    dir = parent
  }
}

function codeOf(err: unknown) {
  if (!(err instanceof Error)) return undefined
  return (err as NodeJS.ErrnoException).code
}