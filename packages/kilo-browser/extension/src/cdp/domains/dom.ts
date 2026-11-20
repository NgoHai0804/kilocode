import type { CdpConnection, Json } from "../types"
import { array, num, record, text } from "../../util/value"

export type DomNode = {
  nodeId: number
  backendNodeId: number
  parentId?: number
  tag: string
  frameId?: string
  depth: number
  children: number[]
}

export type DomIndex = {
  rootNodeId: number
  nodes: Map<number, DomNode>
  byBackend: Map<number, DomNode>
  byNode: Map<number, DomNode>
}

export async function getDocument(cdp: CdpConnection): Promise<Json> {
  const result = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
  return record(result.root) ?? {}
}

export async function querySelector(cdp: CdpConnection, nodeId: number, selector: string): Promise<number | undefined> {
  const result = await cdp.send("DOM.querySelector", { nodeId, selector })
  return num(result.nodeId)
}

export async function describeNode(cdp: CdpConnection, backendNodeId: number): Promise<Json> {
  const result = await cdp.send("DOM.describeNode", { backendNodeId })
  return record(result.node) ?? {}
}

export async function resolveNode(cdp: CdpConnection, backendNodeId: number): Promise<string | undefined> {
  const result = await cdp.send("DOM.resolveNode", { backendNodeId })
  const object = record(result.object)
  return object ? text(object.objectId) : undefined
}

export async function boxModel(cdp: CdpConnection, backendNodeId: number): Promise<Json> {
  const result = await cdp.send("DOM.getBoxModel", { backendNodeId })
  return record(result.model) ?? {}
}

export async function scrollIntoView(cdp: CdpConnection, backendNodeId: number) {
  await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId })
}

export function indexDocument(root: Json): DomIndex {
  const nodes = new Map<number, DomNode>()
  const byBackend = new Map<number, DomNode>()
  const byNode = new Map<number, DomNode>()
  const rootNodeId = num(root.nodeId) ?? 0
  walk(root, 0, undefined, nodes, byBackend, byNode)
  return { rootNodeId, nodes, byBackend, byNode }
}

function walk(
  value: Json,
  depth: number,
  parentId: number | undefined,
  nodes: Map<number, DomNode>,
  byBackend: Map<number, DomNode>,
  byNode: Map<number, DomNode>,
) {
  const nodeId = num(value.nodeId)
  const backendNodeId = num(value.backendNodeId)
  if (nodeId === undefined || backendNodeId === undefined) return
  const tag = (text(value.localName) ?? text(value.nodeName) ?? "").toLowerCase()
  const frameId = text(value.frameId)
  const children = array(value.children)
  const childIds: number[] = []
  for (const child of children) {
    const item = record(child)
    if (!item) continue
    const id = num(item.nodeId)
    if (id !== undefined) childIds.push(id)
  }
  const node: DomNode = { nodeId, backendNodeId, parentId, tag, frameId, depth, children: childIds }
  nodes.set(nodeId, node)
  byNode.set(nodeId, node)
  if (backendNodeId > 0) byBackend.set(backendNodeId, node)
  for (const child of children) {
    const item = record(child)
    if (item) walk(item, depth + 1, nodeId, nodes, byBackend, byNode)
  }
}

export function subtree(index: DomIndex, nodeId: number): Set<number> {
  const out = new Set<number>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined || out.has(current)) continue
    out.add(current)
    const node = index.byNode.get(current)
    if (node) stack.push(...node.children)
  }
  return out
}

export function backendSubtree(index: DomIndex, backendNodeId: number): Set<number> {
  const node = index.byBackend.get(backendNodeId)
  if (!node) return new Set()
  const ids = subtree(index, node.nodeId)
  const out = new Set<number>()
  for (const id of ids) {
    const item = index.byNode.get(id)
    if (item && item.backendNodeId > 0) out.add(item.backendNodeId)
  }
  return out
}

export function nodeValue(node: Json, key: string): string | undefined {
  const value = record(node[key])
  return value ? text(value.value) : undefined
}