import type { BrowserConfig, ToolName } from "../config/schema"
import { TOOL_NAMES } from "../config/schema"
import type { KiloBackend } from "./kilo"
import type { WsHub } from "./ws"
import { RpcFailure, rpcError, type RpcKind } from "../protocol/rpc"
import { BRIDGE_VERSION, PROTOCOL_VERSION } from "../protocol/version"
import { checkUrl, extensionId } from "../policy/origin"
import { paramsHash, redactText, redactWithHits } from "../policy/redact"
import { capDiff, checkExternal, diffFromEvent, diffFromMessages, readUiFile, type UiDiffFile } from "./ui-files"
import type { LogEvent } from "../log/jsonl"
import { ensureSession } from "./memory"
import { ArtifactStore } from "../artifacts/store"
import { decideEval } from "../plugin/eval"
import type { ApprovalGate } from "./approval"
import type { PairingResult } from "./pairing"

export type HttpBridge = {
  config: BrowserConfig
  workspace: string
  kilo: KiloBackend
  hub: WsHub
  startedAt: number
  closing: boolean
  token: () => string
  pairingOpen: () => boolean
  tab: () => unknown
  setTab: (tab: unknown) => void
  authorized: (request: Request) => boolean
  logEvent?: (event: LogEvent) => void
  approvals?: ApprovalGate
  touch?: () => void
  rotate?: () => Promise<string> | string
  revoke?: () => Promise<string> | string
  port?: number
  paired?: () => boolean
  claim?: (input: { pairCode?: string; extensionId: string; preApproved?: boolean }) => PairingResult
  limitClaim?: (key: string) => boolean
  sessionDiff?: (sessionID: string) => UiDiffFile[] | undefined
}

export type ToolCall = {
  method: string
  params: Record<string, unknown>
  requestId?: string
  sessionID?: string
  callID?: string
  timeoutMs?: number
}

export async function handle(request: Request, bridge: HttpBridge, remote?: string): Promise<Response> {
  const url = new URL(request.url)
  if (bridge.closing) return fail("SHUTTING_DOWN", 503)
  if (request.method === "OPTIONS" && isPairPath(url.pathname)) return preflight(request)
  if (request.method === "GET" && url.pathname === "/health") {
    return json(await health(bridge))
  }
  if (request.method === "GET" && url.pathname === "/pair/hint") {
    return pairHint(bridge, request, remote)
  }
  if (request.method === "POST" && url.pathname === "/pair/claim") {
    return pairClaim(bridge, request, remote)
  }
  if (url.pathname.startsWith("/ui/")) return uiRoute(bridge, request, url)
  if (!bridge.authorized(request)) return fail("UNAUTHORIZED", 401)

  if (request.method === "POST" && (url.pathname === "/pair/rotate" || url.pathname === "/pair/revoke")) {
    const rotate = url.pathname.endsWith("rotate")
    if (rotate) {
      if (!bridge.rotate) return fail("METHOD_NOT_FOUND", 404)
      return json({ ok: true, result: { token: await bridge.rotate() } })
    }
    if (!bridge.revoke) return fail("METHOD_NOT_FOUND", 404)
    return json({ ok: true, result: { token: await bridge.revoke() } })
  }

  if (request.method === "POST" && url.pathname === "/tool") {
    const body = await readJson(request, bridge.config.bridge.maxPayloadBytes)
    if (!body.ok) return body.response
    const call = toolCall(body.value)
    if (!call.ok) return fail("INVALID_PARAMS", 400, { field: call.field })
    try {
      const result = await executeTool(bridge, call.value)
      return json({ ok: true, result })
    } catch (err) {
      return toolFailure(err)
    }
  }

  try {
    const proxied = await proxy(request, url, bridge)
    if (proxied) return proxied
  } catch (err) {
    if (err instanceof RpcFailure) return json({ ok: false, error: err.body })
    return fail("KILO_UNAVAILABLE", 502)
  }

  return fail("METHOD_NOT_FOUND", 404)
}

