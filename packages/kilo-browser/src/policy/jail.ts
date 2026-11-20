import path from "node:path"
import { realpath } from "node:fs/promises"
import { artifactName, safeSegment } from "../artifacts/naming"

export type JailReason = "outside_root" | "resolve_error" | "no_root"

export class JailError extends Error {
  readonly code = "JAIL_DENIED"

  constructor(
    readonly target: string,
    readonly root: string,
    readonly resolved: string,
    readonly reason: JailReason = "outside_root",
  ) {
    super(`path escapes workspace (${reason}): target=${target} resolved=${resolved} root=${root}`)
    this.name = "JailError"
  }
}

export type Jail = {
  roots: string[]
  check(target: string): Promise<string>
  contains(target: string): Promise<boolean>
  resolve(target: string): Promise<string>
}

export function createJail(roots: string[], extraRoots: string[] = []): Jail {
  const list = roots.map(normalizeRoot)
  const extra = extraRoots.map(normalizeRoot)
  const all = [...list, ...extra]
  return {
    roots: all,
    check(target) {
      return checkJail(all, target)
    },
    async contains(target) {
      return (await resolveSafe(all, target)).ok
    },
    resolve(target) {
      const first = all[0] ?? process.cwd()
      return resolveTarget(first, target)
    },
  }
}

export async function checkJail(roots: string[], target: string): Promise<string> {
  const result = await resolveSafe(roots, target)
  if (!result.ok) throw new JailError(target, result.root, result.resolved, result.reason)
  return result.resolved
}

type SafeResult =
  | { ok: true; resolved: string; root: string }
  | { ok: false; resolved: string; root: string; reason: JailReason }

export async function resolveSafe(roots: string[], target: string): Promise<SafeResult> {
  const first = roots[0]
  if (!first) {
    const resolved = lexical(process.cwd(), target)
    return { ok: false, resolved, root: rootOf(resolved), reason: "no_root" }
  }

  let resolved: string
  try {
    resolved = await resolveTarget(first, target)
  } catch {
    return { ok: false, resolved: lexical(first, target), root: normalizeRoot(first), reason: "resolve_error" }
  }

  for (const root of roots) {
    let realRoot: string
    try {
      realRoot = await realpathNearest(normalizeRoot(root))
    } catch (err) {
      if (!(err instanceof Error)) throw err
      continue
    }
    if (inside(realRoot, resolved)) return { ok: true, resolved, root: realRoot }
  }
  return { ok: false, resolved, root: normalizeRoot(first), reason: "outside_root" }
}

export async function resolve(root: string, target: string): Promise<string> {
  return resolveTarget(root, target)
}

export function assertInside(root: string, target: string): void {
  if (inside(root, target)) return
  throw new JailError(target, normalizeRoot(root), normalizeRoot(target))
}

export function inside(root: string, target: string): boolean {
  const windows = isWindowsForm(root) || isWindowsForm(target)
  if (windows !== isWindowsForm(root) || windows !== isWindowsForm(target)) return false
  const base = comparePath(root, windows)
  const next = comparePath(target, windows)
  if (base === next) return true
  const rel = windows ? path.win32.relative(base, next) : path.relative(base, next)
  if (rel === "") return true
  const absolute = windows ? path.win32.isAbsolute(rel) : path.isAbsolute(rel)
  if (absolute) return false
  const separator = windows ? path.win32.sep : path.sep
  const segments = rel.split(separator)
  return segments[0] !== ".."
}

export function artifactPath(sessionID: string, seq: number, tool: string, hash: string, ext: string): string {
  const session = safeSegment(sessionID)
  const name = artifactName({ seq, tool, hash, ext })
  return path.join(".kilo", "kilo-browser", "artifacts", session, name)
}

export { safeSegment }

async function resolveTarget(root: string, target: string): Promise<string> {
  const resolved = lexical(root, target)
  if (isWindowsForm(root) !== isWindowsForm(resolved)) return resolved
  return realpathNearest(resolved)
}

function lexical(root: string, target: string): string {
  const base = normalizeRoot(root)
  if (isAbsolute(target)) return trim(resolveAbsolute(base, target))
  return trim(resolveRelative(base, target))
}

function resolveAbsolute(root: string, target: string) {
  return isWindowsForm(target) ? path.win32.normalize(target) : path.resolve(target)
}

function resolveRelative(root: string, target: string) {
  if (isWindowsForm(root) || isWindowsForm(target)) {
    if (/^[A-Za-z]:/.test(target)) {
      const drive = target.slice(0, 2).toLowerCase()
      const rootDrive = /^[A-Za-z]:/.test(root) ? root.slice(0, 2).toLowerCase() : ""
      if (rootDrive.length > 0 && drive !== rootDrive) return path.win32.resolve(target)
    }
    return path.win32.resolve(root, target)
  }
  return path.resolve(root, target)
}

async function realpathNearest(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch (err) {
    if (!(err instanceof Error)) throw err
    const code = codeOf(err)
    if (code !== "ENOENT" && code !== "ENOTDIR") throw err
    const windows = isWindowsForm(target)
    const dir = windows ? path.win32.dirname(target) : path.dirname(target)
    if (dir === target) return target
    const parent = await realpathNearest(dir)
    return windows ? path.win32.join(parent, path.win32.basename(target)) : path.join(parent, path.basename(target))
  }
}

function isAbsolute(value: string) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value)
}

function isWindowsForm(value: string) {
  if (process.platform === "win32") return true
  return /^[A-Za-z]:/.test(value) || value.startsWith("\\\\")
}

function normalizeRoot(value: string) {
  return trim(isWindowsForm(value) ? path.win32.normalize(value) : path.normalize(value))
}

function trim(value: string) {
  const windows = isWindowsForm(value)
  const root = windows ? path.win32.parse(value).root : path.parse(value).root
  if (value === root) return value
  return value.replace(/[\\/]+$/, "")
}

function comparePath(value: string, windows: boolean) {
  const normalized = trim(windows ? path.win32.normalize(value) : path.normalize(value))
  if (windows || process.platform === "darwin") return normalized.toLowerCase()
  return normalized
}

function rootOf(value: string) {
  return isWindowsForm(value) ? path.win32.parse(value).root : path.parse(value).root
}

function codeOf(err: Error) {
  return (err as NodeJS.ErrnoException).code
}
