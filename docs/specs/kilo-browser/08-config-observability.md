# Config và observability

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §13 và §14.

## 13. Config reference

### 13.1 `.kilo/kilo-browser.json`

```json
{
  "$schema": "https://kilo.ai/schemas/kilo-browser.json",
  "bridge": {
    "host": "127.0.0.1",
    "port": 0,
    "idleTimeoutMs": 1800000,
    "maxPayloadBytes": 8388608,
    "heartbeatMs": 10000,
    "pongTimeoutMs": 30000
  },
  "kilo": {
    "command": "kilo",
    "args": ["serve", "--port", "0", "--hostname", "127.0.0.1"],
    "startupTimeoutMs": 20000,
    "healthIntervalMs": 10000,
    "healthTimeoutMs": 3000,
    "restartMax": 5,
    "restartWindowMs": 60000
  },
  "browser": {
    "attach": "manual",
    "allowedOrigins": ["http://localhost:*", "http://127.0.0.1:*"],
    "defaultTimeoutMs": 15000,
    "screenshotFormat": "png"
  },
  "ui": {
    "enabled": true,
    "theme": "kilo",
    "mode": "system",
    "pageMode": "sidepanel",
    "settingsPage": "tab",
    "surfaces": {
      "chat": true,
      "sessions": true,
      "history": true,
      "profile": true,
      "settings": ["models", "providers", "autoApprove", "agentBehaviour", "display", "language", "about"]
    },
    "bundle": {"sidepanel": "extension/dist/sidepanel.html", "settings": "extension/dist/settings.html"},
    "capabilityOverrides": {}
  },
  "tools": {
    "status": "allow",
    "navigate": "allow",
    "snapshot": "allow",
    "screenshot": "allow",
    "console": "allow",
    "network": "allow",
    "click": "allow",
    "type": "allow",
    "press": "allow",
    "reload": "allow",
    "wait_for": "allow",
    "eval": "deny"
  },
  "jail": {
    "roots": ["${workspace}"],
    "extraRoots": [],
    "artifactsDir": ".kilo/kilo-browser/artifacts",
    "maxArtifactBytes": 2097152,
    "retentionDays": 7
  },
  "redaction": {
    "enabled": true,
    "replacement": "[REDACTED]",
    "headers": ["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key", "x-auth-token"],
    "queryKeys": ["token", "access_token", "key", "secret", "password"]
  },
  "memory": {"enabled": true, "injectBytes": 8192, "sessionLog": true},
  "logging": {"level": "info", "file": ".kilo/kilo-browser/logs/bridge.jsonl", "maxBytes": 10485760, "keep": 3}
}
```

§13.1 là cấu hình permissive mặc định; để chặt hơn, thay từng giá trị bằng `"ask"` (ví dụ `tools.navigate`).

