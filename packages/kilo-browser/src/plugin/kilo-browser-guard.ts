import path from "node:path"
import { load } from "../config/load"
import { DEFAULT_CONFIG, TOOL_NAMES, type BrowserConfig, type ToolName } from "../config/schema"
import { createLogger, type JsonlLogger, type LogLevel } from "../log/jsonl"
import { inside } from "../policy/jail"
import { redactWithHits } from "../policy/redact"
import {
  assertArtifactPathInsideJail,
  assertBashInside,
  assertNoFileUrl,
  assertOriginAllowed,
  assertWorkspacePath,
  PolicyError,
} from "./paths"

type GuardContext = {
  directory?: string
  worktree?: string
}

type AskInput = {
  type?: string
  permission?: string
  pattern?: string | string[]
  patterns?: string | string[]
  metadata?: Record<string, unknown>
}

type Status = "ask" | "deny" | "allow"

type ToolInput = {
  tool?: string
  sessionID?: string
  callID?: string
  args?: unknown
}

type Args = {
  args?: Record<string, unknown>
}

type AfterOutput = {
  title?: string
  output?: string
  metadata?: unknown
  content?: unknown
  [key: string]: unknown
}

type Hooks = {
  "permission.ask"(input: AskInput, output: { status: Status }): Promise<void>
  "tool.execute.before"(input: ToolInput, output: Args): Promise<void>
  "tool.execute.after"(input: ToolInput, output: AfterOutput): Promise<void>
}

const FILE_TOOLS = new Set(["read", "write", "edit", "glob", "grep", "list", "ls"])
const BASH_TOOLS = new Set(["bash", "shell"])

export default async function guard(ctx: GuardContext): Promise<Hooks> {
  const workspace = path.resolve(ctx.worktree ?? ctx.directory ?? process.cwd())
  let cached: { key: string; config: BrowserConfig } | undefined
  let logger: JsonlLogger | undefined
  let loggerKey = ""

  const config = async () => {
    const key = path.join(workspace, ".kilo", "kilo-browser.json")
    if (cached?.key === key) return cached.config
    try {
      const loaded = await load({ workspace, env: {}, home: workspace })
      cached = { key, config: loaded.config }
      return loaded.config
    } catch (err) {
      process.stderr.write(`kilo-browser-guard: using default policy: ${message(err)}\n`)
      cached = { key, config: DEFAULT_CONFIG }
      return DEFAULT_CONFIG
    }
  }

  const getLogger = (value: BrowserConfig) => {
    const file = path.resolve(workspace, value.logging.file)
    const key = `${file}\u0000${value.logging.level}`
    if (logger && loggerKey === key) return logger
    logger = createLogger({
      file,
      maxBytes: value.logging.maxBytes,
      keep: value.logging.keep,
      level: value.logging.level as LogLevel,
      redaction: value.redaction,
    })
    loggerKey = key
    return logger
  }

  const roots = (value: BrowserConfig) => {
    const extra = value.jail.extraRoots.map((item) => path.resolve(item.replaceAll("${workspace}", workspace)))
    return [workspace, ...extra]
  }

  const deny = (value: BrowserConfig, err: unknown, event: "policy.deny" | "jail.deny") => {
    const data = errorData(err)
    void getLogger(value)
      .log({ event, level: "warn", data })
      .catch((logErr: unknown) => {
        process.stderr.write(`kilo-browser-guard: cannot write log: ${message(logErr)}\n`)
      })
  }

  return {
    async "permission.ask"(input, output) {
      const value = await config()
      const key = input.permission ?? input.type ?? ""
      const browser = browserName(key)
      if (browser) {
        const policy = value.tools[browser]
        if (policy === "deny") {
          output.status = "deny"
          deny(value, new PolicyError("tool_denied", { tool: key }), "policy.deny")
          return
        }
        if (policy === "ask") output.status = "ask"
        try {
          await checkBrowser(workspace, roots(value), value, browser, argsOf(input.metadata))
        } catch (err) {
          output.status = "deny"
          deny(value, err, eventOf(err))
        }
        return
      }

      const patterns = patternsOf(input)
      try {
        if (key === "external_directory" || isFileTool(key)) {
          for (const pattern of patterns) await checkPattern(workspace, value, pattern)
        }
        if (BASH_TOOLS.has(key)) {
          const args = argsOf(input.metadata)
          const command = typeof args.command === "string" ? args.command : ""
          if (command.trim().length > 0) assertBash(workspace, value, command, args)
        }
      } catch (err) {
        output.status = "deny"
        deny(value, err, eventOf(err))
      }
    },

    async "tool.execute.before"(input, output) {
      const key = input.tool ?? ""
      const value = await config()
      const browser = browserName(key)
      try {
        if (browser) {
          if (value.tools[browser] === "deny") throw new PolicyError("tool_denied", { tool: key })
          await checkBrowser(workspace, roots(value), value, browser, output.args ?? {})
          return
        }
        if (isFileTool(key)) {
          await checkFileArgs(workspace, value, output.args ?? {})
          return
        }
        if (BASH_TOOLS.has(key)) {
          const args = output.args ?? {}
          const command = typeof args.command === "string" ? args.command : ""
          if (command.trim().length > 0) assertBash(workspace, value, command, args)
        }
      } catch (err) {
        deny(value, err, eventOf(err))
        throw err
      }
    },

    async "tool.execute.after"(input, output) {
      if (!browserName(input.tool ?? "")) return
      const value = await config()
      if (typeof output.output === "string") {
        const result = redactWithHits(output.output, value.redaction)
        output.output = String(result.value)
        reportHits(value, result.hits)
      }
      if (output.content !== undefined) {
        const result = redactWithHits(output.content, value.redaction)
        output.content = result.value
        reportHits(value, result.hits)
      }
      if (output.metadata !== undefined) {
        const result = redactWithHits(output.metadata, value.redaction)
        output.metadata = result.value
        reportHits(value, result.hits)
      }
    },
  }

  function reportHits(value: BrowserConfig, hits: ReturnType<typeof redactWithHits>["hits"]) {
    for (const hit of hits) {
      void getLogger(value)
        .log({ event: "redact.hit", level: "info", data: hit })
        .catch((err: unknown) => {
          process.stderr.write(`kilo-browser-guard: cannot write redact log: ${message(err)}\n`)
        })
    }
  }
}

