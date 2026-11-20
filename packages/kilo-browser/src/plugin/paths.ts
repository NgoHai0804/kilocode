import path from "node:path"
import { artifactPath, checkJail, inside, JailError } from "../policy/jail"
import { BLOCKED_SCHEMES, checkUrl } from "../policy/origin"
import type { BrowserConfig } from "../config/schema"

export class PolicyError extends Error {
  readonly code = "POLICY_DENIED"

  constructor(
    readonly reason: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(`browser policy denied: ${reason}`)
    this.name = "PolicyError"
  }
}

export function assertOriginAllowed(raw: string, config: BrowserConfig): void {
  const result = checkUrl(raw, config.browser.allowedOrigins)
  if (result.ok) return
  throw new PolicyError(result.reason, { url: raw, origin: result.url?.origin })
}

export function assertNoFileUrl(raw: string): void {
  const trimmed = raw.trim()
  if (trimmed.toLowerCase() === "about:blank") return
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!match?.[1]) return
  const scheme = `${match[1].toLowerCase()}:`
  if (BLOCKED_SCHEMES.has(scheme)) throw new PolicyError(`blocked_scheme:${scheme}`, { url: raw })
}

export async function assertWorkspacePath(workspace: string, target: string): Promise<string> {
  try {
    return await checkJail([workspace], target)
  } catch (err) {
    throw fromJail(err)
  }
}

export async function assertArtifactPathInsideJail(
  workspace: string,
  target: string,
  artifactsDir = ".kilo/kilo-browser/artifacts",
): Promise<string> {
  const root = path.resolve(workspace, artifactsDir)
  let resolved: string
  try {
    await checkJail([workspace], root)
    resolved = await checkJail([root], target)
  } catch (err) {
    throw fromJail(err)
  }
  if (!/^\d{3}-[a-z0-9_-]+-[a-f0-9]{8}\.[a-z0-9]+$/i.test(path.basename(resolved))) {
    throw new PolicyError("artifact_name", { path: resolved })
  }
  return resolved
}

export function artifactTarget(
  workspace: string,
  sessionID: string,
  seq: number,
  tool: string,
  hash: string,
  ext: string,
): string {
  return path.resolve(workspace, artifactPath(sessionID, seq, tool, hash, ext))
}

export type BashFinding = {
  kind: "redirect" | "command" | "flag" | "cwd"
  path: string
}

const MUTATING = /\b(?:cp|mv|rm|rmdir|del|erase|tee|curl|wget|scp|rsync|install|ln|Out-File|Set-Content|Add-Content|New-Item|Remove-Item|Copy-Item|Move-Item)\b/i
const REDIRECT = /(?:^|[^0-9])>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g
const FLAG_PATH = /(?:^|\s)(?:-o|--output|--output-document|-O|--output-dir)(?:=|\s+)\s*("[^"]+"|'[^']+'|[^\s;&|]+)/gi
const ABSOLUTE = /(?:[A-Za-z]:[\\/][^\s"'`;&|]*|\\\\[^\s"'`;&|]+|\/[^\s"'`;&|]+)/g

export function scanBash(command: string): BashFinding[] {
  const text = command.replace(/\r?\n/g, " ")
  const findings: BashFinding[] = []
  const mutating = MUTATING.test(text)

  for (const match of text.matchAll(REDIRECT)) {
    const raw = clean(match[1] ?? "")
    if (isPathToken(raw)) findings.push({ kind: "redirect", path: raw })
  }
  if (!mutating) return dedupe(findings)

  for (const match of text.matchAll(FLAG_PATH)) {
    const raw = clean(match[1] ?? "")
    if (isPathToken(raw)) findings.push({ kind: "flag", path: raw })
  }
  for (const match of text.matchAll(ABSOLUTE)) {
    const raw = clean(match[0] ?? "")
    if (isPathToken(raw)) findings.push({ kind: "command", path: raw })
  }
  return dedupe(findings)
}

export function assertBashInside(root: string, command: string, cwd?: string): void {
  if (cwd) {
    const target = isAbsolute(cwd) ? cwd : path.resolve(root, cwd)
    if (!inside(root, target)) throw new PolicyError("bash_cwd_escape", { path: target, root })
  }
  for (const finding of scanBash(command)) {
    if (!isAbsolute(finding.path)) continue
    if (inside(root, finding.path)) continue
    throw new PolicyError("bash_path_escape", { path: finding.path, root, kind: finding.kind })
  }
}

function fromJail(err: unknown) {
  if (err instanceof JailError) {
    return new PolicyError("jail_deny", { path: err.target, root: err.root, resolved: err.resolved, reason: err.reason })
  }
  if (err instanceof Error) return new PolicyError("jail_error", { message: err.message })
  return new PolicyError("jail_error")
}

function clean(value: string) {
  return value.replace(/^["']|["']$/g, "").trim()
}

function isPathToken(value: string) {
  if (value.length === 0) return false
  if (value.startsWith("-") || value.startsWith("$")) return false
  if (/^https?:\/\//i.test(value)) return false
  if (/^[A-Za-z]:$/.test(value)) return false
  return isAbsolute(value)
}

function isAbsolute(value: string) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
}

function dedupe(findings: BashFinding[]) {
  const seen = new Set<string>()
  const out: BashFinding[] = []
  for (const finding of findings) {
    const key = `${finding.kind}\u0000${finding.path}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(finding)
  }
  return out
}