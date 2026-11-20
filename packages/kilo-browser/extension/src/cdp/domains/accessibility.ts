import type { CdpConnection, Json } from "../types"
import { array, num, record, text } from "../../util/value"
import type { SnapshotNode } from "../../refs/registry"
import type { DomIndex } from "./dom"

export async function fullTree(cdp: CdpConnection): Promise<Json[]> {
  const result = await cdp.send("Accessibility.getFullAXTree")
  return array(result.nodes).map((node) => record(node) ?? {})
}

export function extractNodes(nodes: Json[], index: DomIndex, allowed?: Set<number>): SnapshotNode[] {
  const depths = new Map<string, number>()
  const out: SnapshotNode[] = []
  for (const node of nodes) {
    const ignored = node.ignored === true
    const role = nodeValue(node, "role")
    const name = nodeValue(node, "name")
    const backendNodeId = num(node.backendDOMNodeId) ?? num(node.backendNodeId) ?? 0
    if (ignored || backendNodeId <= 0) continue
    if (allowed && !allowed.has(backendNodeId)) continue
    if (role.length === 0 && name.length === 0) continue
    const dom = index.byBackend.get(backendNodeId)
    const frameId = text(node.frameId) ?? dom?.frameId
    out.push({
      role,
      name,
      tag: dom?.tag ?? "",
      backendNodeId,
      frameId,
      depth: depthOf(node, nodes, depths),
    })
  }
  return out
}

export function skippedFrames(index: DomIndex): number {
  let count = 0
  for (const node of index.byNode.values()) {
    if (node.tag !== "iframe") continue
    const hasDocument = node.children.some((id) => {
      const child = index.byNode.get(id)
      return child !== undefined && child.tag === "#document"
    })
    if (!hasDocument) count += 1
  }
  return count
}

function depthOf(node: Json, nodes: Json[], cache: Map<string, number>): number {
  const id = text(node.nodeId)
  if (!id) return 0
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const parentId = text(node.parentId)
  if (!parentId) {
    cache.set(id, 0)
    return 0
  }
  const parent = nodes.find((item) => text(item.nodeId) === parentId)
  const depth = parent ? depthOf(parent, nodes, cache) + 1 : 0
  cache.set(id, depth)
  return depth
}

function nodeValue(node: Json, key: string): string {
  const value = record(node[key])
  return value ? text(value.value) ?? "" : ""
}