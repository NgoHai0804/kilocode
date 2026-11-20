import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import type { WaitUntil } from "../cdp/domains/page"
import { checkUrl } from "../policy/origin"
import { invalid, policyDenied, throwIfAborted } from "../rpc/failure"
import { enumValue, integer, requiredString } from "./params"

const WAIT_UNTIL: readonly WaitUntil[] = ["load", "domcontentloaded", "networkidle"]

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const url = requiredString(params.url, "url")
  if (url.length > 2048) throw invalid("url", "must be at most 2048 characters")
  const waitUntil = enumValue(params.waitUntil, "waitUntil", WAIT_UNTIL, "load")
  const timeoutMs = integer(params.timeoutMs, "timeoutMs", 15000, 1, 30000)

  const origins = await ctx.allowlist()
  const target = checkUrl(url, origins)
  if (!target.ok) throw policyDenied(target.reason, url)

  throwIfAborted(signal)
  const result = await ctx.session.navigate(target.url.toString(), { waitUntil, timeoutMs })
  throwIfAborted(signal)
  return { url: result.url, title: result.title, status: result.status }
}