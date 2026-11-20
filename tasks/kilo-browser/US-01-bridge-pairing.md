# US-01: Bridge, preflight và pairing

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-00](./US-00-spike.md) · Sau: [US-02](./US-02-observe.md)

| Trường | Giá trị |
|---|---|
| ID | US-01 |
| Persona | Solo dev |
| Giá trị | Một lệnh `kilo-browser start` dựng workspace, sinh config MCP/plugin, spawn `kilo serve` và in lệnh `kilo attach`; extension pair được và bridge relay được turn |
| Spec | [§8.1](../../docs/specs/kilo-browser/02-bridge.md) · [§13.2](../../docs/specs/kilo-browser/08-config-observability.md) · [§7.3](../../docs/specs/kilo-browser/01-architecture.md) · [§8.3.9](../../docs/specs/kilo-browser/04-extension.md) |
| Phụ thuộc | US-00 |
| Mốc | M1 — [§19](../../docs/specs/kilo-browser/10-delivery.md) |
| Ước lượng | 4–5 ngày |
| AC | AC-01, AC-02, AC-03 |

**Câu chuyện:** Là solo dev, tôi muốn chạy một lệnh để bridge dựng workspace, sinh config và pair extension, để agent có một đường ống có token tới `kilo serve` mà tôi không phải cấu hình tay.

## Bối cảnh

Bridge là sidecar local: nó preflight workspace, spawn/supervise `kilo serve`, giữ HTTP API cho shim, WS server cho extension, policy/jail/redaction, artifact, JSONL và SSE relay ([§7.1](../../docs/specs/kilo-browser/01-architecture.md)). Toàn bộ code nằm trong `packages/kilo-browser/`, không sửa shared opencode (A12, [§15](../../docs/specs/kilo-browser/10-delivery.md)). Sequence pairing và một tool call nằm ở [§7.3](../../docs/specs/kilo-browser/01-architecture.md); startup sequence nằm ở [§8.1.3](../../docs/specs/kilo-browser/02-bridge.md).

Config phải tồn tại trước khi `kilo serve` khởi động để MCP server `browser` được nạp ngay turn đầu ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md) bước 4). Khối dưới đây là nguyên văn [§13.2](../../docs/specs/kilo-browser/08-config-observability.md); bridge thay `/abs/path/...` bằng đường dẫn tuyệt đối lúc generate.

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

Luồng session/prompt đi qua proxy của bridge, không để shim gọi thẳng `kilo serve` ([§8.1.7](../../docs/specs/kilo-browser/02-bridge.md)):

```text
POST /kilo/sessions     {title?, parentID?}                  -> SDK POST /session
POST /kilo/prompt_async {sessionID, parts, model?, agent?}   -> POST /session/:id/prompt_async (204)
POST /kilo/prompt       {sessionID, parts, model?, agent?}   -> POST /session/:id/message (blocking)
```

