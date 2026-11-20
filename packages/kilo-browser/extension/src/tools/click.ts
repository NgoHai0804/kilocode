import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as input from "../cdp/domains/input"
import { throwIfAborted } from "../rpc/failure"
import { assertInteractable, center, currentOrigin, inspect, objectId, resolveTarget, scroll } from "./target"
import { enumValue, optionalInteger } from "./params"

const BUTTONS = ["left", "right", "middle"] as const

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const button = enumValue(params.button, "button", BUTTONS, "left")
  const clickCount = optionalInteger(params.clickCount, "clickCount", 1, 3) ?? 1
  await currentOrigin(ctx)
  throwIfAborted(signal)
  const target = await resolveTarget(params, ctx)
  await scroll(ctx, target)
  const id = await objectId(ctx, target)
  const state = await inspect(ctx, id)
  assertInteractable(state)
  throwIfAborted(signal)
  const point = await center(ctx, target, state)
  await input.clickPoint(ctx.session, point, { button, clickCount })
  throwIfAborted(signal)
  await ctx.session.readPageInfo()
  return {
    clicked: true,
    ...(target.ref ? { ref: target.ref } : {}),
    url: ctx.session.url ?? "",
  }
}