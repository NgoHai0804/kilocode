import type { CdpConnection, Json } from "../types"
import { num, record, text } from "../../util/value"

export type WaitUntil = "load" | "domcontentloaded" | "networkidle"

export type NavigateResult = {
  frameId?: string
  errorText?: string
}

export type PageInfo = {
  url?: string
  title?: string
  status?: number
}

export async function navigate(
  cdp: CdpConnection,
  url: string,
  options: { referrer?: string } = {},
): Promise<NavigateResult> {
  const result = await cdp.send("Page.navigate", {
    url,
    ...(options.referrer ? { referrer: options.referrer } : {}),
  })
  return { frameId: text(result.frameId), errorText: text(result.errorText) }
}

export async function reload(cdp: CdpConnection, ignoreCache = false) {
  await cdp.send("Page.reload", { ignoreCache })
}

export async function frameTree(cdp: CdpConnection): Promise<Json> {
  const result = await cdp.send("Page.getFrameTree")
  return record(result.frameTree) ?? {}
}

export async function navigationHistory(cdp: CdpConnection): Promise<PageInfo> {
  const result = await cdp.send("Page.getNavigationHistory")
  const entries = Array.isArray(result.entries) ? result.entries : []
  const index = num(result.currentIndex) ?? Math.max(entries.length - 1, 0)
  const current = record(entries[index])
  if (!current) return {}
  return { url: text(current.url), title: text(current.title) }
}

export async function captureScreenshot(
  cdp: CdpConnection,
  options: { format?: "png" | "jpeg"; quality?: number; fullPage?: boolean; clip?: Json } = {},
) {
  const format = options.format ?? "png"
  const params: Json = {
    format,
    fromSurface: true,
    captureBeyondViewport: options.fullPage === true,
  }
  if (format === "jpeg" && options.quality !== undefined) params.quality = options.quality
  if (options.clip) params.clip = options.clip
  const result = await cdp.send("Page.captureScreenshot", params)
  return text(result.data) ?? ""
}

export async function enablePage(cdp: CdpConnection) {
  await cdp.send("Page.enable")
}

export async function bringToFront(cdp: CdpConnection) {
  await cdp.send("Page.bringToFront")
}

export function mainFrameUrl(tree: Json): string | undefined {
  const frame = record(tree.frame)
  return frame ? text(frame.url) : undefined
}

export function frameId(tree: Json): string | undefined {
  const frame = record(tree.frame)
  return frame ? text(frame.id) : undefined
}

export function viewport(cdp: CdpConnection): Promise<Json> {
  return cdp.send("Page.getLayoutMetrics")
}
