import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { noTarget, throwIfAborted } from "../rpc/failure"
import { optionalString } from "./params"
import { record } from "../util/value"
import { objectId, resolveTarget } from "./target"
import { ATTRS_FN, callObject } from "./dom_ops"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const ref = optionalString(params.ref, "ref")
  const selector = optionalString(params.selector, "selector")
  throwIfAborted(signal)

  const target = await resolveTarget({ ref, selector }, ctx)
  const id = await objectId(ctx, target)
  const raw = await callObject(ctx, id, ATTRS_FN)
  throwIfAborted(signal)
  const value = record(raw)
  if (!value) throw noTarget("element_detached")
  return { ...(target.ref ? { ref: target.ref } : {}), ...value }
}
