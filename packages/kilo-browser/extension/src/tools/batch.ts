import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { RpcFailure } from "../../../src/protocol/rpc"
import { invalid, throwIfAborted } from "../rpc/failure"
import { bool, record } from "../util/value"
import { integer } from "./params"
import * as click from "./click"
import * as fill from "./fill"
import * as type from "./type"
import * as press from "./press"
import * as hover from "./hover"
import * as select from "./select"
import * as scroll from "./scroll"
import * as waitFor from "./wait_for"
import * as navigate from "./navigate"
import * as reload from "./reload"
import * as history from "./history"
import * as getText from "./get_text"
import * as getHtml from "./get_html"
import * as attrs from "./attrs"
import * as find from "./find"
import * as outline from "./outline"
import * as snapshot from "./snapshot"
import * as consoleTool from "./console"
import * as network from "./network"
import * as status from "./status"
import * as tabs from "./tabs"
import * as switchTab from "./switch_tab"
import * as newTab from "./new_tab"
import * as closeTab from "./close_tab"

type Step = { run: (params: Json, ctx: ToolContext, signal: AbortSignal) => Promise<Json> }

// `eval` is intentionally absent: it needs user approval, which a batch would skip.
const ACTIONS: Record<string, Step> = {
  click,
  fill,
  type,
  press,
  hover,
  select,
  scroll,
  wait_for: waitFor,
  navigate,
  reload,
  history,
  get_text: getText,
  get_html: getHtml,
  attrs,
  find,
  outline,
  snapshot,
  console: consoleTool,
  network,
  status,
  tabs,
  switch_tab: switchTab,
  new_tab: newTab,
  close_tab: closeTab,
}

const MAX_STEPS = 30
const MAX_TEXT = 4000

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const raw = Array.isArray(params.steps) ? params.steps : undefined
  if (!raw || raw.length === 0) throw invalid("steps", "must be a non-empty array")
  if (raw.length > MAX_STEPS) throw invalid("steps", `must be at most ${MAX_STEPS} steps`)
  const stopOnError = bool(params.stopOnError) !== false
  const delay = integer(params.stepDelayMs, "stepDelayMs", 0, 0, 5000)
  throwIfAborted(signal)

  const results: Json[] = []
  let completed = 0
  for (const entry of raw) {
    throwIfAborted(signal)
    const step = record(entry)
    const action = step ? step.action : undefined
    if (typeof action !== "string") {
      results.push({ action: "(missing)", ok: false, error: { kind: "INVALID_PARAMS", reason: "action is required" } })
      if (stopOnError) break
      continue
    }
    const handler = ACTIONS[action]
    if (!handler) {
      results.push({ action, ok: false, error: { kind: "METHOD_NOT_FOUND", reason: "unsupported action" } })
      if (stopOnError) break
      continue
    }
    const stepParams: Json = { ...(step ?? {}) }
    delete stepParams.action
    try {
      const value = await handler.run(stepParams, ctx, signal)
      results.push({ action, ok: true, result: summarize(value) })
      completed += 1
    } catch (err) {
      const error =
        err instanceof RpcFailure
          ? { kind: err.kind, reason: err.data.reason }
          : { kind: "INTERNAL_ERROR", reason: err instanceof Error ? err.message : "error" }
      results.push({ action, ok: false, error })
      if (stopOnError) break
    }
    if (delay > 0) await sleep(delay)
  }

  return { completed, total: raw.length, steps: results, url: ctx.session.url ?? "" }
}

function summarize(value: unknown, cap = MAX_TEXT): unknown {
  if (typeof value === "string") return value.length > cap ? `${value.slice(0, cap)}…` : value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => summarize(item, cap))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "data" && typeof item === "string" && item.length > 1000) {
        out[key] = `[image ${item.length} bytes]`
        continue
      }
      out[key] = summarize(item, cap)
    }
    return out
  }
  return value
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
