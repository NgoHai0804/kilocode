import { resolveSafe } from "../policy/jail"
import { redactText, type RedactionOptions } from "../policy/redact"

/** Hard cap for a single file body or diff side returned to the UI. */
export const UI_FILE_LIMIT = 256 * 1024

export type UiFileResult = { path: string; text: string; truncated: boolean }

export type UiFileError = { error: "outside_root" | "resolve_error" | "no_root" | "not_found" }

export type UiDiffFile = {
  path: string
  before: string
  after: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
  truncated?: boolean
}

export type UrlGuardResult = { url: string; allowed: boolean; reason?: string }

/**
 * Read a workspace-relative file for the read-only browser viewer.
 *
 * The path is resolved through `policy/jail` so a viewer URL can never escape
 * the workspace. Content is redacted with the active redaction config and
 * capped at `limit` bytes; the caller learns whether it was cut.
 */
export async function readUiFile(
  workspace: string,
  target: string,
  redaction: RedactionOptions,
  limit = UI_FILE_LIMIT,
): Promise<UiFileResult | UiFileError> {
  const safe = await resolveSafe([workspace], target)
  if (!safe.ok) return { error: safe.reason }
  const file = Bun.file(safe.resolved)
  if (!(await file.exists())) return { error: "not_found" }
  const size = file.size
  const raw = await file.slice(0, limit).text()
  return { path: target, text: redactText(raw, redaction), truncated: size > limit }
}

/** Trim a string to `limit` and report whether anything was dropped. */
export function clip(text: string, limit = UI_FILE_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(0, limit), truncated: true }
}

/** Whether a URL may be opened externally. Only http(s) is allowed. */
export function checkExternal(raw: string): UrlGuardResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { url: raw, allowed: false, reason: "invalid_url" }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { url: raw, allowed: false, reason: "invalid_url" }
  }
  if (url.protocol === "http:" || url.protocol === "https:") return { url: url.href, allowed: true }
  return { url: url.href, allowed: false, reason: `unsupported_scheme:${url.protocol}` }
}

/** Extract diff files from a `session.diff` SSE payload. */
export function diffFromEvent(data: unknown): UiDiffFile[] {
  const value = isRecord(data) ? data : undefined
  if (!value) return []
  const list = Array.isArray(value.diff) ? value.diff : Array.isArray(value.files) ? value.files : []
  const out: UiDiffFile[] = []
  for (const item of list) {
    const entry = toDiffFile(item)
    if (entry) out.push(entry)
  }
  return out
}

/**
 * Fallback extraction from `GET /session/:id/message`.
 *
 * Tool parts carry `state.metadata.filediff` / `metadata.files[]`; the backend
 * strips full `before`/`after` from those responses, so entries may only carry
 * a `patch`. Viewer callers can still render patch-backed diffs.
 */
export function diffFromMessages(messages: unknown): UiDiffFile[] {
  if (!Array.isArray(messages)) return []
  const out = new Map<string, UiDiffFile>()
  for (const message of messages) {
    const parts = isRecord(message) && Array.isArray(message.parts) ? message.parts : []
    for (const part of parts) {
      if (!isRecord(part)) continue
      if (part.type === "patch") {
        for (const name of stringList(part.files)) {
          if (!out.has(name)) out.set(name, { path: name, before: "", after: "" })
        }
        continue
      }
      const metadata = isRecord(part.state) && isRecord(part.state.metadata) ? part.state.metadata : undefined
      if (!metadata) continue
      collectMetadata(metadata, out)
    }
  }
  return [...out.values()]
}

/** Cap every diff side so one huge session cannot blow the UI payload. */
export function capDiff(files: UiDiffFile[], limit = UI_FILE_LIMIT): UiDiffFile[] {
  return files.map((file) => {
    const before = clip(file.before, limit)
    const after = clip(file.after, limit)
    const patch = file.patch === undefined ? undefined : clip(file.patch, limit)
    const truncated = before.truncated || after.truncated || patch?.truncated === true
    return {
      ...file,
      before: before.text,
      after: after.text,
      ...(patch !== undefined ? { patch: patch.text } : {}),
      ...(truncated ? { truncated: true } : {}),
    }
  })
}

function collectMetadata(metadata: Record<string, unknown>, out: Map<string, UiDiffFile>) {
  const direct = toDiffFile(metadata.filediff)
  if (direct) out.set(direct.path, direct)
  if (Array.isArray(metadata.files)) {
    for (const item of metadata.files) {
      const entry = toDiffFile(item)
      if (entry) out.set(entry.path, entry)
    }
  }
  if (Array.isArray(metadata.results)) {
    for (const item of metadata.results) {
      if (!isRecord(item)) continue
      const entry = toDiffFile(item.filediff)
      if (entry) out.set(entry.path, entry)
    }
  }
}

function toDiffFile(value: unknown): UiDiffFile | undefined {
  const item = isRecord(value) ? value : undefined
  if (!item) return undefined
  const path = str(item.file) ?? str(item.path) ?? str(item.filePath) ?? str(item.relativePath)
  const before = str(item.before)
  const after = str(item.after)
  const patch = str(item.patch) ?? str(item.diff)
  if (path === undefined && before === undefined && after === undefined && patch === undefined) return undefined
  return {
    path: path ?? "",
    before: before ?? "",
    after: after ?? "",
    ...(patch !== undefined ? { patch } : {}),
    ...(typeof item.additions === "number" ? { additions: item.additions } : {}),
    ...(typeof item.deletions === "number" ? { deletions: item.deletions } : {}),
    ...(str(item.status) !== undefined ? { status: str(item.status) } : {}),
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}