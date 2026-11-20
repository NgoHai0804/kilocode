import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as input from "../cdp/domains/input"
import { invalid, noTarget, throwIfAborted } from "../rpc/failure"
import { optionalString, requiredString } from "./params"
import { currentOrigin, focus, hasFocus, inspect, objectId, resolveTarget, scroll } from "./target"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const key = requiredString(params.key, "key")
  if (!input.keyInfo(key)) throw invalid("key", "unsupported key")
  await currentOrigin(ctx)
  throwIfAborted(signal)

  const ref = optionalString(params.ref, "ref")
  if (ref !== undefined) {
    const target = await resolveTarget({ ref }, ctx)
    await scroll(ctx, target)
    const id = await objectId(ctx, target)
    const state = await inspect(ctx, id)
    if (state.disabled) throw noTarget("element_disabled")
    if (!(await focus(ctx, id))) throw noTarget("focus_failed")
  } else if (!(await hasFocus(ctx))) {
    throw noTarget("no_focus")
  }

  throwIfAborted(signal)
  await input.dispatchKey(ctx.session, key)
  await ctx.session.readPageInfo()
  return { pressed: key, url: ctx.session.url ?? "" }
}