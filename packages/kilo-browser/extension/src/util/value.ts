export type Json = Record<string, unknown>

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function record(value: unknown): Json | undefined {
  return isRecord(value) ? value : undefined
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return String(err)
}
