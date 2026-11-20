import path from "node:path"
import { BRIDGE_VERSION } from "./protocol/version"
import { isLoopbackUrl } from "./policy/origin"
import { DEFAULT_REDACTION, redactText, redactValue } from "./policy/redact"
import { RPC_ERRORS, type RpcKind } from "./protocol/rpc"

export type McpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type Runtime = {
  httpUrl: string
  token: string
}

type Content = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string }

export const TOOLS: McpTool[] = [
  tool("status", "Report bridge pairing, attached tab, and Kilo health.", object({})),
  tool(
    "navigate",
    "Navigate the attached tab to a URL allowed by the origin policy.",
    object({
      url: { type: "string", description: "Absolute http(s) URL." },
      waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
      timeoutMs: { type: "number", minimum: 1, maximum: 30000 },
    }, ["url"]),
  ),
  tool(
    "snapshot",
    "Return a compact accessibility snapshot with stable refs.",
    object({
      mode: { type: "string", enum: ["aria", "text"] },
      maxNodes: { type: "number", minimum: 1 },
      selector: { type: "string" },
    }),
  ),
  tool(
    "screenshot",
    "Capture a PNG/JPEG screenshot and return an artifact path plus image when small enough.",
    object({
      fullPage: { type: "boolean" },
      format: { type: "string", enum: ["png", "jpeg"] },
      quality: { type: "number", minimum: 1, maximum: 100 },
    }),
  ),
  tool(
    "console",
    "Read buffered console entries from the attached tab.",
    object({
      level: { type: "string", enum: ["debug", "info", "warn", "error"] },
      sinceSeq: { type: "number" },
      limit: { type: "number", minimum: 1 },
    }),
  ),
  tool(
    "network",
    "Read buffered network requests, with redaction applied before returning.",
    object({
      filter: { type: "string" },
      sinceSeq: { type: "number" },
      includeBodies: { type: "boolean" },
      limit: { type: "number", minimum: 1 },
    }),
  ),
  tool(
    "click",
    "Click an element by snapshot ref or CSS selector.",
    object({
      ref: { type: "string" },
      selector: { type: "string" },
      button: { type: "string", enum: ["left", "right", "middle"] },
      clickCount: { type: "number", minimum: 1, maximum: 3 },
    }),
  ),
  tool(
    "type",
    "Type text into an element by snapshot ref or CSS selector.",
    object({
      ref: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
      clear: { type: "boolean" },
      submit: { type: "boolean" },
    }, ["text"]),
  ),
  tool(
    "press",
    "Press a keyboard key, optionally focused on a snapshot ref.",
    object({ key: { type: "string" }, ref: { type: "string" } }, ["key"]),
  ),
  tool(
    "reload",
    "Reload the attached tab and wait for the requested lifecycle event.",
    object({
      ignoreCache: { type: "boolean" },
      waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
    }),
  ),
  tool(
    "wait_for",
    "Wait until text, selector, or URL condition matches.",
    object({
      text: { type: "string" },
      selector: { type: "string" },
      urlIncludes: { type: "string" },
      state: { type: "string" },
      timeoutMs: { type: "number", minimum: 1, maximum: 30000 },
    }),
  ),
  tool(
    "eval",
    "Evaluate JavaScript in the page. Denied by default and requires approval.",
    object({
      expression: { type: "string" },
      awaitPromise: { type: "boolean" },
      returnByValue: { type: "boolean" },
    }, ["expression"]),
  ),
]

export type RuntimeCache = {
  read: (force?: boolean) => Promise<Runtime | undefined>
  invalidate: () => void
  path: string
}

export function createRuntimeCache(file: string): RuntimeCache {
  let mtime = -1
  let value: Runtime | undefined
  return {
    path: file,
    invalidate() {
      mtime = -1
      value = undefined
    },
    async read(force = false) {
      const handle = Bun.file(file)
      if (!(await handle.exists())) {
        value = undefined
        mtime = -1
        return undefined
      }
      const stat = await handle.stat()
      const stamp = stat.mtime.getTime()
      if (!force && value && stamp === mtime) return value
      const parsed = await parseRuntime(handle)
      mtime = stamp
      value = parsed
      return parsed
    },
  }
}

export async function callTool(name: string, args: Record<string, unknown>, cache: RuntimeCache) {
  const tool = TOOLS.find((item) => item.name === name)
  if (!tool) return failure(`[browser:unsupported] Tool ${name} không được hỗ trợ.`)
  const runtime = await resolveRuntime(cache, false)
  if (!runtime) return failure(notPaired())
  try {
    const response = await postTool(runtime, name, args)
    if (response.status === 401) {
      cache.invalidate()
      const retry = await resolveRuntime(cache, true)
      if (!retry) return failure(notPaired())
      const second = await postTool(retry, name, args)
      return render(name, await body(second))
    }
    return render(name, await body(response))
  } catch (err) {
    if (err instanceof TimeoutError) return failure(timeoutText())
    return failure(redactText(`[browser:protocol] Lỗi kết nối bridge: ${message(err)}. Báo người dùng gửi log.`))
  }
}

