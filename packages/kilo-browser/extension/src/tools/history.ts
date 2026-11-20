import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { throwIfAborted } from "../rpc/failure"
import { array, num, record } from "../util/value"
import { enumValue } from "./params"

const ACTIONS = ["back", "forward"] as const

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const action = enumValue(params.action, "action", ACTIONS, "back")
  throwIfAborted(signal)
  const before = ctx.session.url ?? ""
  const raw = await ctx.session.send("Page.getNavigationHistory", {})
  const entries = array(record(raw)?.entries)
  const index = num(record(raw)?.currentIndex) ?? entries.length - 1
  const nextIndex = action === "back" ? index - 1 : index + 1
  const entry = record(entries[nextIndex])
  const entryId = entry ? num(entry.id) : undefined
  if (entryId === undefined) return { changed: false, action, url: before }

  await ctx.session.send("Page.navigateToHistoryEntry", { entryId })
  const deadline = Date.now() + 5000
  let info = await ctx.session.readPageInfo()
  while (Date.now() < deadline && (info.url ?? "") === before) {
    await sleep(100)
    info = await ctx.session.readPageInfo()
  }
  return {
    changed: (info.url ?? "") !== before,
    action,
    url: info.url ?? ctx.session.url ?? "",
    title: info.title ?? "",
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
