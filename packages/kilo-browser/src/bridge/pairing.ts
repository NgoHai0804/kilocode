import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export type PairingOptions = {
  ttlMs?: number
  maxFails?: number
  lockoutMs?: number
  now?: () => number
  token?: string
}

export type PairingInput = {
  pairCode?: string
  token?: string
  extensionId: string
}

export type PairingResult =
  | { ok: true; token: string; reused: boolean }
  | { ok: false; kind: "EXPIRED" | "LOCKED" | "BAD_CODE" | "UNAUTHORIZED" | "NO_CODE"; attempt?: number }

export class Pairing {
  private readonly ttlMs: number
  private readonly maxFails: number
  private readonly lockoutMs: number
  private readonly now: () => number
  private secret = randomBytes(32).toString("hex")
  private generation = 0
  private createdAt: number
  private lockUntil = 0
  private fails: number[] = []
  private token: string
  private extensionId?: string

  constructor(options: PairingOptions = {}) {
    this.ttlMs = options.ttlMs ?? 120_000
    this.maxFails = options.maxFails ?? 5
    this.lockoutMs = options.lockoutMs ?? 60_000
    this.now = options.now ?? Date.now
    this.createdAt = this.now()
    this.token = options.token ?? randomBytes(32).toString("hex")
  }

  get code() {
    return codeFromSecret(this.secret, this.generation)
  }

  get codeExpiresAt() {
    return this.createdAt + this.ttlMs
  }

  get lockedUntil() {
    return this.lockUntil
  }

  get paired() {
    return this.extensionId !== undefined
  }

  get pairingOpen() {
    const time = this.now()
    return !this.paired && time < this.codeExpiresAt && time >= this.lockUntil
  }

  get currentToken() {
    return this.token
  }

  issue(input: PairingInput): PairingResult {
    const time = this.now()

    if (input.token !== undefined) {
      if (!sameSecret(input.token, this.token)) return { ok: false, kind: "UNAUTHORIZED" }
      if (this.extensionId && this.extensionId !== input.extensionId) return { ok: false, kind: "UNAUTHORIZED" }
      this.extensionId = input.extensionId
      return { ok: true, token: this.token, reused: true }
    }

    if (input.pairCode === undefined) return { ok: false, kind: "NO_CODE" }

    if (this.extensionId !== undefined) {
      if (this.extensionId === input.extensionId && sameCode(input.pairCode, this.code)) {
        return { ok: true, token: this.token, reused: true }
      }
      return { ok: false, kind: "UNAUTHORIZED" }
    }

    if (time < this.lockUntil) return { ok: false, kind: "LOCKED" }
    if (time >= this.codeExpiresAt) return { ok: false, kind: "EXPIRED" }

    if (!sameCode(input.pairCode, this.code)) {
      this.fails = this.fails.filter((stamp) => time - stamp < this.ttlMs)
      this.fails.push(time)
      if (this.fails.length >= this.maxFails) {
        this.lockUntil = time + this.lockoutMs
        this.fails = []
        return { ok: false, kind: "LOCKED", attempt: this.maxFails }
      }
      return { ok: false, kind: "BAD_CODE", attempt: this.fails.length }
    }

    this.fails = []
    this.extensionId = input.extensionId
    return { ok: true, token: this.token, reused: false }
  }

  verify(token: string) {
    return sameSecret(token, this.token)
  }

  rotate() {
    this.reset()
    return this.code
  }

  revoke() {
    this.reset()
    return this.token
  }

  private reset() {
    this.secret = randomBytes(32).toString("hex")
    this.generation += 1
    this.createdAt = this.now()
    this.lockUntil = 0
    this.fails = []
    this.token = randomBytes(32).toString("hex")
    this.extensionId = undefined
  }
}

function codeFromSecret(secret: string, generation: number) {
  const digest = createHash("sha256").update(`${secret}:${generation}`).digest()
  const value = digest.readUInt32BE(0) % 1_000_000
  return String(value).padStart(6, "0")
}

function sameCode(got: string, expected: string) {
  if (!/^\d{6}$/.test(got)) return false
  return sameSecret(got, expected)
}

function sameSecret(got: string, expected: string) {
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

