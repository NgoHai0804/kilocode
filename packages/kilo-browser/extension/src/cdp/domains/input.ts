import type { CdpConnection, Json } from "../types"
import { num, record, text } from "../../util/value"

export type Point = { x: number; y: number }

export async function enableInput(cdp: CdpConnection) {
  await cdp.send("Input.setIgnoreInputEvents", { ignore: false })
}

export async function moveMouse(cdp: CdpConnection, point: Point, buttons = 0) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons })
}

export async function clickPoint(
  cdp: CdpConnection,
  point: Point,
  options: { button?: "left" | "right" | "middle"; clickCount?: number } = {},
) {
  const button = options.button ?? "left"
  const clickCount = options.clickCount ?? 1
  await moveMouse(cdp, point)
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button,
    clickCount,
    buttons: button === "left" ? 1 : button === "right" ? 2 : 4,
  })
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button,
    clickCount,
    buttons: 0,
  })
}

export type KeyInfo = {
  code: string
  keyCode: number
  text?: string
}

export const KEYS: Record<string, KeyInfo> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  " ": { code: "Space", keyCode: 32, text: " " },
}

export function keyInfo(key: string): KeyInfo | undefined {
  if (KEYS[key]) return KEYS[key]
  if (key.length === 1) return { code: key, keyCode: key.charCodeAt(0), text: key }
  if (/^F([1-9]|1[0-2])$/.test(key)) return { code: key, keyCode: 112 + Number(key.slice(1)) - 1 }
  return undefined
}

export async function dispatchKey(
  cdp: CdpConnection,
  key: string,
  options: { text?: string; modifiers?: number } = {},
) {
  const info = keyInfo(key)
  if (!info) throw new Error(`unsupported key: ${key}`)
  const base: Json = {
    key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    modifiers: options.modifiers ?? 0,
  }
  const textValue = options.text ?? info.text
  await cdp.send("Input.dispatchKeyEvent", textValue === undefined ? { ...base, type: "keyDown" } : { ...base, type: "keyDown", text: textValue })
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" })
}

export async function insertText(cdp: CdpConnection, textValue: string) {
  await cdp.send("Input.insertText", { text: textValue })
}

export function centerOf(model: Json): Point | undefined {
  const content = record(model.content)
  const quad = Array.isArray(content?.quad) ? content.quad : []
  if (quad.length < 8) return undefined
  const values = quad.map((item) => (typeof item === "number" ? item : Number.NaN))
  if (values.some((value) => !Number.isFinite(value))) return undefined
  const x = (values[0]! + values[2]! + values[4]! + values[6]!) / 4
  const y = (values[1]! + values[3]! + values[5]! + values[7]!) / 4
  return { x, y }
}

export function modelValue(model: Json, key: string): number | undefined {
  return num(model[key])
}

export function nodeDescription(node: Json): string | undefined {
  return text(node.nodeName)
}
