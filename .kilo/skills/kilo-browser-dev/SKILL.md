---
name: kilo-browser-dev
description: Use when developing, building, running, pairing, or testing the @kilocode/kilo-browser package in this repo (the Bun bridge + CLI + MCP shim + MV3 Chrome/Edge extension), covering build order, dev/prod start, token persistence, extension sideload, config schema, state files, endpoints, and the Playwright e2e harness; triggers include kilo-browser, browser bridge, kilo attach, pair or pair code, chrome extension MV3, MCP shim, sideload, e2e for the browser, and build the extension, and it is not for using the browser tools to browse pages (that is a separate skill).
---

# Developing the kilo-browser package

This skill is for **developing, building, running, pairing, and testing** `@kilocode/kilo-browser` in this repo: the Bun bridge/CLI, the MCP shim, the guard plugin, and the MV3 browser extension. It is **not** about using the `browser_*` tools to browse a page.

Package root: `packages/kilo-browser/`. Private package. Bins: `kilo-browser` -> `dist/cli.js` and `kilo-browser-mcp` -> `dist/mcp/main.js`.

All commands below run from `packages/kilo-browser/` unless stated otherwise.

## Build

| Script | Command | Does |
|---|---|---|
| build | `bun run build.ts` | bundles bridge + CLI + MCP + guard plugin into `dist/` |
| build:ui | `vite build extension/vite.config.ts` | builds UI into `extension/dist/ui-dist` |
| build:extension | `bun run build:ui && bun run extension/build.ts` | MV3 service worker + manifest into `extension/dist` |
| dev | `bun run --watch src/cli.ts --persist-token` | watch-mode bridge start (persist token) |
| dev:ui | `vite` dev server on `http://127.0.0.1:3019` | extension UI dev server |
| typecheck | `tsgo --noEmit` | typecheck |
| test | `bun test` | unit + integration + e2e |
| test:e2e | `bun test test/e2e` | Playwright persistent-context e2e |
| test:ui | `bun test test/e2e/ui` | UI e2e specs |

Release order: `build` -> `build:ui` -> `build:extension`, so the packed extension ships a fresh UI. `extension/build.ts` preserves an existing `extension/dist/ui-dist`.

```bash
bun run build && bun run build:ui && bun run build:extension
```

## Run and pair

```bash
# dev (the dev script already passes --persist-token)
bun run dev -- start --workspace .

# prod
kilo-browser start --workspace . --persist-token
```

`start` prints the bridge URL, a 6-digit pair code (TTL 120s), and the `kilo attach` line. Add `--json` for machine-readable output.

Rotate or revoke pairing (add `--workspace <path>` if not at the workspace root):

```bash
kilo-browser pair --rotate
kilo-browser pair --revoke
```

Without `--persist-token`, every start mints a new token and drops the paired extension: the UI WS shows "Reconnecting" and the model list is empty. The `dev` script passes `--persist-token` for you.

Flags: `--workspace <path>`, `--host`, `--port` (`0` = OS-assigned), `--kilo <path>`, `--kilo-url <url>` + `--kilo-password`, `--no-spawn`, `--pair-ttl <s>`, `--idle-timeout <s>`, `--log-level`, `--persist-token`, `--json`, `--foreground`/`--no-foreground`, `--help`.

Exit codes: preflight fail `2`, start fail `3`, unknown command `2`; an already-healthy bridge prints `ALREADY_RUNNING` and exits `0`.

## Sideload the extension

The extension is beta and not published. Load it unpacked:

1. Open `chrome://extensions` (or `edge://extensions`) and enable Developer mode.
2. Load unpacked -> absolute path `packages/kilo-browser/extension/dist`.
3. Surfaces: `chrome-extension://<id>/ui-dist/sidepanel.html` and `chrome-extension://<id>/ui-dist/settings.html`.

Manifest is MV3, min Chrome 116, permissions `debugger`/`storage`/`sidePanel`/`tabs`/`alarms`, host permissions localhost/127.0.0.1.

Pairing model: one extension at a time. The 6-digit code is derived from `sha256(secret:generation)`, TTL 120s, 5 wrong attempts -> 60s lockout. `browser.allowedExtensionIds` pre-approves an extension id so the UI shows "Connect" (code-less) and returns the same token. Rotate/revoke closes the current extension socket.

## Configure

Config file is `.kilo/kilo-browser.json` (a **file**, not a directory), schema `https://kilo.ai/schemas/kilo-browser.json`. Precedence: CLI flag > env var > project `.kilo/kilo-browser.json` > global `~/.config/kilo/kilo-browser.json` > default. An invalid schema stops the bridge; there is no partial merge.

| Key | Notes |
|---|---|
| bridge | `host` (loopback only), `port`, `idleTimeoutMs`, `maxPayloadBytes`, `heartbeatMs`, `pongTimeoutMs` |
| kilo | `command`, `args`, `startupTimeoutMs`, `healthIntervalMs`, `healthTimeoutMs`, `restartMax`, `restartWindowMs` |
| browser | `attach`, `allowedOrigins` (default `http://localhost:*`, `http://127.0.0.1:*`; wildcards rejected), `allowedExtensionIds`, `defaultTimeoutMs`, `screenshotFormat` |
| ui | UI settings |
| tools | `<name>`: `allow` \| `ask` \| `deny`; all default `allow` except `eval` = `deny` |
| jail | `roots`, `extraRoots`, `artifactsDir`, `maxArtifactBytes`, `retentionDays` |
| redaction | `enabled`, `replacement`, `headers`, `queryKeys` |
| memory | memory settings |
| logging | `level`, `file`, `maxBytes`, `keep` |

