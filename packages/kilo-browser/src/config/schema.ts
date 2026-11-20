export type Policy = "allow" | "ask" | "deny"

export type ToolName =
  | "status"
  | "navigate"
  | "snapshot"
  | "screenshot"
  | "console"
  | "network"
  | "click"
  | "type"
  | "press"
  | "reload"
  | "wait_for"
  | "eval"

export const TOOL_NAMES: ToolName[] = [
  "status",
  "navigate",
  "snapshot",
  "screenshot",
  "console",
  "network",
  "click",
  "type",
  "press",
  "reload",
  "wait_for",
  "eval",
]

export const BROWSER_PERMISSIONS: Record<string, Policy> = {
  external_directory: "deny",
  browser_status: "allow",
  browser_navigate: "allow",
  browser_snapshot: "allow",
  browser_screenshot: "allow",
  browser_console: "allow",
  browser_network: "allow",
  browser_click: "allow",
  browser_type: "allow",
  browser_press: "allow",
  browser_reload: "allow",
  browser_wait_for: "allow",
  browser_eval: "deny",
}

export type BridgeConfig = {
  host: string
  port: number
  idleTimeoutMs: number
  maxPayloadBytes: number
  heartbeatMs: number
  pongTimeoutMs: number
}

export type KiloConfig = {
  command: string
  args: string[]
  startupTimeoutMs: number
  healthIntervalMs: number
  healthTimeoutMs: number
  restartMax: number
  restartWindowMs: number
}

export type BrowserOptions = {
  attach: string
  allowedOrigins: string[]
  allowedExtensionIds: string[]
  defaultTimeoutMs: number
  screenshotFormat: "png" | "jpeg"
}

export type UiConfig = {
  enabled: boolean
  theme: string
  mode: "system" | "light" | "dark"
  pageMode: "sidepanel" | "tab"
  settingsPage: "tab" | "window"
  surfaces: Record<string, unknown>
  bundle: Record<string, string>
  capabilityOverrides: Record<string, unknown>
}

export type JailConfig = {
  roots: string[]
  extraRoots: string[]
  artifactsDir: string
  maxArtifactBytes: number
  retentionDays: number
}

export type RedactionConfig = {
  enabled: boolean
  replacement: string
  headers: string[]
  queryKeys: string[]
}

export type MemoryConfig = {
  enabled: boolean
  injectBytes: number
  sessionLog: boolean
}

export type LoggingConfig = {
  level: "debug" | "info" | "warn" | "error"
  file: string
  maxBytes: number
  keep: number
}

export type BrowserConfig = {
  bridge: BridgeConfig
  kilo: KiloConfig
  browser: BrowserOptions
  ui: UiConfig
  tools: Record<ToolName, Policy>
  jail: JailConfig
  redaction: RedactionConfig
  memory: MemoryConfig
  logging: LoggingConfig
}

export class ConfigError extends Error {
  readonly code = "PREFLIGHT_FAILED"

  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`invalid config at ${field}: ${reason}`)
    this.name = "ConfigError"
  }
}

export const DEFAULT_CONFIG: BrowserConfig = {
  bridge: {
    host: "127.0.0.1",
    port: 0,
    idleTimeoutMs: 1_800_000,
    maxPayloadBytes: 8_388_608,
    heartbeatMs: 10_000,
    pongTimeoutMs: 30_000,
  },
  kilo: {
    command: "kilo",
    args: ["serve", "--port", "0", "--hostname", "127.0.0.1"],
    startupTimeoutMs: 20_000,
    healthIntervalMs: 10_000,
    healthTimeoutMs: 3_000,
    restartMax: 5,
    restartWindowMs: 60_000,
  },
  browser: {
    attach: "manual",
    allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
    allowedExtensionIds: [],
    defaultTimeoutMs: 15_000,
    screenshotFormat: "png",
  },
  ui: {
    enabled: true,
    theme: "kilo",
    mode: "system",
    pageMode: "sidepanel",
    settingsPage: "tab",
    surfaces: {
      chat: true,
      sessions: true,
      history: true,
      profile: true,
      settings: ["models", "providers", "autoApprove", "agentBehaviour", "display", "language", "about"],
    },
    bundle: {
      sidepanel: "extension/dist/ui-dist/sidepanel.html",
      settings: "extension/dist/ui-dist/settings.html",
    },
    capabilityOverrides: {},
  },
  tools: {
    status: "allow",
    navigate: "allow",
    snapshot: "allow",
    screenshot: "allow",
    console: "allow",
    network: "allow",
    click: "allow",
    type: "allow",
    press: "allow",
    reload: "allow",
    wait_for: "allow",
    eval: "deny",
  },
  jail: {
    roots: ["${workspace}"],
    extraRoots: [],
    artifactsDir: ".kilo/kilo-browser/artifacts",
    maxArtifactBytes: 2_097_152,
    retentionDays: 7,
  },
  redaction: {
    enabled: true,
    replacement: "[REDACTED]",
    headers: [
      "authorization",
      "cookie",
      "set-cookie",
      "proxy-authorization",
      "x-api-key",
      "x-auth-token",
    ],
    queryKeys: ["token", "access_token", "key", "secret", "password"],
  },
  memory: { enabled: true, injectBytes: 8192, sessionLog: true },
  logging: {
    level: "info",
    file: ".kilo/kilo-browser/logs/bridge.jsonl",
    maxBytes: 10_485_760,
    keep: 3,
  },
}