Extension chỉ nói chuyện với bridge qua WS loopback; nó không gọi `kilo serve`, không giữ Basic password ([§7.4](../../docs/specs/kilo-browser/01-architecture.md), [§8.1.7](../../docs/specs/kilo-browser/02-bridge.md)). SSE `session.turn.close` là tín hiệu kết thúc turn; `session.status` idle là fallback sau 2 giây ([§8.1.8](../../docs/specs/kilo-browser/02-bridge.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CLI flags, preflight, spawn/supervise, config generate, runtime.json, WS server, pairing, extension skeleton/storage/reconnect, SSE relay, proxy endpoints | Sáu tool đọc (US-02), năm tool tương tác (US-03), eval (US-04), jail (US-05), memory templates (US-06), E2E Playwright (M3) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] `--help` liệt kê đủ 12 flag ở [§8.1.1](../../docs/specs/kilo-browser/02-bridge.md) với đúng default: `--workspace`, `--host`, `--port`, `--kilo`, `--kilo-url`, `--kilo-password`, `--no-spawn`, `--pair-ttl`, `--idle-timeout`, `--log-level`, `--json`, `--foreground`.
- [ ] Preflight chạy đủ 10 mục [§8.1.2](../../docs/specs/kilo-browser/02-bridge.md), gồm workspace ghi được, `.kilo/kilo-browser/` tạo được (mode `0700`/ACL best effort), `kilo --version` trong 5 giây và đủ 100 MB; host không loopback bị từ chối; fail trả exit `2` và JSON `{ok:false, code:"PREFLIGHT_FAILED", checks:[...]}`.
- [ ] `git rev-parse --is-inside-work-tree` chỉ là kiểm tra tùy chọn: workspace không phải git vẫn start nhưng in cảnh báo `external_directory` yếu hơn ([§8.1.2](../../docs/specs/kilo-browser/02-bridge.md) mục 10).
- [ ] Sinh `bridgeToken` 32 byte hex, `pairSecret` 32 byte và `pairCode` 6 chữ số; `pairCode` TTL 120 giây, 5 lần sai lockout 60 giây ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Generate `.kilo/kilo.json` đúng khối [§13.2](../../docs/specs/kilo-browser/08-config-observability.md), thay `/abs/path/...` bằng absolute path; 13 permission key gồm `external_directory: "deny"`.
- [ ] Merge `.kilo/kilo.json` an toàn: chỉ thêm `mcp.browser`, entry `plugin`, entry `permission`, entry `instructions` còn thiếu; không xóa entry người dùng, không đổi thứ tự, không format lại toàn file ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] `.kilo/kilo-browser.json` đã tồn tại thì không ghi đè; chỉ in diff đề xuất ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Ghi `.kilo/kilo-browser/runtime.json` mode `0600` với `{httpUrl, wsUrl, token, kiloUrl, kiloAuth, pid, startedAt, protocolVersion, bridgeVersion}`; xóa file khi shutdown ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md) bước 7, [§8.1.9](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] WS `/ws` đúng [§8.1.5](../../docs/specs/kilo-browser/02-bridge.md): subprotocol `kilo-browser.v1`, origin `chrome-extension://<id>`, single client đóng `4001`, ping 10 giây/pong 30 giây, frame 8 MB, rate 20/40, close codes `4000/4001/4002/4003/4004/4009`.
- [ ] `hello` nhận `pairCode` hoặc `token`, không nhận token qua query string; token gắn `extensionId`; `pair --rotate` thu hồi và đóng WS hiện tại ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md), [§8.3.9](../../docs/specs/kilo-browser/04-extension.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] HTTP API đòi `Authorization: Bearer` trừ `GET /health`; `POST /tool` trả đúng request/response/error ở [§8.1.6](../../docs/specs/kilo-browser/02-bridge.md), giới hạn 8 MB.
- [ ] Proxy đủ endpoint [§8.1.7](../../docs/specs/kilo-browser/02-bridge.md): `/kilo/status`, `/kilo/abort`, `/kilo/permissions`, `/kilo/permissions/:requestID/reply`, `/kilo/sessions`, `/kilo/prompt`, `/kilo/prompt_async`; bridge giữ Basic credential.
- [ ] SSE relay mở `GET <kiloUrl>/global/event`, reconnect 250ms → 8s jitter ±20% tối đa 10 lần, ring 100 event, phát hiện gap, chỉ forward `permission.asked`, `permission.replied`, `session.turn.close`, `session.status`, `session.diff` ([§8.1.8](../../docs/specs/kilo-browser/02-bridge.md)).

### Implementation

