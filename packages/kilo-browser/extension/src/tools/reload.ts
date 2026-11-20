import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import type { WaitUntil } from "../cdp/domains/page"
import { bool } from "../util/value"
import { throwIfAborted } from "../rpc/failure"
import { enumValue } from "./params"
import { currentOrigin } from "./target"

const WAIT_UNTIL: readonly WaitUntil[] = ["load", "domcontentloaded", "networkidle"]

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const ignoreCache = bool(params.ignoreCache) === true
  const waitUntil = enumValue(params.waitUntil, "waitUntil", WAIT_UNTIL, "load")
  await currentOrigin(ctx)
  throwIfAborted(signal)
  const started = Date.now()
  const result = await ctx.session.reload(ignoreCache, waitUntil, 15000)
  throwIfAborted(signal)
  return {
    url: result.url,
    status: result.status,
    durationMs: Date.now() - started,
  }
}