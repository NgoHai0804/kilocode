import { createHash } from "node:crypto"
import { paramsHash, type RedactionOptions } from "../policy/redact"

export type NamingInput = {
  seq: number
  tool: string
  ext: string
  hash?: string
  params?: unknown
  redaction?: RedactionOptions
}

/**
 * Single source of truth for artifact file names and session path segments.
 *
 * Validation matches the rest of the artifact pipeline: a positive integer
 * sequence, an 8-hex hash, and an alphanumeric extension (leading dot
 * optional). The hash may be supplied directly (extension RPC) or derived from
 * the tool params.
 */
export function artifactName(input: NamingInput): string {
  if (!Number.isInteger(input.seq) || input.seq < 1) throw new Error("artifact seq must be a positive integer")
  const extension = input.ext.replace(/^\./, "")
  if (!/^[a-z0-9]+$/i.test(extension)) throw new Error("artifact extension must be alphanumeric")
  const hash = input.hash ?? hashOf(input.params, input.redaction)
  if (!/^[a-f0-9]{8}$/i.test(hash)) throw new Error("artifact hash must be exactly 8 hex characters")
  const tool = input.tool.replace(/^browser\./, "").replace(/[^a-z0-9_-]/gi, "_")
  return `${String(input.seq).padStart(3, "0")}-${tool || "tool"}-${hash.toLowerCase()}.${extension}`
}

export function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "_")
  if (cleaned.length === 0 || cleaned === "." || cleaned === "..") throw new Error("invalid session id")
  return cleaned
}

function hashOf(params: unknown, redaction?: RedactionOptions) {
  return redaction ? paramsHash(params, redaction) : fallbackHash(params)
}

function fallbackHash(params: unknown) {
  return createHash("sha256").update(JSON.stringify(params ?? null)).digest("hex").slice(0, 8)
}
