import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted, unavailable } from "../rpc/failure"

export async function run(_params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  throwIfAborted(signal)
  if (!ctx.tabs) throw unavailable("tab_control_unavailable")
  const list = await ctx.tabs.list()
  throwIfAborted(signal)
  return { count: list.length, tabs: list }
}
