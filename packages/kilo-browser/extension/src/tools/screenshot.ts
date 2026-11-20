import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { bool } from "../util/value"
import { throwIfAborted } from "../rpc/failure"
import { enumValue, integer, jsonRecord } from "./params"

const FORMATS = ["png", "jpeg"] as const

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const format = enumValue(params.format, "format", FORMATS, "png")
  const quality = integer(params.quality, "quality", 90, 1, 100)
  const fullPage = bool(params.fullPage) === true
  const clip = jsonRecord(params.clip, "clip")
  const options: { format: "png" | "jpeg"; quality?: number; fullPage: boolean; clip?: Json } = {
    format,
    fullPage,
    ...(format === "jpeg" ? { quality } : {}),
    ...(clip ? { clip } : {}),
  }
  throwIfAborted(signal)
  const data = await ctx.session.screenshot(options)
  throwIfAborted(signal)
  const bytes = decodeBase64(data)
  const size = imageSize(bytes)
  return {
    data,
    format,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
    bytes: bytes.byteLength,
  }
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
  return out
}

export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  return pngSize(bytes) ?? jpegSize(bytes)
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return undefined
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return undefined
  return { width: uint32(bytes, 16), height: uint32(bytes, 20) }
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    if (marker === 0xd9 || marker === 0xda) return undefined
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2) return undefined
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!
      return { width, height }
    }
    offset += 2 + length
  }
  return undefined
}

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}