export type ApprovalDecision = "allow-once" | "allow-tab"

export type ApprovalRecord = {
  decision: ApprovalDecision
  tabId?: number
  expiresAt: number
}

export type ApprovalRegistryOptions = {
  now?: () => number
  tabTtlMs?: number
}

export class ApprovalRegistry {
  private readonly now: () => number
  private readonly tabTtlMs: number
  private tab?: { tabId: number; expiresAt: number }

  constructor(options: ApprovalRegistryOptions = {}) {
    this.now = options.now ?? Date.now
    this.tabTtlMs = options.tabTtlMs ?? 15 * 60_000
  }

  grant(decision: ApprovalDecision, tabId?: number): ApprovalRecord {
    const expiresAt = this.now() + this.tabTtlMs
    if (decision === "allow-tab" && tabId !== undefined) this.tab = { tabId, expiresAt }
    return { decision, tabId, expiresAt }
  }

  check(input: unknown, tabId?: number): ApprovalRecord | undefined {
    if (!isRecord(input)) return undefined
    const decision = input.decision
    const expiresAt = input.expiresAt
    if (typeof expiresAt !== "number" || expiresAt <= this.now()) return undefined
    if (decision === "allow-once") {
      const approvalTab = typeof input.tabId === "number" ? input.tabId : tabId
      if (tabId !== undefined && approvalTab !== undefined && approvalTab !== tabId) return undefined
      return { decision, tabId: approvalTab, expiresAt }
    }
    if (decision !== "allow-tab") return undefined
    const requestedTab = typeof input.tabId === "number" ? input.tabId : tabId
    if (requestedTab !== undefined) {
      if (this.tab && this.tab.tabId === requestedTab && this.tab.expiresAt > this.now()) {
        return { decision, tabId: requestedTab, expiresAt: Math.min(expiresAt, this.tab.expiresAt) }
      }
      return { decision, tabId: requestedTab, expiresAt }
    }
    return undefined
  }

  clear() {
    this.tab = undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}