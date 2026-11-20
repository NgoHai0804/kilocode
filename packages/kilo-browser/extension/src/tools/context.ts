import type { Json } from "../util/value"
import type { CdpSession } from "../cdp/session"
import type { ConsoleBuffer, NetworkBuffer } from "../buffers/ring"
import type { RefRegistry } from "../refs/registry"
import type { ApprovalRegistry } from "../approval/registry"

export type TabSummary = {
  id: number
  windowId?: number
  url?: string
  title?: string
  active: boolean
  attached: boolean
  attachable: boolean
}

/** Read open tabs and drive the agent onto a specific one. */
export type TabControl = {
  list: () => Promise<TabSummary[]>
  switchTo: (tabId: number) => Promise<TabSummary>
}

export type ToolContext = {
  session: CdpSession
  refs: RefRegistry
  console: ConsoleBuffer
  network: NetworkBuffer
  allowlist: () => Promise<string[]>
  paired: () => boolean
  approval?: ApprovalRegistry
  tabs?: TabControl
  onEvent?: (event: { type: string; data: Json }) => void
}

export type ToolHandler = (params: Json, ctx: ToolContext, signal: AbortSignal) => Promise<Json>