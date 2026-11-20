import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { ArtifactStore } from "../../src/artifacts/store"
import {
  DEFAULT_REDACTION,
  redactData,
  redactHeaders,
  redactText,
  redactUrl,
  redactValue,
  redactWithHits,
} from "../../src/policy/redact"

const CANONICAL_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
]

test("redacts the canonical header list and preserves header names", () => {
  const input: Record<string, string> = {
    accept: "application/json",
    authorization: "Bearer abcdefghij",
    cookie: "sid=abcdef",
    "set-cookie": "sid=abcdef; HttpOnly",
    "proxy-authorization": "Basic abcdefghij",
    "x-api-key": "sk-abcdefghijklmnopqrstuvwx",
    "x-auth-token": "abcdefghij",
  }
  const out = redactHeaders(input)
  for (const name of CANONICAL_HEADERS) expect(out[name]).toBe("[REDACTED]")
  expect(out.accept).toBe("application/json")
  expect(Object.keys(out)).toEqual(Object.keys(input))
})

test("redacts the five query keys, keeps path and fragment", () => {
  const raw = "http://localhost:3000/path/evidence?token=1&access_token=2&key=3&secret=4&password=5&ok=6#fragment"
  const out = redactUrl(raw)
  expect(out).toContain("/path/evidence?")
  for (const key of ["token", "access_token", "key", "secret", "password"]) {
    expect(out).toContain(`${key}=[REDACTED]`)
  }
  expect(out).toContain("ok=6")
  expect(out).toContain("#fragment")
  expect(out).not.toContain("=1")
  expect(out).not.toContain("=2")
})

test("redacts Bearer, Basic, JWT, sk-, ghp_, gho_, AKIA and AIza values", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureabc123"
  const samples: Array<[string, string]> = [
    ["Bearer abcdefghij", "Bearer [REDACTED]"],
    ["Basic YWJjZGVmZ2hpams=", "Basic [REDACTED]"],
    [`jwt ${jwt}`, "jwt [REDACTED]"],
    ["sk-abcdefghijklmnopqrstuvwx", "[REDACTED]"],
    ["ghp_abcdefghijklmnopqrstuvwxyz", "[REDACTED]"],
    ["gho_abcdefghijklmnopqrstuvwxyz", "[REDACTED]"],
    ["AKIAABCDEFGHIJKLMNOP", "[REDACTED]"],
    [`AIza${"a".repeat(35)}`, "[REDACTED]"],
  ]
  for (const [input, expected] of samples) {
    const out = redactText(input)
    expect(out).toContain(expected)
    expect(out).not.toContain(input.replace("Bearer ", "").replace("Basic ", ""))
  }
})

test("redacts nested JSON fields and cookies while preserving names and paths", () => {
  const safe = redactValue({
    headers: { authorization: "Bearer abcdefghij", accept: "json" },
    body: { password: "hunter2", nested: { token: "abc123" }, list: [{ secret: "s3cr3t" }] },
    cookies: [{ name: "sid", value: "cookie-value" }],
    note: "see http://localhost:3000/evidence?token=abc123",
  })
  const text = JSON.stringify(safe)
  expect(text).not.toContain("abcdefghij")
  expect(text).not.toContain("hunter2")
  expect(text).not.toContain("abc123")
  expect(text).not.toContain("s3cr3t")
  expect(text).not.toContain("cookie-value")
  expect(text).toContain('"accept":"json"')
  expect(text).toContain('"name":"sid"')
  expect(text).toContain("/evidence?")
  expect(text).toContain("[REDACTED]")
})

test("redactWithHits reports location and pattern without the original value", () => {
  const result = redactWithHits({ authorization: "Bearer abcdefghij", query: "token=abc123" })
  expect(result.hits.length).toBeGreaterThan(0)
  const text = JSON.stringify(result.hits)
  expect(text).not.toContain("abcdefghij")
  expect(text).not.toContain("abc123")
  expect(result.hits.some((hit) => hit.pattern.includes("authorization"))).toBe(true)
})

test("does not alter text or keys that are not sensitive", () => {
  expect(redactText("plain words with no credentials")).toBe("plain words with no credentials")
  expect(redactValue({ monkey: "banana", keyboard: "qwerty" })).toEqual({ monkey: "banana", keyboard: "qwerty" })
})

test("disabled redaction returns the original values", () => {
  const options = { ...DEFAULT_REDACTION, enabled: false }
  expect(redactHeaders({ authorization: "secret" }, options)).toEqual({ authorization: "secret" })
  expect(redactText("Bearer abcdefghij", options)).toBe("Bearer abcdefghij")
})

test("redactData redacts JSON artifacts", () => {
  const out = redactData(JSON.stringify({ authorization: "Bearer abcdefghij", ok: 1 }), "json")
  expect(typeof out).toBe("string")
  expect(String(out)).not.toContain("abcdefghij")
  expect(String(out)).toContain("[REDACTED]")
})

test("artifact writes redact values and use bridge-generated names", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-artifact-"))
  try {
    const store = new ArtifactStore({ workspace })
    const artifact = await store.write({
      sessionID: "ses_1",
      tool: "console",
      params: { token: "abc123", authorization: "Bearer abcdefghij" },
      data: JSON.stringify({ authorization: "Bearer abcdefghij", cookie: "sid=abcdef", ok: 1 }),
      ext: "json",
    })
    const text = await Bun.file(artifact.path).text()
    expect(text).not.toContain("abcdefghij")
    expect(text).not.toContain("sid=abcdef")
    expect(text).toContain("[REDACTED]")
    expect(artifact.name).toMatch(/^\d{3}-console-[a-f0-9]{8}\.json$/)
    expect(artifact.relativePath.startsWith(".kilo")).toBe(true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})