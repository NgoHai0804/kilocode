# Testing và acceptance criteria

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §17 và §18.

## 17. Testing strategy

Không dùng mock cho phần lớn test; chỉ dùng fake WS client và fixture app thật. Test phải chạy được trên Windows, macOS, Linux.

### 17.1 Unit test matrix

| Vùng | Case bắt buộc |
|---|---|
| Jail | `..` thoát root; absolute ngoài root; Windows `C:\` vs `c:\`; drive-relative `C:foo`; UNC `\\srv\share`; symlink ra ngoài; symlink loop; path chưa tồn tại (realpath parent); macOS case-insensitive |
| Redaction | header nhạy cảm; Bearer/JWT/`sk-`/`ghp_`/`AKIA`; query param; JSON field; cookie chỉ giữ tên; false positive không phá text |
| Codec | request/response giữ `id`; notification không `id`; frame > 8 MB bị từ chối; JSON lỗi → `-32700` |
| Buffers | ring ghi đè đúng; `dropped` tăng; body truncate; `sinceSeq` lọc đúng |
| Refs | ref ổn định trong một snapshot; stale sau snapshot mới; node biến mất; iframe cross-origin bị skip |
| Version | cùng major chấp nhận; minor cao hơn từ chối `4002`; thiếu `protocolVersion` → `-32602` |
| Config | default merge; schema reject `*`; precedence flag > env > project > global |
| Origin | `chrome-extension://` đúng ID; ID khác bị từ chối; `file://`/`chrome://` bị deny |
| UI host | `HostBridge` capability map; Port envelope giữ `id`; event ordering; backpressure coalesce |
| UI build | `base:"./"` asset paths; worker URL; CSP không có inline script |

### 17.2 Integration scenarios

| Kịch bản | Cách dựng | Kỳ vọng |
|---|---|---|
| Real server | Spawn `kilo serve --port 0` trong tmp git workspace, password ngẫu nhiên | Health ok, SSE nhận `server.connected`, `session.turn.close` khi turn xong |
| Fake extension | WS client Node gửi `hello`, trả result giả | Bridge forward đúng method/params, idempotency cache hoạt động |
| Policy deny | Gọi `browser.navigate` tới `https://evil.example` | `-32006 POLICY_DENIED`, không có frame tới extension |
| Jail | Gọi screenshot với artifact path `../../x.png` | `jail.deny`, không ghi file |
| Redaction | Fake response chứa `Authorization: Bearer abc` | Kết quả trả model có `[REDACTED]`, log không có token |
| Restart | Kill `kilo serve`, bridge restart | `kilo.exit` → `kilo.ready`, tool call sau thành công, budget restart đúng |
| UI host RPC | Fake UI Port gửi `ui.session.prompt`, `ui.config.write` | Bridge map đúng route/config, trả `ui.error.code` khi unsupported |

### 17.3 Extension E2E

- Playwright `chromium.launchPersistentContext(tmpdir, {headless:false, args:["--load-extension=extension/dist","--disable-extensions-except=extension/dist"]})`.
- Fixture app `test/fixture/app` chạy bằng `Bun.serve` ở port ngẫu nhiên, có các trang: form login, nút Save có bug cố ý, API trả 500 lần đầu, console error.
- Test pair bằng code in ra từ bridge, attach tab, chạy chuỗi 12 tool, kiểm tra artifact và screenshot.
- Đóng DevTools (mở `devtools://` page) để test `DEVTOOLS_CONFLICT`.
- UI: mở `sidepanel.html` và `settings.html`, stream một prompt, lưu model/provider, mở `PermissionDock`; kiểm tra 0 CSP violation và Shiki worker load.

### 17.4 Jail E2E

Trên Windows: tạo ổ đĩa tạm/UNC nếu có; test `..`, symlink junction, path case; trên macOS/Linux: symlink và bind mount nếu CI cho phép. Test phải skip có lý do rõ nếu môi trường không hỗ trợ, không silent pass.

### 17.5 Manual model-loop checklist

1. App fixture có bug thật; prompt chỉ mô tả triệu chứng.
2. Agent không hỏi quá 1 lần; không sửa file trước khi có console/network.
3. Sau khi sửa, agent reload và chụp bằng chứng.
4. Kết luận nêu artifact path và không nói "đã sửa" khi chưa verify.
5. `MEMORY.md` có ít nhất một bài học mới, không có secret.
6. Log không có token/password/cookie.

Lệnh: `bun test`, `bun run typecheck`, `bun run build`, `bun run build:extension`, `bun test test/e2e`, `bun run test:ui`, `bun run test:visual` — chạy từ `packages/kilo-browser/` hoặc `packages/kilo-vscode/` theo gate, không từ root.