export async function executeTool(bridge: HttpBridge, call: ToolCall) {
  bridge.touch?.()
  if (!call.method.startsWith("browser.")) {
    throw new RpcFailure("METHOD_NOT_FOUND", { method: call.method })
  }
  const name = call.method.slice("browser.".length)
  if (!TOOL_NAMES.includes(name as ToolName)) throw new RpcFailure("METHOD_NOT_FOUND", { method: call.method })
  const tool = name as ToolName

  const policy = bridge.config.tools[tool]
  if (policy === "deny") {
    bridge.logEvent?.({ event: "policy.deny", level: "warn", data: { tool: call.method, reason: "tools.deny" } })
    throw new RpcFailure("POLICY_DENIED", { tool: call.method, reason: "tools.deny" })
  }

  const originalParams = call.params
  let params = call.params
  if (tool === "eval") {
    const initial = decideEval(bridge.config, undefined)
    if (initial === "deny") {
      bridge.logEvent?.({ event: "policy.deny", level: "warn", data: { tool: call.method, reason: "eval_policy" } })
      throw new RpcFailure("POLICY_DENIED", { tool: call.method, reason: "eval_policy" })
    }
    if (!bridge.approvals) {
      throw new RpcFailure("APPROVAL_TIMEOUT", { tool: call.method, reason: "approval_unavailable" })
    }
    const rawTab = bridge.tab()
    const tab = isRecord(rawTab) ? rawTab : undefined
    const tabId = tab && typeof tab.id === "number" ? tab.id : undefined
    const origin = tab && typeof tab.url === "string" ? tab.url : undefined
    const preview = redactText(String(originalParams.expression ?? ""), bridge.config.redaction).slice(0, 500)
    const approval = await bridge.approvals.request({
      tool: call.method,
      method: call.method,
      origin,
      preview,
      sessionID: call.sessionID,
      callID: call.callID,
      tabId,
    })
    if (decideEval(bridge.config, approval) !== "allow") {
      throw new RpcFailure("APPROVAL_TIMEOUT", { tool: call.method, reason: approval.decision })
    }
    params = {
      ...call.params,
      approval: {
        decision: approval.decision,
        tabId: approval.tabId,
        expiresAt: approval.expiresAt,
      },
    }
  }

  if (tool === "navigate") {
    const target = params.url
    if (typeof target !== "string") throw new RpcFailure("INVALID_PARAMS", { field: "url" })
    const check = checkUrl(target, bridge.config.browser.allowedOrigins)
    if (!check.ok) {
      bridge.logEvent?.({
        event: "policy.deny",
        level: "warn",
        data: { tool: call.method, reason: check.reason, origin: target },
      })
      throw new RpcFailure("POLICY_DENIED", { tool: call.method, reason: check.reason, origin: target })
    }
  }

  const timeout = Math.min(call.timeoutMs ?? bridge.config.browser.defaultTimeoutMs, 30000)
  if (!Number.isInteger(timeout) || timeout < 1) throw new RpcFailure("INVALID_PARAMS", { field: "timeoutMs" })

  if (call.sessionID && bridge.config.memory.enabled && bridge.config.memory.sessionLog) {
    void ensureSession(bridge.workspace, call.sessionID, {}, { redaction: bridge.config.redaction }).catch((err: unknown) => {
      process.stderr.write(`kilo-browser memory: ${err instanceof Error ? err.message : "session note failed"}\n`)
    })
  }

  const hash = paramsHash(originalParams, bridge.config.redaction)
  bridge.logEvent?.({ event: "tool.start", data: { tool: call.method, paramsHash: hash } })
  let result: unknown
  try {
    result = await bridge.hub.request(call.method, params, timeout)
  } catch (err) {
    bridge.logEvent?.({ event: "tool.end", level: "warn", data: { tool: call.method, paramsHash: hash, ok: false } })
    throw err
  }
  if (tool === "status" && isRecord(result)) {
    if (result.tab !== undefined) bridge.setTab(result.tab)
    result = { ...result, kilo: { healthy: await kiloHealthy(bridge) } }
  }
  if (tool === "screenshot") result = await persistScreenshot(bridge, call, result)
  if (tool === "eval") result = await persistEval(bridge, call, result, hash)
  const safe = redactWithHits(result, bridge.config.redaction)
  for (const hit of safe.hits) {
    bridge.logEvent?.({ event: "redact.hit", data: { ...hit, tool: call.method } })
  }
  bridge.logEvent?.({ event: "tool.end", data: { tool: call.method, paramsHash: hash, ok: true } })
  return safe.value
}

