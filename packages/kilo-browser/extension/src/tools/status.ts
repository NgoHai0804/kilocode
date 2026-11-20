import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted } from "../rpc/failure"

export async function run(_params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  throwIfAborted(signal)
  const tab = ctx.session.tab
  return {
    paired: ctx.paired(),
    tab: tab
      ? {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          attached: tab.attached,
        }
      : null,
    cdp: ctx.session.attached,
  }
}