export async function run() {
  const runtimeArg = argValue("--runtime")
  const file = runtimeArg ?? process.env.KILO_BROWSER_RUNTIME
  const cache = createRuntimeCache(file ?? "")
  const reader = Bun.stdin.stream().getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf("\n")
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.length > 0) await receive(line, cache)
      index = buffer.indexOf("\n")
    }
  }
}

async function receive(line: string, cache: RuntimeCache) {
  let message: Record<string, unknown>
  try {
    const parsed = JSON.parse(line) as unknown
    if (!isRecord(parsed)) return send({ jsonrpc: "2.0", id: null, error: invalidRequest() })
    message = parsed
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: parseError() })
  }

  const id = message.id
  const method = typeof message.method === "string" ? message.method : undefined
  if (!method) return
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "kilo-browser", version: BRIDGE_VERSION },
    })
  }
  if (method === "notifications/initialized") return
  if (method === "ping") return reply(id, {})
  if (method === "tools/list") return reply(id, { tools: TOOLS })
  if (method === "tools/call") {
    const params = isRecord(message.params) ? message.params : {}
    const name = typeof params.name === "string" ? params.name : ""
    const args = isRecord(params.arguments) ? params.arguments : {}
    const result = await callTool(name, args, cache)
    return reply(id, result)
  }
  return send({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32601, message: "METHOD_NOT_FOUND", data: { kind: "METHOD_NOT_FOUND" } },
  })
}

async function resolveRuntime(cache: RuntimeCache, force: boolean): Promise<Runtime | undefined> {
  if (!cache.path) return undefined
  const runtime = await cache.read(force)
  if (!runtime) return undefined
  const url = process.env.KILO_BROWSER_URL ?? runtime.httpUrl
  const token = process.env.KILO_BROWSER_TOKEN ?? runtime.token
  if (!isLoopbackUrl(url)) return undefined
  if (!/^[a-f0-9]{64}$/i.test(token)) return undefined
  return { httpUrl: url.replace(/\/+$/, ""), token }
}