export function isLoopback(host: string) {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase()
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1"
}

export function merge(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isRecord(value) && isRecord(out[key]) ? merge(out[key], value) : value
  }
  return out
}

export function parse(value: unknown): BrowserConfig {
  const root = record(value, "config")
  const bridge = record(root.bridge ?? {}, "bridge")
  const kilo = record(root.kilo ?? {}, "kilo")
  const browser = record(root.browser ?? {}, "browser")
  const ui = record(root.ui ?? {}, "ui")
  const tools = record(root.tools ?? {}, "tools")
  const jail = record(root.jail ?? {}, "jail")
  const redaction = record(root.redaction ?? {}, "redaction")
  const memory = record(root.memory ?? {}, "memory")
  const logging = record(root.logging ?? {}, "logging")

  const host = text(bridge.host, DEFAULT_CONFIG.bridge.host, "bridge.host")
  if (!isLoopback(host)) throw new ConfigError("bridge.host", "must be a loopback host")

  const origins = strings(browser.allowedOrigins, DEFAULT_CONFIG.browser.allowedOrigins, "browser.allowedOrigins")
  for (const origin of origins) {
    if (origin === "*" || origin.includes("*://") || /^[a-z]+:\/\/\*/.test(origin)) {
      throw new ConfigError("browser.allowedOrigins", "wildcard origins are not allowed")
    }
  }

  const policies = {} as Record<ToolName, Policy>
  for (const name of TOOL_NAMES) {
    policies[name] = policy(tools[name], DEFAULT_CONFIG.tools[name], `tools.${name}`)
  }

  const level = text(logging.level, DEFAULT_CONFIG.logging.level, "logging.level")
  if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
    throw new ConfigError("logging.level", "must be debug, info, warn, or error")
  }

  const format = text(browser.screenshotFormat, DEFAULT_CONFIG.browser.screenshotFormat, "browser.screenshotFormat")
  if (format !== "png" && format !== "jpeg") {
    throw new ConfigError("browser.screenshotFormat", "must be png or jpeg")
  }

  const mode = text(ui.mode, DEFAULT_CONFIG.ui.mode, "ui.mode")
  if (mode !== "system" && mode !== "light" && mode !== "dark") {
    throw new ConfigError("ui.mode", "must be system, light, or dark")
  }

  const pageMode = text(ui.pageMode, DEFAULT_CONFIG.ui.pageMode, "ui.pageMode")
  if (pageMode !== "sidepanel" && pageMode !== "tab") {
    throw new ConfigError("ui.pageMode", "must be sidepanel or tab")
  }

  return {
    bridge: {
      host,
      port: integer(bridge.port, DEFAULT_CONFIG.bridge.port, "bridge.port", 0, 65535),
      idleTimeoutMs: integer(bridge.idleTimeoutMs, DEFAULT_CONFIG.bridge.idleTimeoutMs, "bridge.idleTimeoutMs", 1),
      maxPayloadBytes: integer(
        bridge.maxPayloadBytes,
        DEFAULT_CONFIG.bridge.maxPayloadBytes,
        "bridge.maxPayloadBytes",
        1,
      ),
      heartbeatMs: integer(bridge.heartbeatMs, DEFAULT_CONFIG.bridge.heartbeatMs, "bridge.heartbeatMs", 1),
      pongTimeoutMs: integer(bridge.pongTimeoutMs, DEFAULT_CONFIG.bridge.pongTimeoutMs, "bridge.pongTimeoutMs", 1),
    },
    kilo: {
      command: text(kilo.command, DEFAULT_CONFIG.kilo.command, "kilo.command"),
      args: strings(kilo.args, DEFAULT_CONFIG.kilo.args, "kilo.args"),
      startupTimeoutMs: integer(
        kilo.startupTimeoutMs,
        DEFAULT_CONFIG.kilo.startupTimeoutMs,
        "kilo.startupTimeoutMs",
        1,
      ),
      healthIntervalMs: integer(
        kilo.healthIntervalMs,
        DEFAULT_CONFIG.kilo.healthIntervalMs,
        "kilo.healthIntervalMs",
        1,
      ),
      healthTimeoutMs: integer(kilo.healthTimeoutMs, DEFAULT_CONFIG.kilo.healthTimeoutMs, "kilo.healthTimeoutMs", 1),
      restartMax: integer(kilo.restartMax, DEFAULT_CONFIG.kilo.restartMax, "kilo.restartMax", 0),
      restartWindowMs: integer(kilo.restartWindowMs, DEFAULT_CONFIG.kilo.restartWindowMs, "kilo.restartWindowMs", 1),
    },
    browser: {
      attach: text(browser.attach, DEFAULT_CONFIG.browser.attach, "browser.attach"),
      allowedOrigins: origins,
      allowedExtensionIds: strings(
        browser.allowedExtensionIds,
        DEFAULT_CONFIG.browser.allowedExtensionIds,
        "browser.allowedExtensionIds",
      ),
      defaultTimeoutMs: integer(
        browser.defaultTimeoutMs,
        DEFAULT_CONFIG.browser.defaultTimeoutMs,
        "browser.defaultTimeoutMs",
        1,
      ),
      screenshotFormat: format,
    },
    ui: {
      enabled: bool(ui.enabled, DEFAULT_CONFIG.ui.enabled, "ui.enabled"),
      theme: text(ui.theme, DEFAULT_CONFIG.ui.theme, "ui.theme"),
      mode,
      pageMode,
      settingsPage: settingsPage(ui.settingsPage),
      surfaces: isRecord(ui.surfaces) ? ui.surfaces : DEFAULT_CONFIG.ui.surfaces,
      bundle: stringRecord(ui.bundle, DEFAULT_CONFIG.ui.bundle, "ui.bundle"),
      capabilityOverrides: isRecord(ui.capabilityOverrides)
        ? ui.capabilityOverrides
        : DEFAULT_CONFIG.ui.capabilityOverrides,
    },
    tools: policies,
    jail: {
      roots: strings(jail.roots, DEFAULT_CONFIG.jail.roots, "jail.roots"),
      extraRoots: strings(jail.extraRoots, DEFAULT_CONFIG.jail.extraRoots, "jail.extraRoots"),
      artifactsDir: text(jail.artifactsDir, DEFAULT_CONFIG.jail.artifactsDir, "jail.artifactsDir"),
      maxArtifactBytes: integer(
        jail.maxArtifactBytes,
        DEFAULT_CONFIG.jail.maxArtifactBytes,
        "jail.maxArtifactBytes",
        1,
      ),
      retentionDays: integer(jail.retentionDays, DEFAULT_CONFIG.jail.retentionDays, "jail.retentionDays", 0),
    },
    redaction: {
      enabled: bool(redaction.enabled, DEFAULT_CONFIG.redaction.enabled, "redaction.enabled"),
      replacement: text(redaction.replacement, DEFAULT_CONFIG.redaction.replacement, "redaction.replacement"),
      headers: strings(redaction.headers, DEFAULT_CONFIG.redaction.headers, "redaction.headers"),
      queryKeys: strings(redaction.queryKeys, DEFAULT_CONFIG.redaction.queryKeys, "redaction.queryKeys"),
    },
    memory: {
      enabled: bool(memory.enabled, DEFAULT_CONFIG.memory.enabled, "memory.enabled"),
      injectBytes: integer(memory.injectBytes, DEFAULT_CONFIG.memory.injectBytes, "memory.injectBytes", 0),
      sessionLog: bool(memory.sessionLog, DEFAULT_CONFIG.memory.sessionLog, "memory.sessionLog"),
    },
    logging: {
      level,
      file: text(logging.file, DEFAULT_CONFIG.logging.file, "logging.file"),
      maxBytes: integer(logging.maxBytes, DEFAULT_CONFIG.logging.maxBytes, "logging.maxBytes", 1),
      keep: integer(logging.keep, DEFAULT_CONFIG.logging.keep, "logging.keep", 0),
    },
  }
}

