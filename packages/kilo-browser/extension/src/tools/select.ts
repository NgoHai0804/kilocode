import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { invalid, noTarget, throwIfAborted } from "../rpc/failure"
import { record } from "../util/value"
import { optionalInteger, optionalString } from "./params"
import { objectId, resolveTarget, scroll as scrollIntoView } from "./target"
import { callObject, SELECT_FN } from "./dom_ops"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const value = optionalString(params.value, "value")
  const label = optionalString(params.label, "label")
  const index = optionalInteger(params.index, "index", 0, 100000)
  if (value === undefined && label === undefined && index === undefined) {
    throw invalid("option", "value, label, or index is required")
  }
  throwIfAborted(signal)

  const target = await resolveTarget(params, ctx)
  await scrollIntoView(ctx, target)
  const id = await objectId(ctx, target)
  const payload: Record<string, unknown> = {}
  if (value !== undefined) payload.value = value
  if (label !== undefined) payload.label = label
  if (index !== undefined) payload.index = index
  const raw = await callObject(ctx, id, SELECT_FN, [payload])
  throwIfAborted(signal)
  const result = record(raw) ?? {}
  if (result.ok !== true) throw noTarget("option_not_found")
  await ctx.session.readPageInfo()
  return {
    selected: typeof result.value === "string" ? result.value : "",
    label: typeof result.label === "string" ? result.label : "",
    ...(target.ref ? { ref: target.ref } : {}),
  }
}