async function postTool(runtime: Runtime, name: string, args: Record<string, unknown>) {
  const timeout = Number(process.env.KILO_BROWSER_TIMEOUT_MS ?? "20000")
  const requestId = `mcp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), (Number.isFinite(timeout) ? timeout : 20000) + 2000)
  try {
    return await fetch(`${runtime.httpUrl}/tool`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.token}`,
      },
      body: JSON.stringify({
        method: `browser.${name}`,
        params: args,
        requestId,
        sessionID: process.env.KILO_BROWSER_SESSION,
        timeoutMs: Number.isFinite(timeout) ? timeout : 20000,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) throw new TimeoutError()
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function body(response: Response) {
  const text = await response.text()
  if (text.length === 0) return { ok: false, error: { code: -32603, message: "INTERNAL_ERROR" } } as unknown
  try {
    return redactValue(JSON.parse(text) as unknown, DEFAULT_REDACTION)
  } catch {
    return { ok: false, error: { code: -32700, message: "PARSE_ERROR", data: { kind: "PARSE_ERROR" } } } as unknown
  }
}

function render(name: string, value: unknown) {
  if (!isRecord(value)) return failure(`[browser:protocol] Phản hồi bridge không hợp lệ.`)
  if (value.ok !== true) {
    const error = isRecord(value.error) ? value.error : {}
    return failure(redactText(errorText(error), DEFAULT_REDACTION))
  }
  const result = value.result
  if (name === "screenshot" && isRecord(result)) return screenshot(result)
  if (name === "snapshot" && isRecord(result) && typeof result.text === "string") {
    const suffix = typeof result.snapshotId === "string" ? `\nsnapshotId=${result.snapshotId}` : ""
    return success(`${result.text}${suffix}`)
  }
  if (typeof result === "string") return success(result)
  return success(compact(result))
}

function screenshot(result: Record<string, unknown>) {
  const meta = {
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    artifactPath: result.artifactId ?? result.artifactPath,
  }
  const text = compact(meta)
  if (typeof result.data === "string" && result.data.length <= 2_000_000) {
    const mime = result.format === "jpeg" ? "image/jpeg" : "image/png"
    return {
      content: [
        { type: "text", text },
        { type: "image", mimeType: mime, data: result.data },
      ],
    }
  }
  return success(text)
}

function errorText(error: Record<string, unknown>) {
  const data = isRecord(error.data) ? error.data : {}
  const candidate = typeof data.kind === "string" ? data.kind : typeof error.message === "string" ? error.message : ""
  const kind: RpcKind = Object.hasOwn(RPC_ERRORS, candidate) ? (candidate as RpcKind) : "INTERNAL_ERROR"
  const code = RPC_ERRORS[kind].code
  const field = typeof data.field === "string" ? data.field : "field"
  const known: Partial<Record<RpcKind, string>> = {
    UNAUTHORIZED: "[browser:unauthorized] Bridge từ chối token. Chạy lại kilo-browser start và pair lại. Không thử lại tool này.",
    APPROVAL_TIMEOUT: "[browser:approval_timeout] Người dùng không duyệt. Yêu cầu lại nếu cần; không retry tự động.",
    NOT_PAIRED: notPaired(),
    NO_TARGET: "[browser:no_target] Không có tab hợp lệ. Gọi browser_status để kiểm tra, không đoán URL.",
    STALE_REF: "[browser:stale_ref] Ref đã hết hạn sau snapshot mới. Gọi browser_snapshot rồi dùng ref mới.",
    TIMEOUT: timeoutText(),
    RATE_LIMIT: "[browser:rate_limit] Quá nhiều call. Chờ 1 giây rồi thử lại.",
    BUSY: "[browser:busy] Tool khác đang chạy. Chờ call hiện tại xong.",
    CANCELLED: "[browser:cancelled] Call đã bị hủy. Chỉ thử lại nếu còn nhu cầu.",
    POLICY_DENIED: "[browser:policy_denied] Bị policy/origin/path chặn. Không lách; hỏi người dùng nếu cần.",
    DEVTOOLS_CONFLICT: "[browser:devtools_conflict] DevTools đang giữ tab. Yêu cầu đóng DevTools.",
    NETWORK_REFUSED: "[browser:network_refused] Không kết nối được target. Kiểm tra app/port.",
    LOOP_STOP: `[browser:loop_stop] Dừng do ${String(data.reason ?? "loop stop")}. Tổng kết bằng chứng.`,
    SHUTTING_DOWN: "[browser:shutting_down] Bridge đang tắt. Không retry trong turn này.",
    KILO_UNAVAILABLE: "[browser:kilo_unavailable] Kilo server không phản hồi. Báo người dùng restart.",
    INVALID_PARAMS: `[browser:invalid_params] ${field} không hợp lệ: ${String(data.reason ?? "sai kiểu")}. Sửa tham số, không retry nguyên trạng.`,
    METHOD_NOT_FOUND: "[browser:unsupported] Tool không được hỗ trợ bởi bridge version này.",
    PARSE_ERROR: "[browser:protocol] Lỗi framing nội bộ; báo người dùng gửi log.",
  }
  return known[kind] ?? `[browser:protocol] Bridge trả lỗi ${code}/${kind}; báo người dùng gửi log.`
}

function notPaired() {
  return "[browser:not_paired] Chưa có extension kết nối. Yêu cầu người dùng mở side panel và pair."
}

function timeoutText() {
  return "[browser:timeout] Hết thời gian chờ. Kiểm tra app còn chạy; có thể tăng timeout tối đa 30000ms."
}

function success(text: string): { content: Content[] } {
  return { content: [{ type: "text", text }] }
}

function failure(text: string): { content: Content[]; isError: true } {
  return { content: [{ type: "text", text }], isError: true }
}

function reply(id: unknown, result: unknown) {
  if (id === undefined) return
  send({ jsonrpc: "2.0", id, result })
}

function send(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function compact(value: unknown) {
  if (typeof value === "string") return value
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = compact(item)
    return JSON.stringify(out)
  }
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => (isRecord(item) ? compactObject(item) : item)))
  return JSON.stringify(value)
}

function compactObject(value: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = isRecord(item) || Array.isArray(item) ? compact(item) : item
  return out
}

async function parseRuntime(handle: ReturnType<typeof Bun.file>): Promise<Runtime | undefined> {
  try {
    const parsed = JSON.parse(await handle.text()) as unknown
    if (!isRecord(parsed) || typeof parsed.httpUrl !== "string" || typeof parsed.token !== "string") return undefined
    return { httpUrl: parsed.httpUrl, token: parsed.token }
  } catch {
    return undefined
  }
}

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function object(properties: Record<string, unknown> = {}, required?: string[]) {
  const schema: Record<string, unknown> = { type: "object", properties, additionalProperties: false }
  if (required && required.length > 0) schema.required = required
  return schema
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>): McpTool {
  return { name, description, inputSchema }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function message(err: unknown) {
  return err instanceof Error ? err.message : "unknown error"
}

function parseError() {
  return { code: -32700, message: "PARSE_ERROR", data: { kind: "PARSE_ERROR" } }
}

function invalidRequest() {
  return { code: -32600, message: "INVALID_REQUEST", data: { kind: "INVALID_REQUEST" } }
}

class TimeoutError extends Error {
  constructor() {
    super("timeout")
    this.name = "TimeoutError"
  }
}