export async function health(bridge: HttpBridge) {
  const healthy = await bridge.kilo.healthy()
  return {
    ok: true,
    bridgeVersion: BRIDGE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    paired: bridge.hub.authenticated,
    pairingOpen: bridge.pairingOpen(),
    kilo: { healthy },
    uptimeMs: Date.now() - bridge.startedAt,
  }
}

const PAIR_PATHS = new Set(["/pair/claim", "/pair/hint"])

function isPairPath(pathname: string) {
  return PAIR_PATHS.has(pathname)
}

function isLoopback(remote: string | undefined) {
  if (!remote) return false
  const address = remote.replace(/^::ffff:/, "").toLowerCase()
  return address === "127.0.0.1" || address === "::1" || address.startsWith("127.")
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? ""
  if (!/^chrome-extension:\/\//i.test(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    Vary: "Origin",
  }
}

function pairJson(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request) },
  })
}

function pairFail(request: Request, kind: RpcKind, status: number, data: Record<string, unknown> = {}) {
  return pairJson(request, { ok: false, error: rpcError(kind, data) }, status)
}

function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

function guardPair(bridge: HttpBridge, request: Request, remote: string | undefined): Response | undefined {
  if (!isLoopback(remote)) return pairFail(request, "POLICY_DENIED", 403, { reason: "loopback_required" })
  const id = extensionId(request.headers.get("origin"))
  if (!id) return pairFail(request, "UNAUTHORIZED", 403, { reason: "extension_origin_required" })
  const allowed = bridge.config.browser.allowedExtensionIds
  if (allowed.length > 0 && !allowed.includes(id)) {
    return pairFail(request, "UNAUTHORIZED", 403, { reason: "extension_id_not_allowed" })
  }
  return undefined
}

function pairPort(bridge: HttpBridge) {
  if (typeof bridge.port === "number" && bridge.port > 0) return bridge.port
  return bridge.config.bridge.port
}

function isAutoPair(bridge: HttpBridge, id: string) {
  const allowed = bridge.config.browser.allowedExtensionIds
  return allowed.length > 0 && allowed.includes(id)
}

function pairHint(bridge: HttpBridge, request: Request, remote: string | undefined): Response {
  const guard = guardPair(bridge, request, remote)
  if (guard) return guard
  const id = extensionId(request.headers.get("origin")) ?? ""
  return pairJson(request, {
    ok: true,
    port: pairPort(bridge),
    requiresPair: !(bridge.paired?.() ?? false),
    autoPair: isAutoPair(bridge, id),
  })
}

