import type { BrowserConfig } from "../config/schema"

export type EvalApprovalDecision = "allow-once" | "allow-tab" | "deny" | "timeout" | "missing"

export type EvalApproval = {
  decision: EvalApprovalDecision
  tabId?: number
  expiresAt?: number
  requestId?: string
}

export type EvalDecision = "deny" | "ask" | "allow"

export function decideEval(
  config: Pick<BrowserConfig, "tools">,
  approval: EvalApproval | undefined,
  now = Date.now(),
): EvalDecision {
  const policy = config.tools.eval
  if (policy === "deny") return "deny"
  if (policy !== "ask") return "deny"
  if (!approval) return "ask"
  if (approval.decision === "deny" || approval.decision === "timeout" || approval.decision === "missing") {
    return "deny"
  }
  if (approval.expiresAt !== undefined && approval.expiresAt <= now) return "deny"
  if (approval.decision === "allow-once" || approval.decision === "allow-tab") return "allow"
  return "deny"
}