- [ ] Spawn `kilo serve --port 0 --hostname 127.0.0.1` với env `KILO_SERVER_PASSWORD`, `KILO_SERVER_USERNAME=kilo`, `KILO_PARENT_PID`, `KILO_CLIENT=kilo-browser` (chưa xác nhận) và `windowsHide: true`; parse stdout tối đa 20 giây, fallback `GET /global/health` ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md) bước 5–6).
- [ ] Supervisor theo dõi `exit` + health poll 10 giây timeout 3 giây; restart tối đa 5 lần trong 60 giây với backoff 1s, 2s, 4s, 8s, 8s; sau đó `Degraded` và trả `KILO_UNAVAILABLE` ([§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Kill cây process đúng nền tảng: Windows `taskkill /PID <pid> /T /F`, POSIX kill process group; bridge thoát thì kill `kilo serve` và xóa `runtime.json` ([§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Extension MV3 dùng đúng manifest [§8.3.1](../../docs/specs/kilo-browser/04-extension.md): `debugger`, `storage`, `sidePanel`, `tabs`, `alarms`; host permission chỉ localhost; không `web_accessible_resources`, không remote script, không `eval`.
- [ ] `transport/ws.ts` gửi `hello`, lưu token, reconnect theo [§8.3.7](../../docs/specs/kilo-browser/04-extension.md): `chrome.alarms` 30 giây, backoff 250ms → 8s jitter ±20% tối đa 10 lần, trả `pong` trong 2 giây, `4004` thì xóa token.
- [ ] `storage/store.ts` dùng schema `schemaVersion:1` với `settings`, `pairing`, `allowlist`, `tab`, `ui`; không lưu password Kilo hoặc cookie ([§8.3.6](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Side panel skeleton (US-09 hoàn thiện UI) chạy đúng state machine [§8.3.8](../../docs/specs/kilo-browser/04-extension.md): `Disconnected`, `Pairing`, `Connected`, `NoTab`, `Attached`, `Busy`, `Approving`; pairing timeout 120 giây quay về `Disconnected`.
- [ ] Shutdown đủ 7 bước [§8.1.9](../../docs/specs/kilo-browser/02-bridge.md): ngừng nhận HTTP mới, close frame `1001`, hủy tool, flush JSONL, SIGTERM/SIGKILL `kilo serve`, xóa `runtime.json`, exit `0`; quá 10 giây thì exit `4`.
- [ ] Lệnh `kilo-browser pair --rotate` sinh token mới, đóng WS hiện tại và in hướng dẫn pair lại ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).

### Test

- [ ] Integration với real `kilo serve` + fake WS client chứng minh AC-01: `hello.ok` trong <= 2 giây, token được lưu ở phía client giả lập `chrome.storage.local`, panel state `Connected`.
- [ ] Test AC-02: client thứ hai gửi `hello` bị đóng `4001`, client đầu vẫn nhận `browser.status`.
- [ ] Test AC-03: `browser.status` trả `paired:true`, `tab.id`, `kilo.healthy:true` trong <= 2 giây qua bridge `/tool`.
- [ ] Test negative: 5 pair code sai → `4004` + `pair.lockout`; heartbeat quá 30 giây → `4003`; frame > 8 MB → `4009`; vượt rate limit → `-32005` kind `RATE_LIMIT` ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Test preflight: workspace không ghi được, schema sai, host không loopback đều exit `2`; lock đã tồn tại thì đọc `runtime.json`, kiểm tra `GET /health` và exit `0` (idempotent start) ([§8.1.2](../../docs/specs/kilo-browser/02-bridge.md) mục 3, [§8.1.3](../../docs/specs/kilo-browser/02-bridge.md) bước 2).
- [ ] Test migration-safe: file `.kilo/kilo.json` có sẵn `instructions`, `plugin`, `mcp` khác; sau generate, nội dung cũ giữ nguyên và chỉ key thiếu được thêm.
- [ ] Test SSE: nhận `session.turn.close` reason `completed`; nếu thiếu, `session.status` idle sau 2 giây đóng turn; không dùng `session.idle` ([§8.1.8](../../docs/specs/kilo-browser/02-bridge.md)).

### Tài liệu & vận hành

- [ ] Ghi JSONL đủ event [§14.1](../../docs/specs/kilo-browser/08-config-observability.md): `bridge.start`, `preflight.*`, `kilo.spawn/ready/exit`, `ws.open/close`, `pair.*`, `rpc.*`, `sse.gap/reconnect`.
- [ ] Không log token/password/`pairSecret`; nếu cần debug, chỉ log `sha256(token)[0..8]` ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] In pairing code và lệnh `kilo attach http://127.0.0.1:<port> --password <pw>`; không in password trong log ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md) bước 9).
- [ ] Ghi precedence CLI flag > env > project config > global config > default và dừng khi schema sai, không merge một phần ([§13.4](../../docs/specs/kilo-browser/08-config-observability.md)).

## Acceptance (Given/When/Then)

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | Bridge đang chạy, pairing code còn hạn | Extension gửi code đúng | `hello.ok` trong <= 2 giây, token lưu vào `chrome.storage.local`, panel hiện `Connected` |
| AC-02 | Đã có một extension kết nối | Client thứ hai gửi `hello` | WS thứ hai đóng code `4001`, client đầu vẫn hoạt động |
| AC-03 | Đã pair, có tab | Gọi `browser_status` | Trả `paired:true`, `tab.id`, `kilo.healthy:true` trong <= 2 giây |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test ./test/integration/bridge-pairing.test.ts
bun test ./test/integration/preflight.test.ts
bun test ./test/unit/config-generate.test.ts
bun test ./test/unit/protocol.test.ts
bun run build
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `package.json` | Package, bin `kilo-browser`/`kilo-browser-mcp`, scripts build/typecheck/test (handoff cho US-10 ở W5) |
| `tsconfig.json` | Cấu hình `@tsconfig/bun` |
| `src/index.ts` | Export API nội bộ của bridge |
| `src/cli.ts` | Parse flag [§8.1.1](../../docs/specs/kilo-browser/02-bridge.md), `start`, `pair --rotate` |
| `src/mcp.ts` | MCP shim stdio; đăng ký đủ 12 tên trần theo [§8.2.1](../../docs/specs/kilo-browser/03-protocol-mcp.md) |
| `src/bridge/server.ts` | HTTP server + WS upgrade cùng port |
| `src/bridge/http.ts` | `/health`, `/tool`, `/events`, proxy [§8.1.6–8.1.7](../../docs/specs/kilo-browser/02-bridge.md) |
| `src/bridge/ws.ts` | Handshake, `hello`, heartbeat, rate limit, close codes (handoff cho US-07) |
| `src/bridge/kilo.ts` | Spawn/supervise `kilo serve`, `windowsHide: true` |
| `src/bridge/sse.ts` | SSE relay + `session.turn.close` tracking |
| `src/bridge/lifecycle.ts` | Startup/shutdown, lock, `runtime.json` (handoff cho US-07) |
| `src/protocol/rpc.ts` | JSON-RPC framing một message mỗi frame + bảng mã lỗi [§10.4](../../docs/specs/kilo-browser/03-protocol-mcp.md) |
| `src/protocol/version.ts` | Thương lượng `major.minor` |
| `src/config/schema.ts` | Schema `.kilo/kilo-browser.json`; từ chối `*` trong allowlist (eval key handoff cho US-04) |
| `src/config/load.ts` | Precedence và merge an toàn |
| `src/config/generate.ts` | Generate `.kilo/kilo.json` [§13.2](../../docs/specs/kilo-browser/08-config-observability.md), diff-only |
| `extension/manifest.json` | Manifest MV3 [§8.3.1](../../docs/specs/kilo-browser/04-extension.md) (handoff cho US-09) |
| `extension/src/background/service-worker.ts` | Vòng đời SW, khôi phục state, khởi động WS |
| `extension/src/transport/ws.ts` | `hello`, reconnect stub, heartbeat (handoff cho US-07) |
| `extension/src/rpc/router.ts` | Dispatch JSON-RPC skeleton (handoff cho US-09) |
| `extension/src/storage/store.ts` | Schema storage v1, migration (handoff cho US-09) |
| `extension/src/sidepanel/index.ts` | Khung side panel (skeleton, handoff cho US-09) |
| `extension/src/sidepanel/pairing.ts` | Nhập code, pair, pair lại (skeleton, handoff cho US-09) |
| `extension/src/sidepanel/status.ts` | `Connected`/`Attached`/lỗi (skeleton, handoff cho US-09) |
| `test/integration/bridge-pairing.test.ts` | AC-01, AC-02, AC-03 |
| `test/integration/preflight.test.ts` | Preflight, lock, idempotent start |
| `test/unit/config-generate.test.ts` | Migration-safe, absolute path |
| `test/unit/protocol.test.ts` | Framing, version, close codes |

## Definition of Done

- [ ] `kilo-browser start --workspace .` dựng được workspace, sinh config [§13.2](../../docs/specs/kilo-browser/08-config-observability.md) và in lệnh attach mà không lộ secret.
- [ ] AC-01, AC-02, AC-03 xanh với real `kilo serve` + fake WS client.
- [ ] `.kilo/kilo.json` có sẵn của người dùng không bị mất key, đổi thứ tự hoặc format lại.
- [ ] `runtime.json` đúng mode/trường và biến mất sau shutdown; không còn `kilo serve` mồ côi.
- [ ] SSE phân biệt `session.turn.close` với fallback `session.status` và không dùng `session.idle`.
- [ ] Build CLI/shim chạy được; typecheck sạch; không có test bị skip không lý do.

## Ghi chú & rủi ro

- Spec 0.2.1 bỏ `kiloAuth` khỏi `runtime.json` ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md), [§8.1.7](../../docs/specs/kilo-browser/02-bridge.md)): Basic credential chỉ nằm trong memory/env của bridge; shim và extension không thấy.
- [§13.1](../../docs/specs/kilo-browser/08-config-observability.md) ví dụ `tools.navigate/click/type/press/reload` là `ask`, còn [§9](../../docs/specs/kilo-browser/05-tools-loop.md) nói mặc định `allow` và [§13.2](../../docs/specs/kilo-browser/08-config-observability.md) generate `allow`. US này generate theo §13.2; `.kilo/kilo-browser.json` mẫu không tự đổi default.
- `KILO_CLIENT=kilo-browser` được đánh dấu `(chưa xác nhận)` trong [§8.1.3](../../docs/specs/kilo-browser/02-bridge.md); phải kiểm tra lại với CLI trước khi dựa vào hành vi đó.
- `src/bridge/supervisor.ts` (health poll, restart budget, kill tree) handoff cho US-07 ở W3; US-01 chỉ cần spawn + parse stdout/health tối thiểu trong `src/bridge/kilo.ts`.
- Extension ID dev (unpacked) và production (store) khác nhau là OQ-3 ([§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)); v1 dùng pairing mode khi `allowedExtensionIds` rỗng.

---

[← Trước: US-00](./US-00-spike.md) · [Tiếp: US-02](./US-02-observe.md)
