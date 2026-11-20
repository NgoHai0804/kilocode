import type { Json } from "../util/value"
import type { SnapshotNode } from "../refs/registry"
import type { ToolContext } from "./context"
import * as dom from "../cdp/domains/dom"
import * as ax from "../cdp/domains/accessibility"
import { invalid, noTarget, throwIfAborted } from "../rpc/failure"
import { integer, optionalString } from "./params"

const MODES = ["ax", "aria", "text"] as const

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const mode = parseMode(params.mode)
  const maxNodes = integer(params.maxNodes, "maxNodes", 2000, 1, 2000)
  const selector = optionalString(params.selector, "selector")

  throwIfAborted(signal)
  const root = await dom.getDocument(ctx.session)
  const index = dom.indexDocument(root)
  let allowed: Set<number> | undefined
  if (selector !== undefined) {
    const nodeId = await dom.querySelector(ctx.session, index.rootNodeId, selector)
    if (nodeId === undefined || nodeId === 0) throw noTarget("selector_not_found")
    const node = index.byNode.get(nodeId)
    if (!node) throw noTarget("selector_not_found")
    allowed = dom.backendSubtree(index, node.backendNodeId)
  }

  throwIfAborted(signal)
  const tree = await ax.fullTree(ctx.session)
  const nodes = tree.length > 0 ? ax.extractNodes(tree, index, allowed) : fallbackNodes(index, allowed)
  throwIfAborted(signal)
  const view = await ctx.refs.build(nodes, {
    maxNodes,
    skippedFrames: ax.skippedFrames(index),
    mode: mode === "text" ? "text" : "ax",
  })
  return {
    snapshotId: view.snapshotId,
    refs: view.refs,
    text: view.text,
    truncated: view.truncated,
    skippedFrames: view.skippedFrames,
  }
}

function parseMode(value: unknown): (typeof MODES)[number] {
  if (value === undefined || value === null) return "ax"
  if (typeof value !== "string" || !MODES.includes(value as (typeof MODES)[number])) {
    throw invalid("mode", `must be one of ${MODES.join(", ")}`)
  }
  return value as (typeof MODES)[number]
}

function fallbackNodes(index: dom.DomIndex, allowed?: Set<number>): SnapshotNode[] {
  const out: SnapshotNode[] = []
  for (const node of index.byNode.values()) {
    if (node.backendNodeId <= 0) continue
    if (allowed && !allowed.has(node.backendNodeId)) continue
    if (!["input", "button", "a", "select", "textarea"].includes(node.tag)) continue
    out.push({
      role: node.tag,
      name: "",
      tag: node.tag,
      backendNodeId: node.backendNodeId,
      frameId: node.frameId,
      depth: node.depth,
    })
  }
  return out
}