async function pairClaim(bridge: HttpBridge, request: Request, remote: string | undefined): Promise<Response> {
  const guard = guardPair(bridge, request, remote)
  if (guard) return guard
  const id = extensionId(request.headers.get("origin")) ?? ""
  const key = remote ?? "unknown"
  if (bridge.limitClaim && !bridge.limitClaim(key)) {
    bridge.logEvent?.({ event: "pair.rate_limit", level: "warn", data: { extensionId: id } })
    return pairFail(request, "RATE_LIMIT", 429)
  }
  const body = await readJson(request, bridge.config.bridge.maxPayloadBytes)
  if (!body.ok) return pairFail(request, "PARSE_ERROR", body.response.status)
  const value = record(body.value) ?? {}
  const code = typeof value.pairCode === "string" ? value.pairCode : undefined
  const claimed = typeof value.extensionId === "string" ? value.extensionId : undefined
  if (!claimed) return pairFail(request, "INVALID_PARAMS", 400, { field: "extensionId" })
  if (claimed !== id) return pairFail(request, "UNAUTHORIZED", 403, { reason: "extension_id_mismatch" })
  const preApproved = isAutoPair(bridge, id)
  if (!code && !preApproved) return pairFail(request, "INVALID_PARAMS", 400, { field: "pairCode" })
  if (!bridge.claim) return pairFail(request, "METHOD_NOT_FOUND", 404)
  const result = bridge.claim({ pairCode: code, extensionId: id, preApproved })
  if (!result.ok) {
    bridge.logEvent?.({
      event: result.kind === "LOCKED" ? "pair.lockout" : "pair.fail",
      level: "warn",
      data: { kind: result.kind, attempt: result.attempt ?? 0, extensionId: id },
    })
    if (result.kind === "LOCKED") return pairFail(request, "RATE_LIMIT", 429, { reason: result.kind })
    return pairFail(request, "UNAUTHORIZED", 401, { reason: result.kind, attempt: result.attempt ?? 0 })
  }
  bridge.logEvent?.({ event: "pair.ok", level: "info", data: { extensionId: id, reused: result.reused } })
  return pairJson(request, {
    ok: true,
    token: result.token,
    port: pairPort(bridge),
    protocolVersion: PROTOCOL_VERSION,
    bridgeVersion: BRIDGE_VERSION,
  })
}

async function proxy(request: Request, url: URL, bridge: HttpBridge) {
  const pathname = url.pathname
  if (pathname === "/kilo/status" && request.method === "GET") {
    if (!bridge.kilo.status) throw new RpcFailure("KILO_UNAVAILABLE", { reason: "status unsupported" })
    const all = await bridge.kilo.status()
    const sessionID = url.searchParams.get("sessionID")
    const result = sessionID && isRecord(all) ? all[sessionID] ?? null : all
    return json({ ok: true, result })
  }

  if (pathname === "/kilo/abort" && request.method === "POST") {
    const body = await readJson(request, bridge.config.bridge.maxPayloadBytes)
    if (!body.ok) return body.response
    const value = record(body.value)
    const sessionID = value?.sessionID
    if (typeof sessionID !== "string") return fail("INVALID_PARAMS", 400, { field: "sessionID" })
    const scope = value?.scope === "tree" ? "tree" : "session"
    await bridge.kilo.abort({ sessionID, scope })
    return json({ ok: true })
  }

  if (pathname === "/kilo/permissions" && request.method === "GET") {
    if (!bridge.kilo.permissions) throw new RpcFailure("KILO_UNAVAILABLE", { reason: "permissions unsupported" })
    const directory = url.searchParams.get("directory") ?? bridge.workspace
    return json({ ok: true, result: await bridge.kilo.permissions(directory) })
  }

  const reply = /^\/kilo\/permissions\/([^/]+)\/reply$/.exec(pathname)
  if (reply && request.method === "POST") {
    const body = await readJson(request, bridge.config.bridge.maxPayloadBytes)
    if (!body.ok) return body.response
    const value = record(body.value)
    if (!value || typeof value.reply !== "string") return fail("INVALID_PARAMS", 400, { field: "reply" })
    const decision = approvalDecision(value.reply)
    const tabId = typeof value.tabId === "number" ? value.tabId : undefined
    if (decision && bridge.approvals?.reply(reply[1]!, decision, tabId)) {
      return json({ ok: true, result: { requestID: reply[1], decision } })
    }
    if (!bridge.kilo.reply) throw new RpcFailure("KILO_UNAVAILABLE", { reason: "reply unsupported" })
    const result = await bridge.kilo.reply({
      requestID: reply[1]!,
      reply: value.reply,
      message: typeof value.message === "string" ? value.message : undefined,
      interactive: typeof value.interactive === "boolean" ? value.interactive : undefined,
    })
    return json({ ok: true, result })
  }

  if (pathname === "/kilo/sessions" && request.method === "POST") {
    const body = await readJson(request, bridge.config.bridge.maxPayloadBytes)
    if (!body.ok) return body.response
    const value = record(body.value) ?? {}
    const result = await bridge.kilo.createSession({
      title: typeof value.title === "string" ? value.title : undefined,
      parentID: typeof value.parentID === "string" ? value.parentID : undefined,
    })
    return json({ ok: true, result })
  }

  if ((pathname === "/kilo/prompt" || pathname === "/kilo/prompt_async") && request.method === "POST") {
    const body = await readJson(request, bridge.config.bridge.maxPayloadBytes)
    if (!body.ok) return body.response
    const value = record(body.value)
    if (!value || typeof value.sessionID !== "string" || !Array.isArray(value.parts)) {
      return fail("INVALID_PARAMS", 400, { field: "sessionID/parts" })
    }
    const input = {
      sessionID: value.sessionID,
      parts: value.parts,
      model: value.model,
      agent: typeof value.agent === "string" ? value.agent : undefined,
    }
    if (pathname === "/kilo/prompt_async") {
      await bridge.kilo.promptAsync(input)
      return json({ ok: true })
    }
    return json({ ok: true, result: await bridge.kilo.prompt(input) })
  }

  return undefined
}

