import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted } from "../rpc/failure"
import { integer, optionalString } from "./params"
import { objectId, resolveTarget } from "./target"
import { callObject, clip, HTML_FN } from "./dom_ops"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const selector = optionalString(params.selector, "selector")
  const ref = optionalString(params.ref, "ref")
  const maxBytes = integer(params.maxBytes, "maxBytes", 131072, 1, 1048576)
  throwIfAborted(signal)

  const target = await resolveTarget({ ref, selector }, ctx)
  const id = await objectId(ctx, target)
  const raw = await callObject(ctx, id, HTML_FN)
  throwIfAborted(signal)
  const clipped = clip(typeof raw === "string" ? raw : "", maxBytes)
  return {
    ...(target.ref ? { ref: target.ref } : {}),
    html: clipped.value,
    truncated: clipped.truncated,
  }
}
