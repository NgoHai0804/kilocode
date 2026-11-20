# Kilo Browser Agent (`@kilocode/kilo-browser`)

Local bridge + MCP shim + Chrome MV3 extension that let the Kilo agent drive a real browser.
This is the beta sideload runbook: how to build, start, pair, load the extension, and roll back.
The extension is **not published to the Chrome Web Store** in this milestone (see §21 / OQ-4).

## Requirements

| Item | Requirement |
|---|---|
| Browser | Chrome or Edge 116+ (MV3 with `chrome.debugger`). Edge is supported; it still loads unpacked extensions. |
| Runtime | Bun 1.2+ on Windows, macOS, or Linux. |
| Kilo CLI | `kilo` on `PATH`, or point the bridge at an existing server with `--kilo-url`. |

## Install and build

From `packages/kilo-browser/`:

```bash
bun install            # from the repo root, once
bun run build          # bridge + CLI + MCP shim + guard plugin -> dist/
bun run build:ui       # Vite UI -> extension/dist/ui-dist (sidepanel + settings)
bun run build:extension # MV3 service worker + manifest -> extension/dist (keeps ui-dist)
```

Release path order is `build` → `build:ui` → `build:extension` so the packed extension contains a fresh UI.
`extension/build.ts` preserves an existing `extension/dist/ui-dist` when it rebuilds.

## Start the bridge and pair

```bash
bun run dev -- start --workspace .   # dev mode (persists the token)
# or, after build:
kilo-browser start --workspace . --persist-token   # production start
```

The bridge prints a pairing code (6 digits, valid for 120s) and the loopback URL. Only one extension may be paired at a time.

`--persist-token` reuses one bridge token across restarts (stored at `.kilo/kilo-browser/token`). Without it every
start mints a new token and drops the paired extension, so a running UI is rejected with `401` — its WebSocket
logs `ws://127.0.0.1:<port>/ws?role=ui failed` and the panel shows **Reconnecting**. The `dev` script already
passes `--persist-token`; if you run the bridge with `--watch` yourself, add it too.

- Rotate or revoke the bridge token: `kilo-browser pair --rotate` / `kilo-browser pair --revoke`
  (with `--workspace <path>` if you did not start from the workspace root).
- Rotation/revoke also closes the connected extension socket.

## Load the extension (sideload)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** and select the absolute path to `packages/kilo-browser/extension/dist`.
4. Pin the Kilo Browser action and open the side panel.

Opening the surfaces directly (for debugging):

- Side panel UI: `chrome-extension://<id>/ui-dist/sidepanel.html`
- Settings UI: `chrome-extension://<id>/ui-dist/settings.html`

Find `<id>` on the extensions page, or in the service worker URL under "Inspect views: service worker".

## Pair from the UI

Enter the 6-digit pair code from the bridge in the side panel pairing gate. The UI claims the token via
`POST /pair/claim` and stores it in `chrome.storage.local`/localStorage; the token is never shown in logs.

If you do not want to type a code every time, add the extension id to `browser.allowedExtensionIds` in
`.kilo/kilo-browser.json` (find the id on `chrome://extensions`). The bridge then **pre-approves** that
extension: the pairing gate shows **Connect** instead of a code field, and a code-less connect still returns
the same token. Only that extension id is trusted — the token boundary stays in place.

## Tab attachment

By default the extension **auto-attaches to the active tab** and follows `chrome.tabs.onActivated`, so the
agent can drive whatever page you are looking at. Set `autoAttach: false` in the extension storage to stop
following the active tab; the extension then stays on the tab it last attached to.

## Permissions

The extension requests, and the bridge enforces, the minimum needed:

| Permission | Why |
|---|---|
| `debugger` | CDP attach for snapshot/screenshot/console/network/interact. |
| `storage` | Pairing token and local UI state. |
| `sidePanel`, `tabs`, `alarms` | Side panel, tab attach, service-worker keepalive/reconnect. |
| `host_permissions: http://localhost/*`, `http://127.0.0.1/*` | Loopback bridge only. |

Optional site access (`https://*/*`, `http://*/*`) is requested per origin and gated by the bridge allowlist.
`browser_eval` is `deny` by default and asks for approval when enabled.

## E2E and quality gates

```bash
bun run typecheck
bun test              # unit + integration + e2e
bun run test:e2e      # Playwright persistent-context E2E (needs Chrome/Chromium/Edge)
bun run test:ui       # E2E UI: chat, settings, permission, history, capabilities
```

The E2E harness loads `extension/dist` with `--load-extension` in a real persistent browser context.
It prefers a Playwright Chromium, then Chrome for Testing, then Edge, then branded Chrome. Branded Chrome
137+ ignores `--load-extension`, so the launcher falls through to the next candidate. If no browser is
available the specs skip with an explicit reason string (never a silent pass); set `KILO_E2E_BROWSER` to
an executable path to override.

On Windows every spawned process must set `windowsHide: true` to avoid flashing a console window.

## Uninstall and rollback

- Remove the extension: `chrome://extensions` → Kilo Browser → **Remove**.
- Revoke the token so a re-added extension must re-pair: `kilo-browser pair --revoke`.
- Stop the bridge (Ctrl+C). On shutdown the bridge deletes `.kilo/kilo-browser/runtime.json`.
- To fully reset local state, delete `.kilo/kilo-browser/` in the workspace and re-pair.

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI shows "Reconnecting" | Bridge not running, or the token was rotated. Start the bridge and pair again. |
| UI WebSocket `…/ws?role=ui` fails, model list stays empty | Bridge token rotated on restart. Restart with `--persist-token` (the `dev` script does this) or re-pair with the current code. |
| Pair code rejected | Code expired (120s) or too many wrong attempts (lockout 60s). Restart/rotate and retry. |
| `DEVTOOLS_CONFLICT` | Close DevTools on the target tab, then retry. |
| `Origin not in allowlist` | Add the origin in Settings, or use `http://127.0.0.1`/`http://localhost`. |
| Extension socket closed immediately | Another extension is already paired. Revoke and re-pair. |