function uiRoute(bridge: HttpBridge, request: Request, url: URL): Response | Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(request),
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    })
  }
  if (!bridge.authorized(request)) return uiFail(request, "UNAUTHORIZED", 401)
  if (request.method !== "GET") return uiFail(request, "METHOD_NOT_FOUND", 404)
  if (url.pathname === "/ui/file") return uiFile(bridge, request, url)
  if (url.pathname === "/ui/diff") return uiDiff(bridge, request, url)
  if (url.pathname === "/ui/url-guard") return uiUrlGuard(request, url)
  return uiFail(request, "METHOD_NOT_FOUND", 404)
}

async function uiFile(bridge: HttpBridge, request: Request, url: URL): Promise<Response> {
  const target = url.searchParams.get("path") ?? ""
  if (target.trim().length === 0) return uiFail(request, "INVALID_PARAMS", 400, { field: "path" })
  const result = await readUiFile(bridge.workspace, target, bridge.config.redaction)
  if ("error" in result) {
    if (result.error === "not_found") return uiFail(request, "INVALID_PARAMS", 404, { reason: "not_found" })
    bridge.logEvent?.({ event: "policy.deny", level: "warn", data: { tool: "ui.file", reason: result.error } })
    return uiFail(request, "POLICY_DENIED", 403, { reason: result.error })
  }
  bridge.logEvent?.({ event: "ui.file", level: "info", data: { truncated: result.truncated, bytes: result.text.length } })
  return uiJson(request, { ok: true, result })
}

async function uiDiff(bridge: HttpBridge, request: Request, url: URL): Promise<Response> {
  const sessionID = url.searchParams.get("session") ?? ""
  if (sessionID.length === 0) return uiFail(request, "INVALID_PARAMS", 400, { field: "session" })
  const cached = bridge.sessionDiff?.(sessionID)
  let files = cached === undefined ? undefined : capDiff(cached)
  if (!files) {
    const messages = await bridge.kilo.getMessages(sessionID).catch((err: unknown) => {
      bridge.logEvent?.({
        event: "ui.diff.fallback",
        level: "warn",
        data: { error: err instanceof Error ? err.message : "messages unavailable" },
      })
      return []
    })
    files = capDiff(diffFromMessages(messages))
  }
  return uiJson(request, { ok: true, result: { session: sessionID, files } })
}

function uiUrlGuard(request: Request, url: URL): Response {
  const raw = url.searchParams.get("url") ?? ""
  return uiJson(request, { ok: true, result: checkExternal(raw) })
}

function uiJson(request: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request) },
  })
}

function uiFail(request: Request, kind: RpcKind, status: number, data: Record<string, unknown> = {}): Response {
  return uiJson(request, { ok: false, error: rpcError(kind, data) }, status)
}

