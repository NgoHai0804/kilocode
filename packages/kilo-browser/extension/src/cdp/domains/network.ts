import type { CdpConnection, Json } from "../types"
import { bool, num, record, text } from "../../util/value"

export type RequestStart = {
  requestId: string
  method: string
  url: string
  resourceType?: string
  timestamp: number
}

export type ResponseInfo = {
  status: number
  statusText?: string
  mimeType?: string
  headers?: Record<string, string>
}

export type FinishedInfo = {
  encodedDataLength?: number
}

export function requestStart(params: Json): RequestStart | undefined {
  const request = record(params.request)
  if (!request) return undefined
  const requestId = text(params.requestId)
  const url = text(request.url)
  const method = text(request.method)
  if (!requestId || !url || !method) return undefined
  const timestamp = num(params.timestamp) ?? num(params.wallTime) ?? Date.now() / 1000
  return {
    requestId,
    method,
    url,
    resourceType: text(params.type),
    timestamp: timestamp * 1000,
  }
}

export function responseInfo(params: Json): ResponseInfo | undefined {
  const response = record(params.response)
  if (!response) return undefined
  const status = num(response.status)
  if (status === undefined) return undefined
  return {
    status,
    statusText: text(response.statusText),
    mimeType: text(response.mimeType),
    headers: headerRecord(record(response.headers)),
  }
}

export function headerRecord(value: Json | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item
  }
  return out
}

export function responseTimestamp(params: Json): number | undefined {
  const timestamp = num(params.timestamp)
  return timestamp === undefined ? undefined : timestamp * 1000
}

export function loadingFinished(params: Json): FinishedInfo {
  return { encodedDataLength: num(params.encodedDataLength) }
}

export function loadingFailed(params: Json): { errorText: string; canceled?: boolean } {
  return {
    errorText: text(params.errorText) ?? "network error",
    canceled: bool(params.canceled) === true,
  }
}

export function bodyFromResult(result: Json): { body: string; base64: boolean } | undefined {
  const body = text(result.body)
  if (body === undefined) return undefined
  return { body, base64: bool(result.base64Encoded) === true }
}

export function isTextMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false
  const mime = mimeType.toLowerCase()
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    mime.includes("x-www-form-urlencoded")
  )
}

export async function responseBody(cdp: CdpConnection, requestId: string): Promise<string | undefined> {
  const result = await cdp.send("Network.getResponseBody", { requestId })
  const body = bodyFromResult(result)
  if (!body) return undefined
  if (body.base64) return body.body
  return body.body
}