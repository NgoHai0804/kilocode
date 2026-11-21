import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as input from "../cdp/domains/input"
import { noTarget, throwIfAborted } from "../rpc/failure"
import { record } from "../util/value"
import { callObject, CLICK_FN } from "./dom_ops"
import { enumValue, optionalInteger } from "./params"
import { currentOrigin, inspect, objectId, resolveTarget, scroll } from "./target"

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
  if (state.disabled) throw noTarget("element_disabled")
  if (!state.visible) throw noTarget("element_not_visible")
  throwIfAborted(signal)

  // A covered element (sticky header, transient overlay) still has a working
  // click handler, so fall back to a direct DOM click instead of failing.
  const covered = !state.hit
  if (covered) {
    const result = record(await callObject(ctx, id, CLICK_FN)) ?? {}
    if (result.ok !== true) throw noTarget(typeof result.reason === "string" ? result.reason : "element_covered")
  } else {
    await input.clickPoint(ctx.session, { x: state.x, y: state.y }, { button, clickCount })
  }
  return {
    clicked: true,
    ...(covered ? { via: "script" } : {}),
    ...(target.ref ? { ref: target.ref } : {}),
    url: ctx.session.url ?? "",
  }
}