### 13.2 `.kilo/kilo.json` (generated)

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "permission": {
    "external_directory": "deny",
    "browser_status": "allow",
    "browser_navigate": "allow",
    "browser_snapshot": "allow",
    "browser_screenshot": "allow",
    "browser_console": "allow",
    "browser_network": "allow",
    "browser_click": "allow",
    "browser_type": "allow",
    "browser_press": "allow",
    "browser_reload": "allow",
    "browser_wait_for": "allow",
    "browser_eval": "deny"
  },
  "instructions": [".kilo/kilo-browser/AGENTS.md"],
  "plugin": ["./.kilo/plugins/kilo-browser-guard.ts"],
  "mcp": {
    "browser": {
      "type": "local",
      "command": ["/abs/path/kilo-browser-mcp", "--runtime", "/abs/path/runtime.json"],
      "environment": {"KILO_BROWSER_RUNTIME": "/abs/path/runtime.json"},
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Ghi chú: Kilo gọi `ctx.ask({ permission: key, metadata: { mcpInput: args }, patterns: ["*"], always: ["*"] })` với `key` là tên MCP đã namespace (`browser_navigate`, ...), và `permission` config là record mở nên chấp nhận key tùy biến (`packages/opencode/src/session/tools.ts:502`, `packages/core/src/v1/config/permission.ts:9-44`). Vì vậy block `browser_*` ở trên có hiệu lực; shim và guard vẫn là defense-in-depth. Bridge thay các đường dẫn `/abs/path/...` bằng đường dẫn tuyệt đối lúc generate.

`instructions` là bắt buộc: Kilo chỉ auto-discover `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` từ project directory ngược lên worktree, nên `.kilo/kilo-browser/AGENTS.md` không được nạp nếu không khai báo (`packages/opencode/src/session/instruction.ts:74-78,165-180`).

Lưu ý: permission của Kilo không origin-aware. Origin allowlist, chặn `file://`/`chrome://`/`devtools://`, và cảnh báo password-field do bridge policy + guard plugin + approval của extension thực thi. `ask` vẫn khả dụng cho setup chặt hơn qua `.kilo/kilo-browser.json` (`tools.navigate: "ask"`, ...).

### 13.3 Env vars

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `KILO_BROWSER_RUNTIME` | rỗng | Đường dẫn `runtime.json` cho shim |
| `KILO_BROWSER_HOME` | `${workspace}/.kilo/kilo-browser` | Gốc dữ liệu bridge |
| `KILO_BROWSER_LOG_LEVEL` | `info` | Ghi đè log level |
| `KILO_BROWSER_PAIR_TTL` | `120` | TTL pairing code |
| `KILO_BROWSER_IDLE_TIMEOUT` | `1800000` | Idle timeout |
| `KILO_BROWSER_NO_SPAWN` | `0` | `1` thì không spawn `kilo serve` |
| `KILO_BROWSER_KILO_URL` | rỗng | URL server có sẵn |
| `KILO_BROWSER_TOKEN` | rỗng | Chỉ dùng cho test; production đọc từ `runtime.json` |

### 13.4 Precedence

CLI flag > env var > `.kilo/kilo-browser.json` (project) > `~/.config/kilo/kilo-browser.json` (global) > default. Config sai schema dừng bridge, không merge một phần.

### 13.5 Không bao giờ ghi đè

- `AGENTS.md`, `MEMORY.md`, `sessions/*` do người dùng/agent sửa.
- `kilo-browser.json` nếu đã tồn tại; bridge chỉ in diff đề xuất.
- `.kilo/kilo.json`: chỉ thêm key `mcp.browser`, `plugin` entry, `permission` entry và `instructions` entry (`.kilo/kilo-browser/AGENTS.md`) còn thiếu; không xóa instruction entry của người dùng, không đổi thứ tự, không format lại toàn file.
- File ngoài `.kilo/` không bị chạm.

### 13.6 Settings routing

| Nhóm setting | Nơi lưu | Ghi qua | Không ghi |
|---|---|---|---|
| Project config (`models`, `providers`, `autoApprove`, agents, MCP) | `.kilo/kilo.json` | bridge `ui.config.write` | Không ghi browser prefs vào đây |
| Global config | global Kilo config | bridge | Không ghi secret |
| Display (`theme`, `mode`, `pageMode`) | `chrome.storage.local` | host adapter | Không gửi sang `kilo serve` |
| Ephemeral (dialog, scroll, draft ngắn) | `chrome.storage.session` | host adapter | Không tồn tại sau đóng trình duyệt |
| Gateway/session token | SW memory + local có TTL | SW | Không vào log/artifact/runtime.json |

## 14. Observability

### 14.1 JSONL events

Mọi dòng có `ts` (ISO-8601), `level`, `event`, `sessionID?`, `requestId?`, `durationMs?`, `data`.

| Event | Data chính |
|---|---|
| `bridge.start` | `version`, `protocolVersion`, `workspace`, `pid` |
| `preflight.ok` / `preflight.fail` | `checks[]` |
| `kilo.spawn` / `kilo.ready` / `kilo.exit` | `pid`, `url`, `code?`, `signal?` |
| `ws.open` / `ws.close` | `extensionId`, `code`, `reason` |
| `ui.port.open` / `ui.port.close` | `page`, `tabId?`, `reason` |
| `ui.rpc.request` / `ui.rpc.response` / `ui.rpc.error` | `method`, `code?`, `bytes`, `durationMs` |
| `ui.capability.hide` | `surface`, `reason` |
| `ui.render.error` | `page`, `message`, `stackHash` |
| `ui.asset.missing` | `path`, `page` |
| `pair.start` / `pair.ok` / `pair.fail` / `pair.lockout` | `attempt`, `extensionId?` |
| `rpc.request` / `rpc.response` / `rpc.error` | `method`, `code?`, `kind?`, `bytes` |
| `tool.start` / `tool.end` | `tool`, `paramsHash`, `ok`, `truncated` |
| `policy.deny` | `tool`, `reason`, `origin?`, `path?` |
| `jail.deny` | `path`, `root`, `resolved` |
| `redact.hit` | `location`, `pattern`, `count` |
| `loop.stop` | `kind`, `iterations`, `actionHash` |
| `sse.gap` / `sse.reconnect` | `lastId`, `attempt` |
| `shutdown.start` / `shutdown.done` | `reason`, `forced` |

### 14.2 Artifact naming và debug export

- Tên: `NNN-<tool>-<8hex>.<ext>`, `NNN` tăng trong session, `8hex` là hash của params đã redact.
- Screenshot: PNG/JPEG. Snapshot/console/network: JSON. Eval: JSON kèm `expressionHash`.
- `kilo-browser export --session <id>` tạo zip gồm `session.md`, artifacts (đã redact), `bridge.jsonl` lọc theo session, và `runtime.redacted.json` (không token).
- Export không bao giờ chứa token, password, cookie value.

### 14.3 Performance counters

`tool.p50Ms`, `tool.p95Ms`, `snapshot.nodes`, `screenshot.bytes`, `sse.lagMs`, `ws.rttMs`, `artifact.bytes`. Ghi mỗi 60 giây dưới event `metrics.snapshot` nếu `log.level=debug`.

---

[← Previous: Guard plugin và bảo mật](./07-security-jail.md) · [Next: Testing và acceptance criteria](./09-testing-acceptance.md)
