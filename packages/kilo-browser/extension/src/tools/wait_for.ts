import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as dom from "../cdp/domains/dom"
import { invalid, timeout, throwIfAborted } from "../rpc/failure"
import { errorMessage } from "../util/value"
import { enumValue, integer, optionalString } from "./params"

const STATES = ["visible", "hidden", "attached", "detached"] as const
type WaitState = (typeof STATES)[number]

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const text = optionalString(params.text, "text")
  const selector = optionalString(params.selector, "selector")
  const urlIncludes = optionalString(params.urlIncludes, "urlIncludes")
  if (text === undefined && selector === undefined && urlIncludes === undefined) {
    throw invalid("condition", "text, selector, or urlIncludes is required")
  }
  const state = enumValue(params.state, "state", STATES, "visible")
  const timeoutMs = integer(params.timeoutMs, "timeoutMs", 10000, 1, 30000)
  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    throwIfAborted(signal)
    if (await matches(ctx, { text, selector, urlIncludes, state })) {
      const info = await ctx.session.readPageInfo()
      return {
        matched: true,
        elapsedMs: Date.now() - started,
        url: info.url ?? ctx.session.url ?? "",
      }
    }
    await sleep(100)
  }
  throw timeout("browser.wait_for", timeoutMs)
}

type Condition = {
  text?: string
  selector?: string
  urlIncludes?: string
  state: WaitState
}

async function matches(ctx: ToolContext, condition: Condition): Promise<boolean> {
  if (condition.text !== undefined) {
    const value = await pageText(ctx)
    const present = value.includes(condition.text)
    if (!presentMatches(present, condition.state)) return false
  }
  if (condition.urlIncludes !== undefined) {
    const info = await ctx.session.readPageInfo()
    const url = info.url ?? ctx.session.url ?? ""
    if (!url.includes(condition.urlIncludes)) return false
  }
  if (condition.selector !== undefined) {
    const found = await selectorState(ctx, condition.selector)
    if (!presentMatches(found, condition.state)) return false
  }
  return true
}

function presentMatches(present: boolean, state: WaitState): boolean {
  if (state === "visible" || state === "attached") return present
  return !present
}

async function pageText(ctx: ToolContext): Promise<string> {
  const result = await ctx.session.send("Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
    awaitPromise: false,
  })
  const value = result.result
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ""
  const record = value as Record<string, unknown>
  return typeof record.value === "string" ? record.value : ""
}

async function selectorState(ctx: ToolContext, selector: string): Promise<boolean> {
  const root = await dom.getDocument(ctx.session)
  const index = dom.indexDocument(root)
  const nodeId = await dom.querySelector(ctx.session, index.rootNodeId, selector).catch((err: unknown) => {
    throw invalid("selector", errorMessage(err))
  })
  if (nodeId === undefined || nodeId === 0) return false
  const node = index.byNode.get(nodeId)
  if (!node || node.backendNodeId <= 0) return false
  try {
    const model = await dom.boxModel(ctx.session, node.backendNodeId)
    const content = model.content
    if (typeof content !== "object" || content === null) return false
    const quad = (content as Record<string, unknown>).quad
    return Array.isArray(quad) && quad.length >= 8
  } catch {
    return false
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}