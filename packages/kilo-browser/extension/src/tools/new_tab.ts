import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted, unavailable } from "../rpc/failure"
import { optionalString } from "./params"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const url = optionalString(params.url, "url")
  if (!ctx.tabs) throw unavailable("tab_control_unavailable")
  throwIfAborted(signal)
  const tab = await ctx.tabs.open(url)
  throwIfAborted(signal)
  return { ...tab }
}
