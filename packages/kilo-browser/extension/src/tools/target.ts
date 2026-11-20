import type { Json } from "../util/value"
import type { ToolContext } from "../tools/context"
import type { Point } from "../cdp/domains/input"
import * as dom from "../cdp/domains/dom"
import * as input from "../cdp/domains/input"
import { checkUrl } from "../policy/origin"
import { invalid, noTarget, policyDenied } from "../rpc/failure"
import { errorMessage, num, record } from "../util/value"
import { optionalString } from "../tools/params"

export type Target = {
  backendNodeId: number
  ref?: string
}

export type ElementState = {
  tag: string
  disabled: boolean
  readOnly: boolean
  visible: boolean
  hit: boolean
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

const STATE_FUNCTION = `function () {
  const rect = this.getBoundingClientRect()
  const style = getComputedStyle(this)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const top = document.elementFromPoint(cx, cy)
  return {
    tag: (this.tagName || "").toLowerCase(),
    disabled: this.disabled === true || this.getAttribute("aria-disabled") === "true",
    readOnly: this.readOnly === true || this.getAttribute("aria-readonly") === "true",
    visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0",
    hit: top === this || (top !== null && this.contains(top)),
    x: cx,
    y: cy,
    width: rect.width,
    height: rect.height,
    dpr: window.devicePixelRatio || 1
  }
}`

export async function currentOrigin(ctx: ToolContext): Promise<string> {
  if (!ctx.session.tab) throw noTarget("no_tab")
  const url = ctx.session.url
  if (!url) throw noTarget("no_page")
  const origins = await ctx.allowlist()
  const check = checkUrl(url, origins)
  if (!check.ok) throw policyDenied(check.reason, url)
  return check.url.toString()
}

export async function resolveTarget(params: Json, ctx: ToolContext): Promise<Target> {
  const ref = optionalString(params.ref, "ref")
  if (ref !== undefined) {
    const target = ctx.refs.resolve(ref)
    return { backendNodeId: target.backendNodeId, ref }
  }
  const selector = optionalString(params.selector, "selector")
  if (selector === undefined) throw invalid("ref", "ref or selector is required")
  const root = await dom.getDocument(ctx.session)
  const index = dom.indexDocument(root)
  const nodeId = await dom.querySelector(ctx.session, index.rootNodeId, selector).catch((err: unknown) => {
    throw invalid("selector", errorMessage(err))
  })
  if (nodeId === undefined || nodeId === 0) throw noTarget("selector_not_found")
  const node = index.byNode.get(nodeId)
  if (!node || node.backendNodeId <= 0) throw noTarget("selector_not_found")
  return { backendNodeId: node.backendNodeId }
}

export async function objectId(ctx: ToolContext, target: Target): Promise<string> {
  const id = await dom.resolveNode(ctx.session, target.backendNodeId).catch((err: unknown) => {
    throw noTarget(`element_detached:${errorMessage(err)}`)
  })
  if (!id) throw noTarget("element_detached")
  return id
}

export async function scroll(ctx: ToolContext, target: Target) {
  await dom.scrollIntoView(ctx.session, target.backendNodeId).catch((err: unknown) => {
    throw noTarget(`scroll_failed:${errorMessage(err)}`)
  })
}

export async function inspect(ctx: ToolContext, id: string): Promise<ElementState> {
  const result = await ctx.session
    .send("Runtime.callFunctionOn", {
      objectId: id,
      functionDeclaration: STATE_FUNCTION,
      returnByValue: true,
      awaitPromise: false,
    })
    .catch((err: unknown) => {
      throw noTarget(`element_detached:${errorMessage(err)}`)
    })
  if (record(result.exceptionDetails)) throw noTarget("element_detached")
  const state = record(record(result.result)?.value)
  if (!state) throw noTarget("element_detached")
  return {
    tag: typeof state.tag === "string" ? state.tag : "",
    disabled: state.disabled === true,
    readOnly: state.readOnly === true,
    visible: state.visible === true,
    hit: state.hit === true,
    x: num(state.x) ?? 0,
    y: num(state.y) ?? 0,
    width: num(state.width) ?? 0,
    height: num(state.height) ?? 0,
    dpr: num(state.dpr) ?? 1,
  }
}

export async function focus(ctx: ToolContext, id: string): Promise<boolean> {
  const result = await ctx.session.send("Runtime.callFunctionOn", {
    objectId: id,
    functionDeclaration: `function () { if (typeof this.focus === "function") this.focus(); return document.activeElement === this }`,
    returnByValue: true,
    awaitPromise: false,
  })
  return record(result.result)?.value === true
}

export async function select(ctx: ToolContext, id: string) {
  await ctx.session.send("Runtime.callFunctionOn", {
    objectId: id,
    functionDeclaration: `function () {
      if (typeof this.select === "function") {
        this.select()
        return true
      }
      if (this.isContentEditable) {
        const range = document.createRange()
        range.selectNodeContents(this)
        const selection = window.getSelection()
        if (selection) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
        return true
      }
      return false
    }`,
    returnByValue: true,
    awaitPromise: false,
  })
}

export async function center(ctx: ToolContext, target: Target, state: ElementState): Promise<Point> {
  const model = await dom.boxModel(ctx.session, target.backendNodeId).catch((err: unknown) => {
    throw noTarget(`box_model_failed:${errorMessage(err)}`)
  })
  const point = input.centerOf(model)
  if (point) return point
  if (state.width <= 0 || state.height <= 0) throw noTarget("element_not_visible")
  return { x: state.x, y: state.y }
}

export async function pressKey(ctx: ToolContext, key: string, modifiers = 0) {
  await input.dispatchKey(ctx.session, key, { modifiers })
}

export function assertInteractable(state: ElementState) {
  if (state.disabled) throw noTarget("element_disabled")
  if (!state.visible) throw noTarget("element_not_visible")
  if (!state.hit) throw noTarget("element_covered")
}