import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted, unavailable } from "../rpc/failure"
import { requiredInteger } from "./params"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const tabId = requiredInteger(params.tabId, "tabId", 1, Number.MAX_SAFE_INTEGER)
  if (!ctx.tabs) throw unavailable("tab_control_unavailable")
  throwIfAborted(signal)
  const tab = await ctx.tabs.switchTo(tabId)
  throwIfAborted(signal)
  return { ...tab }
}
