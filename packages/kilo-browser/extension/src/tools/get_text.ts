import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted } from "../rpc/failure"
import { integer, optionalString } from "./params"
import { objectId, resolveTarget } from "./target"
import { callObject, clip, pageText, TEXT_FN } from "./dom_ops"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const ref = optionalString(params.ref, "ref")
  const selector = optionalString(params.selector, "selector")
  const maxBytes = integer(params.maxBytes, "maxBytes", 65536, 1, 1048576)
  throwIfAborted(signal)

  if (ref === undefined && selector === undefined) {
    const value = await pageText(ctx)
    throwIfAborted(signal)
    const clipped = clip(value, maxBytes)
    return { text: clipped.value, truncated: clipped.truncated, url: ctx.session.url ?? "" }
  }

  const target = await resolveTarget({ ref, selector }, ctx)
  const id = await objectId(ctx, target)
  const raw = await callObject(ctx, id, TEXT_FN)
  throwIfAborted(signal)
  const clipped = clip(typeof raw === "string" ? raw : "", maxBytes)
  return {
    ...(target.ref ? { ref: target.ref } : {}),
    text: clipped.value,
    truncated: clipped.truncated,
    url: ctx.session.url ?? "",
  }
}
