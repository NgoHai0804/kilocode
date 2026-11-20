import type { CdpConnection, Json } from "../types"
import { array, num, record, text } from "../../util/value"
import type { ConsoleLevel } from "../../buffers/ring"

export type RemoteObject = {
  type?: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  className?: string
  preview?: Json
}

export type Evaluation = {
  value: unknown
  type: string
  description?: string
}

export async function evaluate(
  cdp: CdpConnection,
  expression: string,
  options: { awaitPromise?: boolean; returnByValue?: boolean; timeoutMs?: number } = {},
): Promise<Evaluation> {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise ?? true,
    returnByValue: options.returnByValue ?? true,
    userGesture: false,
  })
  const details = record(result.exceptionDetails)
  if (details) throw new Error(exceptionText(details))
  const object = record(result.result) ?? {}
  return { value: deserialize(object), type: text(object.type) ?? "undefined", description: text(object.description) }
}

export function deserialize(object: Json): unknown {
  if (object.unserializableValue !== undefined) return text(object.unserializableValue)
  if (object.value !== undefined) return object.value
  if (object.type === "undefined") return undefined
  const preview = record(object.preview)
  if (preview) return previewText(preview)
  return text(object.description)
}

export function previewText(preview: Json): string {
  const properties = array(preview.properties)
    .map((item) => {
      const entry = record(item)
      if (!entry) return ""
      const name = text(entry.name) ?? ""
      const value = text(entry.value) ?? ""
      return `${name}: ${value}`
    })
    .filter((item) => item.length > 0)
  const type = text(preview.subtype) ?? text(preview.type) ?? "object"
  return `${type} {${properties.join(", ")}}`
}

export function argumentText(args: unknown[]): string {
  return args
    .map((item) => {
      const object = record(item)
      if (!object) return ""
      const type = text(object.type)
      if (type === "string") return text(object.value) ?? text(object.description) ?? ""
      if (type === "number" || type === "boolean" || type === "bigint") {
        return text(object.unserializableValue) ?? String(object.value ?? object.description ?? "")
      }
      if (type === "undefined") return "undefined"
      if (type === "function") return `function ${text(object.description) ?? ""}`.trim()
      if (object.preview) return previewText(record(object.preview) ?? {})
      return text(object.description) ?? text(object.className) ?? type ?? "unknown"
    })
    .filter((item) => item.length > 0)
    .join(" ")
}

export function consoleLevel(type: string | undefined): ConsoleLevel {
  if (type === "error" || type === "assert") return "error"
  if (type === "warning") return "warn"
  if (type === "debug" || type === "trace") return "debug"
  return "info"
}

export function consoleEntry(params: Json): { level: ConsoleLevel; text: string; url?: string; line?: number; timestamp: number } {
  const args = array(params.args)
  return {
    level: consoleLevel(text(params.type)),
    text: argumentText(args),
    url: text(params.url),
    line: num(params.lineNumber),
    timestamp: num(params.timestamp) ?? Date.now(),
  }
}

export function exceptionText(details: Json): string {
  const exception = record(details.exception)
  const description = exception ? text(exception.description) : undefined
  const message = text(details.text)
  return description ?? message ?? "Runtime exception"
}

export function exceptionEntry(params: Json): { level: ConsoleLevel; text: string; url?: string; line?: number; timestamp: number } {
  const details = record(params.exceptionDetails) ?? {}
  return {
    level: "error",
    text: exceptionText(details),
    url: text(details.url),
    line: num(details.lineNumber),
    timestamp: num(params.timestamp) ?? Date.now(),
  }
}

export function logEntry(params: Json): { level: ConsoleLevel; text: string; url?: string; line?: number; timestamp: number } | undefined {
  const entry = record(params.entry)
  if (!entry) return undefined
  const level = text(entry.level)
  return {
    level: level === "error" ? "error" : level === "warning" ? "warn" : level === "verbose" ? "debug" : "info",
    text: text(entry.text) ?? "",
    url: text(entry.url),
    line: num(entry.lineNumber),
    timestamp: num(entry.timestamp) ?? Date.now(),
  }
}
