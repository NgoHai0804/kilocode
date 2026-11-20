import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { RpcFailure } from "../../../src/protocol/rpc"
import { invalid, noTarget, throwIfAborted } from "../rpc/failure"
import { redactText } from "../policy/redact"
import { bool, num, record, text } from "../util/value"
import { exceptionText } from "../cdp/domains/runtime"

const MAX_EXPRESSION = 8192
const MAX_RESULT = 64 * 1024

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  if (typeof params.expression !== "string") throw invalid("expression", "must be a string")
  const expression = params.expression
  if (expression.length > MAX_EXPRESSION) throw invalid("expression", `must be at most ${MAX_EXPRESSION} characters`)
  const approval = ctx.approval?.check(params.approval, ctx.session.tabId)
  if (!approval) throw new RpcFailure("APPROVAL_TIMEOUT", { tool: "browser.eval", reason: "missing_approval" })
  const awaitPromise = bool(params.awaitPromise) !== false
  const returnByValue = bool(params.returnByValue) !== false

  ctx.onEvent?.({ type: "eval.start", data: { tabId: ctx.session.tabId, expressionBytes: expression.length } })
  await ctx.session.ensure()
  throwIfAborted(signal)
  const frameId = ctx.session.frameId
  if (!frameId) throw noTarget("no_frame")
  const world = await ctx.session.send("Page.createIsolatedWorld", { frameId, worldName: "kilo-eval" })
  const contextId = num(world.executionContextId)
  if (contextId === undefined) throw noTarget("no_isolated_world")
  throwIfAborted(signal)

  const response = await ctx.session
    .send("Runtime.evaluate", {
      expression,
      contextId,
      awaitPromise,
      returnByValue,
      userGesture: false,
      includeCommandLineAPI: false,
      silent: true,
    })
    .catch((err: unknown) => {
      throw invalid("expression", redactText(err instanceof Error ? err.message : "evaluation failed"))
    })
  throwIfAborted(signal)

  const exception = record(response.exceptionDetails)
  if (exception) {
    throw invalid("expression", redactText(exceptionText(exception)))
  }
  const remote = record(response.result) ?? {}
  const type = text(remote.type) ?? "undefined"
  if (type === "function" || type === "symbol" || type === "bigint") {
    throw invalid("expression", "result is not serializable")
  }
  if (!returnByValue) {
    const description = text(remote.description) ?? `[${type}]`
    return finish(ctx, { value: description, type, truncated: false })
  }
  if (remote.objectId !== undefined && remote.value === undefined) {
    throw invalid("expression", "result is not serializable; return a primitive or JSON object")
  }
  const value = type === "undefined" ? null : text(remote.unserializableValue) ?? remote.value
  let body: string
  try {
    body = JSON.stringify(value === undefined ? null : value)
  } catch {
    throw invalid("expression", "result is not serializable")
  }
  if (body === undefined) throw invalid("expression", "result is not serializable")
  if (body.length <= MAX_RESULT) return finish(ctx, { value, type, truncated: false })
  return finish(ctx, { value: body.slice(0, MAX_RESULT), type: "string", truncated: true })
}

function finish(ctx: ToolContext, result: { value: unknown; type: string; truncated: boolean }) {
  ctx.onEvent?.({ type: "eval.end", data: { tabId: ctx.session.tabId, truncated: result.truncated } })
  return result
}
