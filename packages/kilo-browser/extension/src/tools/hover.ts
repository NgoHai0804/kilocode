import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as input from "../cdp/domains/input"
import { noTarget, throwIfAborted } from "../rpc/failure"
import { inspect, objectId, resolveTarget, scroll as scrollIntoView } from "./target"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  throwIfAborted(signal)
  const target = await resolveTarget(params, ctx)
  await scrollIntoView(ctx, target)
  const id = await objectId(ctx, target)
  const state = await inspect(ctx, id)
  if (!state.visible) throw noTarget("element_not_visible")
  await input.moveMouse(ctx.session, { x: state.x, y: state.y })
  throwIfAborted(signal)
  return { hovered: true, ...(target.ref ? { ref: target.ref } : {}), url: ctx.session.url ?? "" }
}
