import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as input from "../cdp/domains/input"
import { invalid, noTarget, throwIfAborted } from "../rpc/failure"
import { bool, record } from "../util/value"
import { objectId, resolveTarget, scroll as scrollIntoView } from "./target"
import { callObject, FILL_FN } from "./dom_ops"

const MAX_TEXT = 20000

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  if (typeof params.text !== "string") throw invalid("text", "must be a string")
  if (params.text.length > MAX_TEXT) throw invalid("text", `must be at most ${MAX_TEXT} characters`)
  const value = params.text
  const submit = bool(params.submit) === true
  throwIfAborted(signal)

  const target = await resolveTarget(params, ctx)
  await scrollIntoView(ctx, target)
  const id = await objectId(ctx, target)
  const raw = await callObject(ctx, id, FILL_FN, [{ value }])
  throwIfAborted(signal)
  const result = record(raw) ?? {}
  if (result.ok !== true) throw noTarget("element_not_fillable")
  if (submit) await input.dispatchKey(ctx.session, "Enter")
  throwIfAborted(signal)
  await ctx.session.readPageInfo()
  return {
    filled: typeof result.value === "string" ? result.value.length : value.length,
    submitted: submit,
    ...(target.ref ? { ref: target.ref } : {}),
  }
}