## 18. Acceptance criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | Bridge đang chạy, pairing code còn hạn | Extension gửi code đúng | `hello.ok` trong <= 2 giây, token lưu vào `chrome.storage.local`, panel hiện `Connected` |
| AC-02 | Đã có một extension kết nối | Client thứ hai gửi `hello` | WS thứ hai đóng code `4001`, client đầu vẫn hoạt động |
| AC-03 | Đã pair, có tab | Gọi `browser_status` | Trả `paired:true`, `tab.id`, `kilo.healthy:true` trong <= 2 giây |
| AC-04 | Tab ở `about:blank` | Gọi `browser_navigate` tới fixture `/login` | Trả `status:200`, `title:"Login"`, URL khớp |
| AC-05 | Trang `/login` đã load | Gọi `browser_snapshot` | Trả `snapshotId`, >= 3 refs, text chứa `button "Save"`, không có HTML thô |
| AC-06 | Trang `/login` | Gọi `browser_screenshot` | Tạo artifact PNG <= 2 MB, trả `artifactId`, file tồn tại và mở được |
| AC-07 | Fixture phát console error | Gọi `browser_console {level:"error"}` | Trả entry có `seq`, `text` chứa lỗi, `dropped` là số |
| AC-08 | Fixture trả 500 cho `/api/save` | Gọi `browser_network {filter:"/api/save"}` | Trả request `status:500`, `durationMs` là số, body đã redact |
| AC-09 | Có ref `e7` từ snapshot | Gọi lần lượt `browser_click`, `browser_type`, `browser_press`, `browser_reload`, `browser_wait_for` | Mỗi call trả result đúng schema; chuỗi hoàn tất trong <= 30 giây |
| AC-10 | `tools.eval` là `deny` | Gọi `browser_eval` | Trả `-32006 kind:POLICY_DENIED`, không có CDP eval nào chạy |
| AC-11 | `tools.eval` là `ask`, người dùng duyệt | Gọi `browser_eval {expression:"document.title"}` | Trả `value:"Login"`, có bản ghi approval trong log |
| AC-12 | Snapshot cũ, sau đó có snapshot mới | Dùng ref cũ cho `browser_click` | Trả `-32004 STALE_REF`, không click |
| AC-13 | Đường dẫn `../../etc/passwd` (hoặc `C:\Windows`) | Gọi tool ghi artifact với path đó | `jail.deny`, không file nào được ghi ngoài workspace |
| AC-14 | Symlink trong workspace trỏ ra ngoài | Ghi artifact qua symlink | Bị deny sau realpath; log có `resolved` |
| AC-15 | Extension mất WS | Bridge chờ 30 giây rồi extension reconnect | Tool call sau reconnect thành công; `ws.open` mới trong log |
| AC-16 | DevTools đang mở trên tab | Gọi `browser_navigate` | Trả `-32006 kind:DEVTOOLS_CONFLICT`, UI hiện hướng dẫn đóng DevTools |
| AC-17 | Console/network chứa `Bearer abc123` và cookie | Gọi tool tương ứng | Kết quả và artifact chỉ có `[REDACTED]`, log không chứa `abc123` |
| AC-18 | `MEMORY.md` có nội dung | Bắt đầu session mới trong cùng workspace | Agent nhận memory trong ngữ cảnh; `sessions/<id>.md` được tạo sau turn |
| AC-19 | Hai workspace khác nhau, hai tab khác nhau | Chạy hai bridge/session | Không có artifact, memory hoặc log nào lẫn giữa hai workspace |
| AC-20 | Repo sạch | Chạy `bun run typecheck`, `bun test`, `bun run build`, `bun run build:extension`, `bun run build:ui` | Tất cả exit 0; không có test bị skip không lý do |
| AC-21 | Origin nằm trong allowlist, session đã cấu hình | Agent chạy `browser_navigate` + 3 interaction + `browser_reload` | Không có `permission.asked` nào cho chuỗi này, `session.turn.close` reason `completed`; `browser_eval` vẫn `deny` hoặc cần approval |
| AC-22 | Extension UI mở `sidepanel.html`, bridge paired | Gửi prompt và nhận `message.part.delta` | `MessageList`/`PromptInput` là component shared; text stream tăng dần, không reload trang; không có lỗi render |
| AC-23 | Settings mở tab models/providers | Đổi model/provider và Save | Bridge ghi config thật; mở lại Settings thấy giá trị đã lưu; không ghi secret vào log |
| AC-24 | `browser_eval` policy `ask`, `PermissionDock` hiện | Bấm Allow once | UI post `permissionResponse`; bridge gọi `POST /permission/:requestID/reply`; eval chạy và có log approval |
| AC-25 | Có >= 2 session và history local | Đóng/mở lại extension | Session tabs và history còn nguyên từ `chrome.storage.local`; không mất thứ tự |
| AC-26 | Capability `agentManager=false`, `marketplace=false` | Mở Chat và Settings | Không render Agent Manager/marketplace/terminal/worktree/PR; không có nút chết; `ui.capability.hide` có log |
| AC-27 | Theme `kilo`, dark/light/system | Mở chat có code block Shiki | Font/icon/theme đúng; Shiki worker load; 0 CSP violation; không request CDN |
| AC-28 | `kilo-vscode` baseline trước extraction | Chạy `bun run test:visual` + `bun run test:unit` sau extraction | Snapshot và unit test không đổi; `useVSCode` trong shared = 0, `useHost` thay thế đủ |

---

[← Previous: Config và observability](./08-config-observability.md) · [Next: Repo layout, commands, milestones](./10-delivery.md)