Env vars: `KILO_BROWSER_RUNTIME`, `KILO_BROWSER_HOME`, `KILO_BROWSER_LOG_LEVEL`, `KILO_BROWSER_PAIR_TTL`, `KILO_BROWSER_IDLE_TIMEOUT`, `KILO_BROWSER_NO_SPAWN`, `KILO_BROWSER_KILO_URL`, `KILO_BROWSER_TOKEN` (test-only).

Generated config: `config/generate.ts` writes/merges `.kilo/kilo.json`, adding `mcp.browser` (type `local`, command = MCP binary + `--runtime <abs runtime.json>`), `permission` keys from `BROWSER_PERMISSIONS` (all `browser_*` allow except `browser_eval` deny), `instructions: [".kilo/kilo-browser/AGENTS.md"]`, and `plugin: ["./.kilo/plugins/kilo-browser-guard.ts"]`.

## State files and endpoints

State lives under the workspace `<ws>/.kilo/`:

| Path | Contents |
|---|---|
| kilo-browser/runtime.json | `{httpUrl,wsUrl,token,kiloUrl,pid,startedAt,protocolVersion,bridgeVersion}`; mode 0600; deleted on shutdown |
| kilo-browser/token | persisted bridge token (only with `--persist-token`) |
| kilo-browser/logs/bridge.jsonl | JSONL events (redacted); rotated 10 MB x3 |
| kilo-browser/bridge.lock | `{pid,startedAt}` preflight lock |
| kilo-browser/artifacts/ | screenshots + truncated eval results |
| kilo-browser/AGENTS.md, MEMORY.md, sessions/ | generated/user instructions + notes |
| kilo-browser.json | browser config |

Endpoints (`Bun.serve` on `127.0.0.1:<port>`):

| Route | Auth | Notes |
|---|---|---|
| GET /health | none | health check |
| GET /pair/hint | none | pairing hint |
| POST /pair/claim | loopback + extension origin | rate-limited 12/min/IP |
| POST /pair/rotate, /pair/revoke | Bearer | rotate/revoke token |
| POST /tool | Bearer | body `{method:"browser.*", params, requestId?, sessionID?, callID?, timeoutMs?}` |
| WS /ws | extension | extension socket |
| WS /ws?role=ui | UI | UI socket |
| GET /ui/file, /ui/diff, /ui/url-guard | UI | UI helpers |
| /kilo/* | Bearer | status, abort, permissions, sessions, prompt |

`GET /events` (SSE) is spec'd but **not implemented**.

## Test

```bash
bun test              # unit + integration + e2e
bun test test/e2e     # Playwright persistent-context e2e
bun test test/e2e/ui  # UI e2e specs
```

The e2e harness (`test/e2e/harness.ts`) loads `extension/dist` via `--load-extension` in a persistent context. Browser candidate order: `KILO_E2E_BROWSER` env override, then Playwright Chromium, then Chrome for Testing, then Edge, then branded Chrome. Branded Chrome 137+ **ignores** `--load-extension`, so it is tried last and the launcher falls through. `e2eSkipReason()` returns an explicit skip (never a silent pass) when no Chromium-family browser exists or `extension/dist/manifest.json` is missing, so run `bun run build:extension` before e2e. The UI harness pairs the real extension against an in-process bridge plus a fake Kilo backend.

## Traps

- **Stale workspace AGENTS.md.** `<ws>/.kilo/kilo-browser/AGENTS.md` is generated from `packages/kilo-browser/src/templates/AGENTS.md` only if absent (`src/bridge/memory.ts` `ensureTemplates`). Editing the template does not update an existing workspace copy. In this repo the installed `.kilo/kilo-browser/AGENTS.md` is a stale 12-tool copy (it even says "There is no tool to open or switch tabs"), while the template and the real implementation expose 27 tools (including `browser_tabs`/`switch_tab`/`new_tab`/`close_tab`). The authoritative source is `packages/kilo-browser/src/templates/AGENTS.md`. Refresh an existing copy by deleting `.kilo/kilo-browser/AGENTS.md` and restarting the bridge, or copy the template over it.
- **Stale permissions.** `.kilo/kilo.json` in this repo still grants only the old 12 `browser_*` permissions and lacks the guard `plugin` entry.
- **One extension at a time.** A second extension cannot pair while one is connected.
- **Token rotation drops the UI.** Without `--persist-token`, a restart mints a new token and un-pairs the extension.
- **windowsHide.** Windows spawned processes must set `windowsHide: true`.
- **eval deny by default.** `browser_eval` starts as `deny`.
- **Jail is logical, not an OS sandbox.** Path jail constrains bridge logic only.
- **Serialized tool calls.** Only one tool call runs at a time; extra calls queue, then return `BUSY` after ~5s.

## Specs

- `docs/specs/kilo-browser/*` — protocol, config, and pairing specs.
- `packages/kilo-browser/README.md` — package overview.

For the user-facing browser workflow (operating the tools on a live tab), use the `browser-drive` skill; this skill only covers building and testing the package.