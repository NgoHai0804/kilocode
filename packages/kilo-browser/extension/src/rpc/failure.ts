import { RpcFailure } from "../../../src/protocol/rpc"

export function invalid(field: string, reason: string): RpcFailure {
  return new RpcFailure("INVALID_PARAMS", { field, reason })
}

export function staleRef(snapshotId?: string): RpcFailure {
  return new RpcFailure("STALE_REF", snapshotId ? { snapshotId } : {})
}

export function noTarget(reason = "tab_unavailable"): RpcFailure {
  return new RpcFailure("NO_TARGET", { reason })
}

export function timeout(method: string, timeoutMs: number): RpcFailure {
  return new RpcFailure("TIMEOUT", { method, timeoutMs })
}

export function devtoolsConflict(): RpcFailure {
  return new RpcFailure("DEVTOOLS_CONFLICT", {
    reason: "Another debugger is already attached",
    action: "Close DevTools on this tab, then retry.",
  })
}

export function networkRefused(url: string, detail?: string): RpcFailure {
  return new RpcFailure("NETWORK_REFUSED", detail ? { url, detail } : { url })
}

export function cancelled(reason = "cancelled"): RpcFailure {
  return new RpcFailure("CANCELLED", { reason })
}

export function policyDenied(reason: string, url?: string): RpcFailure {
  return new RpcFailure("POLICY_DENIED", url ? { reason, url } : { reason })
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw cancelled()
}