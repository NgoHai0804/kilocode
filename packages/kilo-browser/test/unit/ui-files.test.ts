import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { DEFAULT_REDACTION } from "../../src/policy/redact"
import {
  UI_FILE_LIMIT,
  capDiff,
  checkExternal,
  clip,
  diffFromEvent,
  diffFromMessages,
  readUiFile,
} from "../../src/bridge/ui-files"

test("checkExternal allows only http and https", () => {
  expect(checkExternal("https://example.com/a?x=1").allowed).toBe(true)
  expect(checkExternal("http://127.0.0.1:3000").allowed).toBe(true)
  expect(checkExternal("file:///etc/passwd")).toMatchObject({ allowed: false, reason: "unsupported_scheme:file:" })
  expect(checkExternal("javascript:alert(1)").allowed).toBe(false)
  expect(checkExternal("not a url").allowed).toBe(false)
  expect(checkExternal("").allowed).toBe(false)
})

test("clip truncates at the limit and reports it", () => {
  expect(clip("hello", 10)).toEqual({ text: "hello", truncated: false })
  expect(clip("hello world", 5)).toEqual({ text: "hello", truncated: true })
})

test("diffFromEvent maps a session.diff payload", () => {
  const files = diffFromEvent({
    sessionID: "ses_1",
    diff: [{ file: "a.ts", before: "x", after: "y", additions: 1, deletions: 1, status: "modified", patch: "@@" }],
  })
  expect(files).toEqual([
    { path: "a.ts", before: "x", after: "y", patch: "@@", additions: 1, deletions: 1, status: "modified" },
  ])
})

test("diffFromEvent returns an empty list for malformed payloads", () => {
  expect(diffFromEvent(undefined)).toEqual([])
  expect(diffFromEvent({ diff: "nope" })).toEqual([])
})

test("diffFromMessages extracts tool filediff metadata", () => {
  const files = diffFromMessages([
    { parts: [{ type: "tool", state: { metadata: { filediff: { file: "b.ts", patch: "@@", additions: 2, deletions: 0 } } } }] },
    { parts: [{ type: "patch", files: ["c.ts"] }] },
  ])
  expect(files).toEqual([
    { path: "b.ts", before: "", after: "", patch: "@@", additions: 2, deletions: 0 },
    { path: "c.ts", before: "", after: "" },
  ])
})

test("capDiff truncates oversized sides and marks the file", () => {
  const files = capDiff([{ path: "big.ts", before: "a".repeat(10), after: "b" }], 4)
  expect(files[0]).toEqual({ path: "big.ts", before: "aaaa", after: "b", truncated: true })
})

test("readUiFile allows inside, denies outside, and truncates", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-files-"))
  try {
    await Bun.write(path.join(workspace, "small.txt"), "hello")
    await Bun.write(path.join(workspace, "big.txt"), "x".repeat(UI_FILE_LIMIT + 5))
    await Bun.write(path.join(workspace, "secret.txt"), "token: Bearer abcdefghijklmnop")

    expect(await readUiFile(workspace, "small.txt", DEFAULT_REDACTION)).toEqual({
      path: "small.txt",
      text: "hello",
      truncated: false,
    })

    const big = await readUiFile(workspace, "big.txt", DEFAULT_REDACTION)
    expect("truncated" in big && big.truncated).toBe(true)

    const secret = await readUiFile(workspace, "secret.txt", DEFAULT_REDACTION)
    expect("text" in secret && secret.text.includes("Bearer [REDACTED]")).toBe(true)

    expect(await readUiFile(workspace, path.join("..", "outside.txt"), DEFAULT_REDACTION)).toMatchObject({
      error: "outside_root",
    })
    expect(await readUiFile(workspace, "missing.txt", DEFAULT_REDACTION)).toMatchObject({ error: "not_found" })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})