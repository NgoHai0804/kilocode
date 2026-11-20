# Risks và open questions

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §20 và §21.

## 20. Risks

| Risk | Likelihood | Impact | Mitigation | Early-warning signal |
|---|---|---|---|---|
| MV3 SW bị suspend làm rơi WS | Cao | Trung bình | `chrome.alarms` + reconnect + state trong storage | `ws.close` lặp lại > 3 lần/10 phút |
| DevTools chiếm debugger | Cao | Trung bình | Phát hiện sớm, thông báo đóng DevTools, không auto-retry mù | `DEVTOOLS_CONFLICT` > 2% tool call |
| Chrome Web Store review chậm/từ chối | Trung bình | Cao | v1 sideload; store là future work | Review > 2 tuần |
| Prompt injection từ nội dung trang | Trung bình | Cao | Đánh dấu untrusted, eval deny, approval, origin allowlist | Model gọi type/click ngoài mục tiêu |
| Jail Windows bị lách bởi junction/UNC | Trung bình | Cao | realpath + test matrix + fail closed | `jail.deny` thấp bất thường kèm ghi file lạ |
| Bridge chết để lại `kilo serve` mồ côi | Trung bình | Trung bình | Parent watchdog, kill tree, lock file | `kilo serve` sống sau khi bridge exit |
| Redaction bỏ sót secret | Trung bình | Cao | Nhiều lớp, test mẫu, cho phép tắt tool nhạy cảm | Audit artifact thủ công phát hiện token |
| Model lạm dụng `eval` | Thấp (mặc định deny) | Cao | Deny mặc định, ask từng call, isolated world | Tỉ lệ approval eval cao |
| Port/loopback bị process khác chiếm | Thấp | Trung bình | Port 0, health check, token | `EADDRINUSE`, 401 hàng loạt |
| Extraction `kilo-webview` làm hỏng UI VS Code | Trung bình | Cao | Codemod + visual regression + unit test; merge extraction riêng | Snapshot diff > 0 |
| Message contract drift giữa shared UI và bridge | Trung bình | Cao | Shared types, compile gate, `uiVersion` | Typecheck fail ở extension |
| Bundle/CSP/Shiki worker fail trong MV3 | Trung bình | Cao | CSP smoke, worker asset check, budget CI | CSP violation, bundle vượt 4.5 MB |
| Thiếu parity surface (settings tab, history) | Cao | Trung bình | Capability flags; ẩn thay vì fake | Nút chết trong E2E |
| Version skew bridge/extension UI | Thấp | Trung bình | `protocolVersion` + `uiVersion` trong `hello` | Mismatch khi pair |

## 21. Open questions

Đã giải quyết và loại khỏi danh sách:

| # cũ | Câu hỏi | Kết luận |
|---|---|---|
| 1 | Route/SDK method trả lời permission | `POST /permission/:requestID/reply`, body `{reply, message?, interactive?}`; SDK `client.permission.reply(...)` ([Phụ lục A](./99-appendix.md)) |
| 2 | Signature `tool.execute.before/after` | `before(input{tool,sessionID,callID}, output{args})`; `after(input{tool,sessionID,callID,args}, output{title,output,metadata})` ([Phụ lục A](./99-appendix.md)) |
| 3 | Permission key cho MCP tool | Key là tên MCP đã namespace (`browser_eval`); `ctx.ask` gọi với chính key đó; config `permission` là record mở nên nhận key tùy biến (`packages/opencode/src/session/tools.ts:502`, `packages/core/src/v1/config/permission.ts:9-44`) |
| 4 | Memory injection | `.kilo/kilo-browser/AGENTS.md` được inject qua `config.instructions`; Kilo không auto-discover file lồng (`packages/opencode/src/session/instruction.ts:74-78,165-180`) |

Câu hỏi còn mở (đánh số lại):

1. OQ-1: `browser_eval` có nên ship trong v1 hay chỉ cho internal debug? Đề xuất: ship nhưng `deny` mặc định và không quảng bá.
2. OQ-2: Có cần multi-tab trong v1 không? Đề xuất: không; chỉ một tab, đổi tab phải detach/attach.
3. OQ-3: Extension ID cố định cho dev (unpacked) và production (store) khác nhau; bridge lưu một ID hay allowlist nhiều ID?
4. OQ-4: Có publish Chrome Web Store ngay M5 hay sideload beta? Ảnh hưởng thời gian review và quyền `debugger`.
5. OQ-5: Bundle bridge bằng Bun compile hay Node SEA? Ảnh hưởng kích thước, `windowsHide`, và khả năng chạy khi máy không có Bun.
6. OQ-6: Có cần hỗ trợ Edge/Firefox trong v1? CDP chạy trên Edge; Firefox cần WebDriver BiDi, ngoài scope.
7. OQ-7: Extraction `kilo-webview` có nên land trước browser host adapter không? Đề xuất: extract + codemod trước, host adapter sau M1; nếu chưa xong thì extension dùng wrapper nội bộ, không fork UI. **Giải quyết (0.3.1):** extraction vật lý deferred; US-11 giao bằng host seam trong `kilo-vscode/webview-ui` (`src/host/HostBridge.ts`, `HostProvider`/`useHost`, `useVSCode` alias, `host/capabilities.ts`), extension resolve qua alias `@kilo-webview`. Xem deviation (a) tại [§22.12](./12-ui.md).

## Trạng thái triển khai

Đối chiếu triển khai 0.3.3 (chi tiết [§22.12](./12-ui.md), [plan §13](../../../tasks/kilo-browser/plan.md)). Review pass 0.3.3 đã đóng toàn bộ 4 mục CRITICAL cùng các WARNING/SUGGESTION; hàng "Review pass" ghi nhận các sửa đổi.

| Hạng mục | Trạng thái | Deviation |
|---|---|---|
| Review pass 0.3.3 (4 CRITICAL + WARNING/SUGGESTION) | resolved | — |
| Bridge (preflight, supervisor, HTTP, tool WS, UI WS, pairing claim, SSE relay, host RPC, approval gate) | implemented | — |
| 12 tool `browser_*` (MV3 + CDP), jail/origin/redact, guard plugin | implemented | — |
| memory/templates, JSONL log, artifact store, MCP shim, CLI | implemented | — |
| UI dùng chung qua host seam trong `kilo-vscode/webview-ui` | implemented | (a) |
| Tách vật lý `packages/kilo-webview` | deferred | (a) |
| File/diff viewer (`/ui/file`, `/ui/diff`, `/ui/url-guard`; trang `file.html`/`diff.html` dùng `kilo-ui` `File`/`Diff`) | implemented | — |
| `openFile`/`openDiffVirtual`/`openWebLink`/`openExternal` qua browser host adapter | implemented (mở tab `file.html`/`diff.html`; link chỉ http/https) | — |
| `openFile`/`openDiffVirtual`/`openWebLink`/`openExternal` nếu message tới bridge `UiHost` | partial → `HOST_UNSUPPORTED` | (b) |
| Clipboard write | partial (page-side) | (c) |
| Message UI không hỗ trợ (login/logout, cloud, Agent Manager, marketplace, migration, worktree, terminal, PR, autocomplete, experimental runtime, export/revert/delete message, provider usage) | partial → `HOST_UNSUPPORTED` | (d) |
| `session.diff` | partial (bridge cache cho `/ui/diff`; chưa emit vào union UI) | (e) |

---

[← Previous: Repo layout, commands, milestones](./10-delivery.md) · [Next: UI reuse](./12-ui.md)
