import { invalid } from "../rpc/failure"

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalid(field, "must be a non-empty string")
  return value
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") throw invalid(field, "must be a string")
  return value
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "boolean") throw invalid(field, "must be a boolean")
  return value
}

export function optionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalid(field, "must be an integer")
  if (value < min || value > max) throw invalid(field, `must be between ${min} and ${max}`)
  return value
}

export function integer(value: unknown, field: string, fallback: number, min: number, max: number): number {
  return optionalInteger(value, field, min, max) ?? fallback
}

export function requiredInteger(value: unknown, field: string, min: number, max: number): number {
  const parsed = optionalInteger(value, field, min, max)
  if (parsed === undefined) throw invalid(field, "must be an integer")
  return parsed
}

export function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null) return fallback
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalid(field, `must be one of ${allowed.join(", ")}`)
  }
  return value as T
}

export function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalid(field, `must be one of ${allowed.join(", ")}`)
  }
  return value as T
}

export function jsonRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object" || Array.isArray(value)) throw invalid(field, "must be an object")
  return value as Record<string, unknown>
}