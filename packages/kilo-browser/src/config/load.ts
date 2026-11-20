import os from "node:os"
import path from "node:path"
import { ConfigError, DEFAULT_CONFIG, merge, parse, type BrowserConfig } from "./schema"

export type Flags = {
  host?: string
  port?: number
  kilo?: string
  kiloUrl?: string
  kiloPassword?: string
  noSpawn?: boolean
  pairTtl?: number
  idleTimeout?: number
  logLevel?: "debug" | "info" | "warn" | "error"
  json?: boolean
  foreground?: boolean
  persistToken?: boolean
  pairRotate?: boolean
  pairRevoke?: boolean
}

export type LoadOptions = {
  workspace: string
  flags?: Flags
  env?: Record<string, string | undefined>
  home?: string
}

export type Loaded = {
  config: BrowserConfig
  kiloUrl?: string
  kiloPassword?: string
  noSpawn: boolean
  pairTtlMs: number
  token?: string
  persistToken: boolean
  json: boolean
  foreground: boolean
}

export async function load(options: LoadOptions): Promise<Loaded> {
  const env = options.env ?? process.env
  const flags = options.flags ?? {}
  const globalPath = path.join(options.home ?? os.homedir(), ".config", "kilo", "kilo-browser.json")
  const projectPath = path.join(options.workspace, ".kilo", "kilo-browser.json")
  const globalRaw = await readJson(globalPath)
  const projectRaw = await readJson(projectPath)

  const envPatch = envConfig(env)
  const flagPatch = flagConfig(flags)
  const raw = merge(merge(merge(DEFAULT_CONFIG, globalRaw), projectRaw), merge(envPatch, flagPatch))
  const config = parse(raw)

  const noSpawn = flags.noSpawn ?? (env.KILO_BROWSER_NO_SPAWN === "1" || flags.kiloUrl !== undefined)
  const pairSeconds = flags.pairTtl ?? numberEnv(env.KILO_BROWSER_PAIR_TTL) ?? 120
  const token = env.KILO_BROWSER_TOKEN || undefined

  return {
    config,
    kiloUrl: flags.kiloUrl ?? (env.KILO_BROWSER_KILO_URL || undefined),
    kiloPassword: flags.kiloPassword ?? (env.KILO_BROWSER_KILO_PASSWORD || undefined),
    noSpawn,
    pairTtlMs: pairSeconds * 1000,
    token,
    persistToken: flags.persistToken ?? false,
    json: flags.json ?? false,
    foreground: flags.foreground ?? true,
  }
}

function envConfig(env: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const idle = numberEnv(env.KILO_BROWSER_IDLE_TIMEOUT)
  if (idle !== undefined) out.bridge = { idleTimeoutMs: idle }
  if (env.KILO_BROWSER_LOG_LEVEL) out.logging = { level: env.KILO_BROWSER_LOG_LEVEL }
  return out
}

function flagConfig(flags: Flags): Record<string, unknown> {
  const bridge: Record<string, unknown> = {}
  if (flags.host !== undefined) bridge.host = flags.host
  if (flags.port !== undefined) bridge.port = flags.port
  if (flags.idleTimeout !== undefined) bridge.idleTimeoutMs = flags.idleTimeout * 1000
  const kilo: Record<string, unknown> = {}
  if (flags.kilo !== undefined) kilo.command = flags.kilo
  const logging: Record<string, unknown> = {}
  if (flags.logLevel !== undefined) logging.level = flags.logLevel
  return { bridge, kilo, logging }
}

function numberEnv(value: string | undefined) {
  if (value === undefined || value.length === 0) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new ConfigError("env", `invalid number ${value}`)
  return parsed
}

async function readJson(file: string): Promise<unknown> {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return {}
  const text = await handle.text()
  try {
    return JSON.parse(text) as unknown
  } catch (err) {
    throw new ConfigError(file, err instanceof Error ? err.message : "invalid JSON")
  }
}

