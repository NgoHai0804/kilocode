/**
 * Read-only viewer transport.
 *
 * The file/diff pages are separate extension pages, so they read the paired
 * bridge port and token from localStorage (shared across the extension origin)
 * and call the bridge `/ui/*` endpoints directly. They never open the UI
 * WebSocket used by the chat surface.
 */

import { bridgeUrl, browserStorage, readPort, readToken, type PairingStorage } from "./pairing"

export const DIFF_PREVIEW_KEY = "kilo.browser.viewer.preview"

export type ViewerConfig = { port: number; token: string }

export type UiFile = { path: string; text: string; truncated: boolean }

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

export type ViewerError = { ok: false; status: number; code: string; message: string }
export type ViewerOk<T> = { ok: true; value: T }
export type ViewerResult<T> = ViewerOk<T> | ViewerError

export function viewerConfig(storage: PairingStorage = browserStorage()): ViewerConfig | undefined {
  const port = readPort(storage)
  const token = readToken(storage)
  if (port === undefined || token === undefined) return undefined
  return { port, token }
}

export function fetchUiFile(config: ViewerConfig, path: string, session?: string): Promise<ViewerResult<UiFile>> {
  const query = new URLSearchParams({ path })
  if (session) query.set("session", session)
  return request(config, `/ui/file?${query.toString()}`, (value) => {
    const record = asRecord(value)
    if (!record || typeof record.text !== "string") return undefined
    return {
      path: typeof record.path === "string" ? record.path : path,
      text: record.text,
      truncated: record.truncated === true,
    }
  })
}

export function fetchUiDiff(config: ViewerConfig, session: string): Promise<ViewerResult<UiDiffFile[]>> {
  const query = new URLSearchParams({ session })
  return request(config, `/ui/diff?${query.toString()}`, (value) => {
    const record = asRecord(value)
    if (!record || !Array.isArray(record.files)) return undefined
    return record.files.flatMap((item) => {
      const file = toDiffFile(item)
      return file ? [file] : []
    })
  })
}

/** Read a permission diff stashed by the host adapter for a standalone tab. */
export function readDiffPreview(): UiDiffFile[] {
  const raw = localStorage.getItem(DIFF_PREVIEW_KEY)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (err) {
    console.warn("[Kilo Browser] could not parse diff preview", err)
    return []
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => {
      const file = toDiffFile(item)
      return file ? [file] : []
    })
  }
  const single = toDiffFile(parsed)
  return single ? [single] : []
}

async function request<T>(
  config: ViewerConfig,
  path: string,
  parse: (value: unknown) => T | undefined,
): Promise<ViewerResult<T>> {
  let response: Response
  try {
    response = await fetch(bridgeUrl(config.port, path), {
      headers: { authorization: `Bearer ${config.token}`, accept: "application/json" },
    })
  } catch (err) {
    return { ok: false, status: 0, code: "NETWORK", message: err instanceof Error ? err.message : "network error" }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (err) {
    console.warn("[Kilo Browser] viewer received an invalid response", err)
    return { ok: false, status: response.status, code: "PARSE", message: "The bridge returned an invalid response." }
  }
  const record = asRecord(body)
  if (response.ok && record?.ok === true) {
    const value = parse(record.result)
    if (value === undefined) {
      return { ok: false, status: response.status, code: "MALFORMED", message: "The bridge returned an unexpected payload." }
    }
    return { ok: true, value }
  }
  return { ok: false, status: response.status, code: errorCode(record), message: errorText(record) }
}

function errorText(record: Record<string, unknown> | undefined): string {
  const error = record ? asRecord(record.error) : undefined
  if (!error) return "The request failed."
  const data = asRecord(error.data)
  if (data && typeof data.reason === "string") return `${error.message ?? "Error"}: ${data.reason}`
  if (typeof error.message === "string") return error.message
  return "The request failed."
}

function errorCode(record: Record<string, unknown> | undefined): string {
  const error = record ? asRecord(record.error) : undefined
  if (error && typeof error.message === "string") return error.message
  return "ERROR"
}

function toDiffFile(value: unknown): UiDiffFile | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const path = text(item.path) ?? text(item.file)
  if (path === undefined) return undefined
  const patch = text(item.patch)
  return {
    path,
    before: text(item.before) ?? "",
    after: text(item.after) ?? "",
    ...(patch !== undefined ? { patch } : {}),
    ...(typeof item.additions === "number" ? { additions: item.additions } : {}),
    ...(typeof item.deletions === "number" ? { deletions: item.deletions } : {}),
    ...(text(item.status) !== undefined ? { status: text(item.status) } : {}),
    ...(item.truncated === true ? { truncated: true } : {}),
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}