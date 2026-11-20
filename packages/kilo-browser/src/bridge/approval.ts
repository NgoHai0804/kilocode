import { randomUUID } from "node:crypto"
import type { EvalApprovalDecision, EvalApproval } from "../plugin/eval"

export type ApprovalRequest = {
  tool: string
  method: string
  origin?: string
  preview: string
  sessionID?: string
  callID?: string
  tabId?: number
}

export type ApprovalReplyDecision = "allow-once" | "allow-tab" | "deny"

export type ApprovalResult = EvalApproval & {
  requestId: string
  decision: EvalApprovalDecision
}

type Pending = {
  deferred: PromiseWithResolvers<ApprovalResult>
  timer: ReturnType<typeof setTimeout>
  request: ApprovalRequest
}

export type ApprovalOptions = {
  timeoutMs?: number
  tabTtlMs?: number
  now?: () => number
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
}

export class ApprovalGate {
  private readonly timeoutMs: number
  private readonly tabTtlMs: number
  private readonly now: () => number
  private readonly onEvent?: ApprovalOptions["onEvent"]
  private pending = new Map<string, Pending>()
  private tab?: { tabId: number; expiresAt: number }

  constructor(options: ApprovalOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.tabTtlMs = options.tabTtlMs ?? 15 * 60_000
    this.now = options.now ?? Date.now
    this.onEvent = options.onEvent
  }

  async request(request: ApprovalRequest): Promise<ApprovalResult> {
    if (request.tabId !== undefined && this.tab && this.tab.tabId === request.tabId) {
      if (this.tab.expiresAt > this.now()) {
        return { decision: "allow-tab", tabId: request.tabId, expiresAt: this.tab.expiresAt, requestId: "cached" }
      }
      this.tab = undefined
    }
    const requestId = randomUUID()
    const deferred = Promise.withResolvers<ApprovalResult>()
    const timer = setTimeout(() => {
      this.pending.delete(requestId)
      this.onEvent?.({ type: "permission.timeout", data: { requestID: requestId, tool: request.tool } })
      deferred.resolve({ decision: "timeout", requestId, tabId: request.tabId })
    }, this.timeoutMs)
    this.pending.set(requestId, { deferred, timer, request })
    this.onEvent?.({
      type: "permission.asked",
      data: {
        requestID: requestId,
        tool: request.tool,
        method: request.method,
        origin: request.origin,
        preview: request.preview.slice(0, 500),
        expiresInMs: this.timeoutMs,
      },
    })
    return deferred.promise
  }

  reply(requestId: string, decision: ApprovalReplyDecision, tabId?: number): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    const targetTab = tabId ?? pending.request.tabId
    const expiresAt = decision === "allow-tab"
      ? this.now() + this.tabTtlMs
      : decision === "allow-once"
        ? this.now() + this.timeoutMs
        : undefined
    if (decision === "allow-tab" && targetTab !== undefined && expiresAt !== undefined) {
      this.tab = { tabId: targetTab, expiresAt }
    }
    this.onEvent?.({
      type: "permission.replied",
      data: { requestID: requestId, tool: pending.request.tool, decision, tabId: targetTab, expiresAt },
    })
    pending.deferred.resolve({ decision, requestId, tabId: targetTab, expiresAt })
    return true
  }

  pendingCount() {
    return this.pending.size
  }

  pendingIDs() {
    return [...this.pending.keys()]
  }

  close() {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.deferred.resolve({ decision: "timeout", requestId, tabId: pending.request.tabId })
    }
    this.pending.clear()
  }
}