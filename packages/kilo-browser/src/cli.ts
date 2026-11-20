import path from "node:path"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import { load, type Flags } from "./config/load"
import { ensureBrowserConfig, ensureGuard, generateKiloConfig } from "./config/generate"

import { preflight } from "./bridge/preflight"
import { Supervisor } from "./bridge/supervisor"
import { BridgeServer } from "./bridge/server"
import { KiloClient } from "./bridge/kilo"
import { cleanupArtifacts, seed } from "./bridge/memory"

type Parsed = {
  command: string
  workspace: string
  flags: Flags
  help: boolean
}

const HELP = `kilo-browser start [options]
       kilo-browser pair --rotate|--revoke [--workspace <path>]

Options:
  --workspace <path>      Workspace root and jail root (default: cwd)
  --host <host>           Loopback bind host (default: 127.0.0.1)
  --port <port>           HTTP/WS port (default: 0, OS assigned)
  --kilo <path>           Kilo binary to spawn (default: kilo)
  --kilo-url <url>        Use an existing Kilo server; requires --kilo-password
  --kilo-password <pw>    Basic password for --kilo-url (never logged)
  --no-spawn              Do not spawn Kilo (alias for --kilo-url)
  --pair-ttl <seconds>    Pairing code TTL (default: 120)
  --idle-timeout <seconds> Idle shutdown timeout (default: 1800)
  --log-level <level>     debug | info | warn | error (default: info)
  --persist-token         Reuse the bridge token across starts
  --rotate                Rotate/revoke the bridge token (pair command)
  --revoke                Revoke the bridge token and close the extension socket
  --json                  Print machine-readable startup output
  --foreground            Run in foreground (default: true)
  --help                  Show this help
`

/** Wire supervisor restarts so a rebuilt Kilo endpoint retargets the client and its SSE stream. */
export function supervisorEndpointHook(resolve: () => KiloClient | undefined) {
  return (info: { url: string }) => {
    resolve()?.setEndpoint(info.url)
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (parsed.command === "pair") return pair(parsed)
  if (parsed.command !== "start") {
    process.stderr.write(`unknown command: ${parsed.command}\n${HELP}`)
    return 2
  }

  const workspace = path.resolve(parsed.workspace)
  const loaded = await load({ workspace, flags: parsed.flags }).catch((err: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: "PREFLIGHT_FAILED", checks: [{ id: "config", ok: false, detail: message(err) }] })}\n`,
    )
    return undefined
  })
  if (!loaded) return 2
  const skipKilo = loaded.noSpawn
  const checked = await preflight({ workspace, config: loaded.config, skipKilo })

  if (!checked.ok) {
    if (checked.running?.healthy) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, code: "ALREADY_RUNNING", healthy: true, runtime: checked.running.runtime })}\n`,
      )
      return 0
    }
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: "PREFLIGHT_FAILED",
        checks: checked.checks,
      })}\n`,
    )
    return 2
  }

  const lock = checked.lock
  let supervisor: Supervisor | undefined
  let bridge: BridgeServer | undefined
  let kilo: KiloClient | undefined
  let password = loaded.kiloPassword
  let endpoint = loaded.kiloUrl

  try {
    await ensureBrowserConfig(workspace)
    await seed(workspace)
    await ensureGuard(workspace)
    await generateKiloConfig({ workspace })
    await cleanupArtifacts(workspace, { retentionDays: loaded.config.jail.retentionDays })

    if (loaded.noSpawn) {
      if (!endpoint || !password) throw new Error("--no-spawn requires --kilo-url and --kilo-password")
    } else {
      supervisor = new Supervisor({ config: loaded.config, cwd: workspace, onReady: supervisorEndpointHook(() => kilo) })
      const info = await supervisor.start()
      endpoint = info.url
      password = supervisor.credentials.password
    }

    if (!endpoint || !password) throw new Error("no Kilo endpoint configured")
    kilo = new KiloClient(endpoint, { username: "kilo", password })

    const token = loaded.persistToken ? await persistedToken(workspace) : loaded.token
    bridge = new BridgeServer({
      workspace,
      config: loaded.config,
      kilo,
      pairTtlMs: loaded.pairTtlMs,
      token,
    })
    await bridge.start()
    if (loaded.persistToken) await persistToken(workspace, bridge.token())

    printStartup(bridge, endpoint, loaded.json)
    await Promise.race([waitForSignal(), bridge.closed])
    return 0
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "START_FAILED", message: message(err) })}\n`)
    return 3
  } finally {
    try {
      await bridge?.stop()
      await kilo?.stop?.()
      await supervisor?.stop()
    } catch (err) {
      process.stderr.write(`shutdown: ${message(err)}\n`)
    }
    await lock?.release()
  }
}