function toolCall(value: unknown): { ok: true; value: ToolCall } | { ok: false; field: string } {
  const body = record(value)
  if (!body) return { ok: false, field: "body" }
  if (typeof body.method !== "string") return { ok: false, field: "method" }
  if (!record(body.params ?? {})) return { ok: false, field: "params" }
  return {
    ok: true,
    value: {
      method: body.method,
      params: record(body.params ?? {}) ?? {},
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
      sessionID: typeof body.sessionID === "string" ? body.sessionID : undefined,
      callID: typeof body.callID === "string" ? body.callID : undefined,
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
    },
  }
}

async function readJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: fail("INVALID_PARAMS", 413, { reason: "payload_too_large" }) }
  }
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    return { ok: false, response: fail("INVALID_PARAMS", 413, { reason: "payload_too_large" }) }
  }
  if (buffer.byteLength === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buffer)) as unknown }
  } catch {
    return { ok: false, response: fail("PARSE_ERROR", 400) }
  }
}

async function kiloHealthy(bridge: HttpBridge) {
  const deferred = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => deferred.resolve(false), 1000)
  bridge.kilo.healthy().then(
    (healthy) => {
      clearTimeout(timer)
      deferred.resolve(healthy)
    },
    () => {
      clearTimeout(timer)
      deferred.resolve(false)
    },
  )
  return deferred.promise
}

async function persistScreenshot(bridge: HttpBridge, call: ToolCall, result: unknown) {
  if (!isRecord(result) || typeof result.data !== "string") return result
  const format = result.format === "jpeg" ? "jpeg" : "png"
  const bytes = Buffer.from(result.data, "base64")
  try {
    const store = new ArtifactStore({
      workspace: bridge.workspace,
      artifactsDir: bridge.config.jail.artifactsDir,
      maxBytes: Math.max(bridge.config.jail.maxArtifactBytes, bytes.byteLength),
      redaction: bridge.config.redaction,
    })
    const artifact = await store.write({
      sessionID: call.sessionID ?? "default",
      tool: "screenshot",
      params: call.params,
      data: bytes,
      ext: format,
    })
    return {
      ...result,
      artifactId: artifact.name,
      artifactPath: artifact.relativePath,
      bytes: artifact.bytes,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "artifact write failed"
    bridge.logEvent?.({ event: "artifact.failed", level: "warn", data: { tool: "screenshot", error: message } })
    return { ...result, artifactError: message }
  }
}

async function persistEval(bridge: HttpBridge, call: ToolCall, result: unknown, expressionHash: string) {
  if (!isRecord(result) || result.truncated !== true) return result
  try {
    const store = new ArtifactStore({
      workspace: bridge.workspace,
      artifactsDir: bridge.config.jail.artifactsDir,
      maxBytes: bridge.config.jail.maxArtifactBytes,
      redaction: bridge.config.redaction,
    })
    const artifact = await store.write({
      sessionID: call.sessionID ?? "default",
      tool: "eval",
      params: { expressionHash },
      data: JSON.stringify({
        expressionHash,
        type: result.type,
        value: result.value,
        truncated: true,
      }),
      ext: "json",
    })
    return { ...result, expressionHash, artifactId: artifact.name, artifactPath: artifact.relativePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : "artifact write failed"
    bridge.logEvent?.({ event: "artifact.failed", level: "warn", data: { tool: "eval", error: message } })
    return { ...result, expressionHash, artifactError: message }
  }
}

function approvalDecision(reply: string): "allow-once" | "allow-tab" | "deny" | undefined {
  if (reply === "allow" || reply === "once" || reply === "allow-once") return "allow-once"
  if (reply === "allow-tab" || reply === "always") return "allow-tab"
  if (reply === "deny" || reply === "reject") return "deny"
  return undefined
}

function toolFailure(err: unknown) {
  if (err instanceof RpcFailure) {
    return json({ ok: false, error: err.body })
  }
  return json({ ok: false, error: rpcError("INTERNAL_ERROR") })
}

function fail(kind: RpcKind, status: number, data: Record<string, unknown> = {}) {
  return json({ ok: false, error: rpcError(kind, data) }, status)
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}



