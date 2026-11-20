import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted } from "../rpc/failure"
import { enumValue, integer, optionalString } from "./params"
import { objectId, resolveTarget, scroll as scrollIntoView } from "./target"
import { callObject, documentObject, PAGE_SCROLL_FN, SCROLL_BLOCK_FN } from "./dom_ops"

const BLOCKS = ["start", "center", "end"] as const
const DIRECTIONS = ["up", "down", "top", "bottom"] as const

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const ref = optionalString(params.ref, "ref")
  const selector = optionalString(params.selector, "selector")
  throwIfAborted(signal)

  if (ref !== undefined || selector !== undefined) {
    const block = enumValue(params.block, "block", BLOCKS, "center")
    const target = await resolveTarget({ ref, selector }, ctx)
    await scrollIntoView(ctx, target)
    const id = await objectId(ctx, target)
    await callObject(ctx, id, SCROLL_BLOCK_FN, [{ block }])
    throwIfAborted(signal)
    await ctx.session.readPageInfo()
    return { scrolled: true, ...(target.ref ? { ref: target.ref } : {}), url: ctx.session.url ?? "" }
  }

  const direction = enumValue(params.direction, "direction", DIRECTIONS, "down")
  const amount = integer(params.amount, "amount", 400, 1, 100000)
  const doc = await documentObject(ctx)
  const position = await callObject(ctx, doc, PAGE_SCROLL_FN, [{ direction, amount }])
  throwIfAborted(signal)
  return { scrolled: true, position: position ?? null, url: ctx.session.url ?? "" }
}