async function pair(parsed: Parsed): Promise<number> {
  if (!parsed.flags.pairRotate && !parsed.flags.pairRevoke) {
    process.stderr.write("pair requires --rotate or --revoke\n")
    return 2
  }
  const workspace = path.resolve(parsed.workspace)
  const file = path.join(workspace, ".kilo", "kilo-browser", "runtime.json")
  if (!(await Bun.file(file).exists())) {
    process.stderr.write(`no running bridge runtime at ${file}\n`)
    return 2
  }
  const runtime = JSON.parse(await Bun.file(file).text()) as unknown
  if (!isRecord(runtime) || typeof runtime.httpUrl !== "string" || typeof runtime.token !== "string") {
    process.stderr.write(`invalid runtime file at ${file}\n`)
    return 2
  }
  const action = parsed.flags.pairRotate ? "rotate" : "revoke"
  const response = await fetch(`${runtime.httpUrl.replace(/\/+$/, "")}/pair/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${runtime.token}` },
  })
  const body = (await response.json()) as unknown
  if (!response.ok || !isRecord(body) || body.ok !== true || !isRecord(body.result) || typeof body.result.token !== "string") {
    process.stderr.write(`pair ${action} failed: ${response.status}\n`)
    return 3
  }
  const token = body.result.token
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, action, token })}\n`)
  } else {
    process.stdout.write(`${action}: ${token}\n`)
  }
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function printStartup(bridge: BridgeServer, endpoint: string, json: boolean) {
  const attach = `kilo attach ${endpoint}`
  const note = "Supply the Kilo password with --password or KILO_SERVER_PASSWORD from a secret store; it is not printed here."
  const info = {
    ok: true,
    bridgeUrl: bridge.url,
    wsUrl: bridge.wsUrl,
    pairUrl: bridge.url,
    pairCode: bridge.pairCode,
    pairCodeExpiresInMs: bridge.pairing.codeExpiresAt - Date.now(),
    kiloUrl: endpoint,
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(info)}\n`)
    process.stderr.write(`${attach}\n`)
    process.stderr.write(`${note}\n`)
    return
  }
  process.stdout.write(`Kilo Browser bridge listening on ${bridge.url}\n`)
  process.stdout.write(`Pair URL: ${bridge.url}\n`)
  process.stdout.write(`Pair code: ${bridge.pairCode}\n`)
  process.stdout.write(`${attach}\n`)
  process.stdout.write(`${note}\n`)
}

async function waitForSignal() {
  const stop = Promise.withResolvers<void>()
  const done = () => stop.resolve()
  process.once("SIGINT", done)
  process.once("SIGTERM", done)
  await stop.promise
  process.removeListener("SIGINT", done)
  process.removeListener("SIGTERM", done)
}

async function persistedToken(workspace: string) {
  const file = path.join(workspace, ".kilo", "kilo-browser", "token")
  if (!(await Bun.file(file).exists())) return undefined
  const token = (await Bun.file(file).text()).trim()
  return /^[a-f0-9]{64}$/i.test(token) ? token : undefined
}

async function persistToken(workspace: string, token: string) {
  const file = path.join(workspace, ".kilo", "kilo-browser", "token")
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  if (process.platform !== "win32") await chmod(file, 0o600)
}

function parseArgs(argv: string[]): Parsed {
  const flags: Flags = {}
  let command = "start"
  let workspace = process.cwd()
  let help = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    // Command tokens may appear after injected default flags (e.g. the dev
    // script prepends `--persist-token`), so accept `start`/`pair` anywhere.
    if (token === "start" || token === "pair") {
      command = token
      continue
    }
    if (token === "--help" || token === "-h") {
      help = true
      continue
    }
    const { name, inline } = split(token)
    const value = () => inline ?? argv[++index]
    switch (name) {
      case "--workspace":
        workspace = value() ?? workspace
        break
      case "--host":
        flags.host = value()
        break
      case "--port":
        flags.port = number(value(), "--port")
        break
      case "--kilo":
        flags.kilo = value()
        break
      case "--kilo-url":
        flags.kiloUrl = value()
        break
      case "--kilo-password":
        flags.kiloPassword = value()
        break
      case "--no-spawn":
        flags.noSpawn = true
        break
      case "--pair-ttl":
        flags.pairTtl = number(value(), "--pair-ttl")
        break
      case "--idle-timeout":
        flags.idleTimeout = number(value(), "--idle-timeout")
        break
      case "--log-level":
        flags.logLevel = level(value())
        break
      case "--persist-token":
        flags.persistToken = true
        break
      case "--rotate":
        flags.pairRotate = true
        break
      case "--revoke":
        flags.pairRevoke = true
        break
      case "--json":
        flags.json = true
        break
      case "--foreground":
        flags.foreground = true
        break
      case "--no-foreground":
        flags.foreground = false
        break
      default:
        throw new Error(`unknown option: ${name}`)
    }
  }
  return { command, workspace, flags, help }
}

function split(token: string) {
  const index = token.indexOf("=")
  if (index < 0) return { name: token, inline: undefined }
  return { name: token.slice(0, index), inline: token.slice(index + 1) }
}

function number(value: string | undefined, flag: string) {
  if (value === undefined) throw new Error(`${flag} requires a value`)
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`)
  return parsed
}

function level(value: string | undefined): "debug" | "info" | "warn" | "error" {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value
  throw new Error("--log-level must be debug, info, warn, or error")
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      process.stderr.write(`kilo-browser: ${message(err)}\n`)
      process.exitCode = 2
    })
}