function browserName(key: string): ToolName | undefined {
  const raw = key.startsWith("browser_") ? key.slice("browser_".length) : key.startsWith("browser.") ? key.slice("browser.".length) : undefined
  if (!raw) return undefined
  return (TOOL_NAMES as string[]).includes(raw) ? (raw as ToolName) : undefined
}

function isFileTool(key: string) {
  return FILE_TOOLS.has(key)
}

async function checkBrowser(
  workspace: string,
  roots: string[],
  config: BrowserConfig,
  name: ToolName,
  args: Record<string, unknown>,
) {
  if (name === "eval") {
    const policy = config.tools.eval
    if (policy === "deny") throw new PolicyError("eval_denied", { tool: "browser_eval" })
    return
  }
  if (typeof args.url === "string") {
    assertNoFileUrl(args.url)
    assertOriginAllowed(args.url, config)
  }
  for (const key of ["path", "artifactPath", "artifacts"]) {
    if (typeof args[key] !== "string") continue
    await assertArtifactPathInsideJail(workspace, args[key] as string, config.jail.artifactsDir)
  }
  for (const key of ["filePath", "downloadPath"]) {
    if (typeof args[key] !== "string") continue
    await assertWorkspacePath(roots[0] ?? workspace, args[key] as string)
  }
}

async function checkFileArgs(workspace: string, config: BrowserConfig, args: Record<string, unknown>) {
  for (const key of ["filePath", "path", "cwd", "workdir"]) {
    if (typeof args[key] !== "string") continue
    await assertWorkspacePath(workspace, args[key] as string)
  }
  if (typeof args.pattern === "string") await checkPattern(workspace, config, args.pattern)
}

async function checkPattern(workspace: string, config: BrowserConfig, pattern: string) {
  if (pattern.length === 0 || pattern === "*") return
  const base = pattern.replace(/[*?[\]{}]/g, "")
  if (base.length === 0) return
  const target = path.isAbsolute(base) ? base : path.resolve(workspace, base)
  if (!inside(workspace, target)) {
    throw new PolicyError("path_outside_workspace", { path: target, root: workspace })
  }
  if (path.isAbsolute(base)) await assertWorkspacePath(workspace, base)
}

function assertBash(workspace: string, config: BrowserConfig, command: string, args: Record<string, unknown>) {
  const cwd = typeof args.workdir === "string" ? args.workdir : typeof args.cwd === "string" ? args.cwd : undefined
  assertBashInside(workspace, command, cwd)
  void config
}

function argsOf(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}
  if (isRecord(metadata.mcpInput)) return metadata.mcpInput
  if (isRecord(metadata.args)) return metadata.args
  return {}
}

function patternsOf(input: AskInput) {
  const value = input.pattern ?? input.patterns
  if (Array.isArray(value)) return value
  if (typeof value === "string") return [value]
  return []
}

function eventOf(err: unknown): "policy.deny" | "jail.deny" {
  if (err instanceof PolicyError && err.reason === "jail_deny") return "jail.deny"
  return "policy.deny"
}

function errorData(err: unknown): Record<string, unknown> {
  if (err instanceof PolicyError) return { reason: err.reason, ...err.detail }
  if (err instanceof Error) return { reason: "error", message: err.message }
  return { reason: "error" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}