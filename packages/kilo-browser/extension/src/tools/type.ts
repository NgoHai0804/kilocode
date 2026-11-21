import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import * as input from "../cdp/domains/input"
import { bool } from "../util/value"
import { invalid, noTarget, throwIfAborted } from "../rpc/failure"
import { assertInteractable, currentOrigin, focus, inspect, objectId, resolveTarget, scroll, select } from "./target"

const MAX_TEXT = 4000

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  if (typeof params.text !== "string") throw invalid("text", "must be a string")
  if (params.text.length > MAX_TEXT) throw invalid("text", `must be at most ${MAX_TEXT} characters`)
  const text = params.text
  const clear = bool(params.clear) === true
  const submit = bool(params.submit) === true

  await currentOrigin(ctx)
  throwIfAborted(signal)
  const target = await resolveTarget(params, ctx)
  await scroll(ctx, target)
  const id = await objectId(ctx, target)
  const state = await inspect(ctx, id)
  assertInteractable(state)
  if (state.readOnly) throw noTarget("element_readonly")
  if (!(await focus(ctx, id))) throw noTarget("focus_failed")

  if (clear) {
    await select(ctx, id)
    await input.dispatchKey(ctx.session, "Backspace")
  }
  throwIfAborted(signal)
  await input.insertText(ctx.session, text)
  if (submit) await input.dispatchKey(ctx.session, "Enter")
  return {
    typed: text.length,
    ...(target.ref ? { ref: target.ref } : {}),
    submitted: submit,
    url: ctx.session.url ?? "",
  }
}