function settingsPage(value: unknown): UiConfig["settingsPage"] {
  const page = text(value, DEFAULT_CONFIG.ui.settingsPage, "ui.settingsPage")
  if (page !== "tab" && page !== "window") throw new ConfigError("ui.settingsPage", "must be tab or window")
  return page
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new ConfigError(field, "must be an object")
  return value
}

function text(value: unknown, fallback: string, field: string) {
  if (value === undefined) return fallback
  if (typeof value !== "string" || value.length === 0) throw new ConfigError(field, "must be a non-empty string")
  return value
}

function bool(value: unknown, fallback: boolean, field: string) {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new ConfigError(field, "must be a boolean")
  return value
}

function integer(value: unknown, fallback: number, field: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ConfigError(field, "must be an integer")
  if (value < min || value > max) throw new ConfigError(field, `must be between ${min} and ${max}`)
  return value
}

function strings(value: unknown, fallback: string[], field: string) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ConfigError(field, "must be an array of strings")
  }
  return value as string[]
}

function stringRecord(value: unknown, fallback: Record<string, string>, field: string) {
  if (value === undefined) return { ...fallback }
  if (!isRecord(value)) throw new ConfigError(field, "must be an object")
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new ConfigError(`${field}.${key}`, "must be a string")
    out[key] = item
  }
  return out
}

function policy(value: unknown, fallback: Policy, field: string): Policy {
  if (value === undefined) return fallback
  if (value !== "allow" && value !== "ask" && value !== "deny") {
    throw new ConfigError(field, "must be allow, ask, or deny")
  }
  return value
}
