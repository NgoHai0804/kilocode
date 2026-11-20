import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { invalid, throwIfAborted } from "../rpc/failure"
import { array } from "../util/value"
import { integer, optionalString } from "./params"
import { callObject, documentObject, FIND_FN } from "./dom_ops"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const selector = optionalString(params.selector, "selector")
  const needle = optionalString(params.text, "text")
  const role = optionalString(params.role, "role")
  const limit = integer(params.limit, "limit", 40, 1, 200)
  if (selector === undefined && needle === undefined && role === undefined) {
    throw invalid("condition", "selector, text, or role is required")
  }
  throwIfAborted(signal)

  const doc = await documentObject(ctx)
  const payload: Record<string, unknown> = { limit }
  if (selector !== undefined) payload.selector = selector
  if (needle !== undefined) payload.text = needle
  if (role !== undefined) payload.role = role
  const raw = await callObject(ctx, doc, FIND_FN, [payload])
  throwIfAborted(signal)
  const matches = array(raw)
  return { count: matches.length, matches }
}
