# Đặc tả: Kilo Browser Agent

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §1–§2, §4–§6.

> Tài liệu thiết kế và đặc tả triển khai cho `packages/kilo-browser` và package UI dùng chung `packages/kilo-webview`. Đây là spec kỹ thuật, không phải hướng dẫn sử dụng. Triển khai 0.3.3 dùng **host seam** trong `kilo-vscode/webview-ui` thay vì tách vật lý `packages/kilo-webview` (US-11 vẫn partial); file/diff viewer đã giao (US-14) qua `/ui/file`, `/ui/diff`, `/ui/url-guard`; xem Changelog 0.3.3 và §22.12.

## Bản đồ tài liệu

| Phần | File | Mục đích |
|---|---|---|
| §1–§2, §4–§6 | [README.md](./README.md) | Thông tin tài liệu, tóm tắt, mục tiêu, thuật ngữ, giả định |
| §3, §7 | [01-architecture.md](./01-architecture.md) | Vấn đề/người dùng, kiến trúc, ADR |
| §8, §8.1 | [02-bridge.md](./02-bridge.md) | Bridge CLI, lifecycle, WS/HTTP, SSE |
| §8.2, §10 | [03-protocol-mcp.md](./03-protocol-mcp.md) | MCP shim, JSON-RPC, error codes |
| §8.3 | [04-extension.md](./04-extension.md) | MV3 extension, CDP, pairing, approval |
| §9, §11 | [05-tools-loop.md](./05-tools-loop.md) | 12 tool và debug loop |
| §8.5 | [06-workspace-memory.md](./06-workspace-memory.md) | Workspace, memory, session templates |
| §8.4, §12 | [07-security-jail.md](./07-security-jail.md) | Guard plugin, jail, bảo mật |
| §13, §14 | [08-config-observability.md](./08-config-observability.md) | Config, JSONL, artifacts |
| §17, §18 | [09-testing-acceptance.md](./09-testing-acceptance.md) | Testing, acceptance criteria |
| §15, §16, §19 | [10-delivery.md](./10-delivery.md) | Repo layout, commands, milestones |
| §20, §21 | [11-risks-open-questions.md](./11-risks-open-questions.md) | Risks, resolved questions, OQ-1..OQ-7 |
| §22 | [12-ui.md](./12-ui.md) | Tái dùng chat/settings UI Kilo, host adapter, build/CSP, parity tests |
| Phụ lục A–D | [99-appendix.md](./99-appendix.md) | Verified facts, errors, future work, events |

### Cách đọc

- `README.md` (§1–§6): mục tiêu, success metrics, thuật ngữ, giả định.
- `01-architecture.md` → `02-bridge.md` → `03-protocol-mcp.md` → `04-extension.md` → `12-ui.md`: luồng end-to-end và UI reuse.
- `05-tools-loop.md` → `06-workspace-memory.md` → `07-security-jail.md` → `08-config-observability.md` → `09-testing-acceptance.md` → `10-delivery.md` → `11-risks-open-questions.md` → `99-appendix.md`: triển khai và review.

### Trạng thái & câu hỏi mở

Trạng thái: draft, phiên bản 0.3.3. Câu hỏi mở và bảng đã giải quyết: [§21](./11-risks-open-questions.md). Rủi ro: [§20](./11-risks-open-questions.md).

## 1. Thông tin tài liệu

| Trường | Giá trị |
|---|---|
| Trạng thái | draft |
| Phiên bản | 0.3.3 |
| Ngày | 2026-11-20 |
| Package | `packages/kilo-browser` (`@kilocode/kilo-browser`) |
| Owner | `<owner placeholder>` |
| Decision summary | Xây một bridge chạy local làm sidecar của `kilo serve`, một MCP shim stdio, một Chrome MV3 extension điều khiển trình duyệt qua CDP và tái dùng chat/settings UI qua `kilo-webview`, và một guard plugin phía Kilo. Agent không nằm trong extension; extension không giữ credential của Kilo; mọi quyền ghi/đọc file đi qua jail của bridge. Triển khai 0.3.3: tái dùng UI bằng **host seam** trong `kilo-vscode/webview-ui` (chưa tách `packages/kilo-webview`) — deviation (a); file/diff viewer đã giao (US-14) — xem Changelog 0.3.3. |

Changelog: 0.3.3 (2026-11-20) — review pass trên các thay đổi chưa commit; đóng 4 mục CRITICAL cùng các WARNING/SUGGESTION.
- **security**: `/health` không còn trả `tab`/`kilo.url`; policy origin của extension phản chiếu policy dùng chung và fail-closed khi allowlist rỗng; UI chuyển token WS từ query sang `Sec-WebSocket-Protocol` (`token.<hex>`); CLI không in mật khẩu Kilo; redaction của extension phản chiếu pattern dùng chung; §12.4 CSP khớp manifest.
- **reliability**: restart `kilo serve` có giám sát retarget client và restart SSE; cache idempotency của router reset khi reconnect; close `4001` retryable; broadcast SSE chỉ ở tool channel; mã lỗi MCP suy ra từ `RPC_ERRORS`.
- **packaging**: `build:extension` chain `build:ui` và validate `dist/ui-dist/*.html`; tên artifact một nguồn; xoá `.kilo-browser-files.txt`.
- **performance**: logger tạo dir một lần và cache kích thước; ring buffer dùng ước lượng kích thước rẻ.
- **dead code**: xoá capability flag chết và nhánh `hostUnsupported` không tới được.
Changelog: 0.3.2 (2026-11-20) — giao file/diff viewer cho extension UI: bridge phục vụ `GET /ui/file` (đọc file trong jail, redact, cap 256 KiB), `GET /ui/diff` (từ `session.diff` hoặc fallback `GET /session/:id/message`), và `GET /ui/url-guard` (chỉ http/https); extension thêm trang `file.html`/`diff.html` (read-only, dùng `kilo-ui` `File`/`Diff`) và alias `@kilo-webview-file`/`@kilo-webview-diff`; browser host adapter mở hai trang cho `openFile`/`openDiffVirtual`. US-14 implemented (AC-22/23/25/26) trừ các hành động còn `HOST_UNSUPPORTED` (login/logout, cloud, Agent Manager, marketplace, migration, worktree, terminal, PR, autocomplete, experimental runtime, export/revert/delete message, provider usage) và các message UI chưa hỗ trợ đi qua bridge `UiHost`; US-11 vẫn partial (chưa tách vật lý `packages/kilo-webview`, deviation (a)).
Changelog: 0.3.1 (2026-11-20) — đồng bộ spec với triển khai thực tế: US-11 giao bằng **host seam trong `kilo-vscode/webview-ui`** (`host/HostBridge.ts`, `HostProvider`, `useHost`, alias `useVSCode`) thay vì tách vật lý `packages/kilo-webview`; extension resolve UI qua alias `@kilo-webview`. Deviation đã ghi nhận: (a) chưa tách package `packages/kilo-webview`; (b) `openFile`/`openDiffVirtual`/`openWebLink`/`openExternal` trả `HOST_UNSUPPORTED`; (c) clipboard write phía page; (d) nhiều message UI trả `HOST_UNSUPPORTED` (login/logout, cloud, Agent Manager, marketplace, migration, worktree, terminal, PR, autocomplete, experimental runtime, export/revert/delete message, provider usage); (e) `session.diff` bị bỏ vì union UI thiếu message tương ứng.
Changelog: 0.3.0 (2026-11-19) — tái dùng UI Kilo qua package dùng chung `kilo-webview` + browser host adapter; v1 gồm chat + settings lõi.

Changelog: 0.2.2 (2026-11-19) — đồng bộ thời lượng milestone với ước lượng US.

Changelog: 0.2.1 (2026-11-19) — chuẩn hóa error taxonomy, bỏ `kiloAuth` khỏi `runtime.json`, đồng bộ permission/redaction/package layout, cập nhật milestone gates và pairing TTL.

Changelog: 0.2.0 (2026-11-19) — tách thành nhiều file; không thay đổi nội dung.

Changelog: 0.1.2 (2026-11-19) — inject memory qua `instructions`; đặt permission mặc định của tool browser thành `allow` (trừ `browser_eval`), `external_directory` = `deny`.

Changelog: 0.1.1 (2026-11-19) — sửa quy tắc đặt tên MCP: shim đăng ký tên trần, Kilo thêm tiền tố server; permission key là tên đã namespace.

Quy ước: `MUST` là bắt buộc cho v1, `SHOULD` là mong muốn có thể trì hoãn, `MAY` là tùy chọn. Mọi dữ kiện chưa kiểm chứng được đánh dấu `(chưa xác nhận)` và phải xuất hiện trong [mục 21](./11-risks-open-questions.md).

## 2. Tóm tắt điều hành

Kilo hiện có agent mạnh nhưng bị mù trước ứng dụng web mà người dùng đang phát triển: agent đọc được source nhưng không thấy DOM, console, network hay trạng thái thật của trang. Kilo Browser Agent bổ sung một vòng lặp debug có bằng chứng: agent gọi các tool `browser_*`, bridge chuyển lệnh qua WebSocket tới một Chrome extension đang giữ phiên CDP trên đúng tab của người dùng, và trả về snapshot, screenshot, log, network, cùng khả năng click/type có kiểm soát. Mọi thứ chạy trên loopback, có token, có jail đường dẫn, có redaction, và có ngân sách vòng lặp để tránh agent sửa mù. UI chat và settings tái dùng nguyên bộ component của Kilo qua `kilo-webview`; extension chỉ cung cấp host adapter, không tự dựng panel tối giản.

- Một lệnh `kilo-browser start` dựng workspace, spawn `kilo serve`, sinh config MCP + plugin, và in lệnh `kilo attach` đã xác thực.
- Mười hai tool `browser_*` ổn định qua MCP, có timeout, cap và ít nhất ba failure mode được đặc tả.
- Một extension MV3 tái dùng chat/settings UI của Kilo qua `kilo-webview`, cộng host adapter; service worker giữ CDP trên một tab được chọn.
- Một guard plugin phía Kilo: ép `browser_eval` qua `ask`, chặn origin/path nguy hiểm, redaction defense-in-depth.
- Một workspace chuẩn `.kilo/kilo-browser/` với `AGENTS.md`, `MEMORY.md`, `sessions/<id>.md`, artifacts có retention.

## 4. Mục tiêu, success metrics, non-goals

### 4.1 Mục tiêu

- G1: Agent quan sát được DOM, console, network, screenshot của tab đang mở mà không cần người dùng copy dữ liệu.
- G2: Agent thực hiện được chuỗi debug "quan sát → giả thuyết → sửa file → reload → xác minh" trong tối đa 12 iteration mỗi turn.
- G3: Mọi side effect trong trình duyệt và mọi đường dẫn file đều đi qua policy và jail có thể kiểm thử.
- G4: Không có secret nào từ trang hoặc từ bridge đi vào transcript/log/artifact mà chưa qua redaction.
- G5: Cài đặt và chạy được trên Windows, macOS, Linux với Chrome/Edge Chromium 116+.
- G6: Chat và Settings trong extension dùng chung component/i18n/hành vi với VS Code qua `kilo-webview`, không fork UI.

### 4.2 Success metrics

| Metric | Ngưỡng v1 | Cách đo |
|---|---|---|
| Số lần người dùng phải can thiệp trong một bug thật | <= 1 | Đếm prompt thủ công ngoài prompt ban đầu trong session E2E |
| Thời gian từ prompt đến bằng chứng "đã sửa" | < 5 phút | `session.turn.close` trừ thời điểm prompt |
| Tỉ lệ bug thật sửa đúng trong demo có kiểm soát | >= 1 bug thật | Checklist thủ công trên fixture có lỗi đã biết |
| Tool call lỗi do protocol (không phải do trang) | < 2% | `rpc.error` / `rpc.request` trong log |
| Rò secret trong artifact | 0 | Test redaction + quét mẫu artifact |
| Pairing thành công lần đầu | >= 95% | `ws.open` sau `pair.start` |

### 4.3 Non-goals

| Non-goal | Lý do |
|---|---|
| Agent/LLM chạy trong extension | MV3 không phù hợp, không có Node, không có chỗ chứa key an toàn |
| Điều khiển nhiều tab đồng thời trong v1 | Tăng mạnh độ phức tạp ref/network; để [Phụ lục C](./99-appendix.md) |
| Chạy headless trên CI không có Chrome | v1 là browser thật của người dùng; headless là future work |
| Thay thế `chrome-devtools-mcp` | Khác mục tiêu: tích hợp Kilo permission/jail, không phải bộ tool DevTools đầy đủ |
| Đọc/ghi file ngoài workspace | Jail là bắt buộc; muốn mở rộng phải khai báo `extraRoots` |
| Đồng bộ memory lên cloud | Không có backend, không cần cho v1 |
| Hỗ trợ Firefox/Safari | CDP-only; WebExtension cross-browser là future work |
| Agent Manager, marketplace, terminal/worktree/PR, migration, speech-to-text | Surface chỉ có nghĩa trong VS Code host; ẩn bằng capability flag, không dựng lại trong v1 |
| Tự commit git sau khi sửa | Ngoài scope; người dùng quyết định |

## 5. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| bridge | Tiến trình local `kilo-browser` giữ HTTP/WS, spawn `kilo serve`, làm trung gian giữa MCP shim và extension |
| shim | `kilo-browser-mcp`, MCP server stdio mà Kilo spawn; chuyển tool call thành HTTP tới bridge |
| workspace | Thư mục dự án được chọn; là gốc của jail và của `.kilo/kilo-browser/` |
| session | Một Kilo session (`ses_...`) tương ứng một cuộc hội thoại; không đồng nghĩa với tab |
| turn | Một lượt agent chạy từ prompt đến `session.turn.close` |
| artifact | File bằng chứng do bridge ghi: screenshot, snapshot, console, network, diff |
| ref | Định danh ngắn `e1`, `e2` trỏ tới một DOM node tại một snapshot; hết hạn khi snapshot mới |
| jail | Tập root đường dẫn được phép ghi/đọc bởi bridge và guard |
| pairing | Quá trình extension chứng minh với bridge rằng nó là client hợp lệ |
| policy | Tập quy tắc allow/ask/deny cho từng tool và từng origin |
| `kilo-webview` | Package UI dùng chung: components, contexts, hooks, i18n, styles, message types, `HostBridge` |
| HostBridge | Interface host adapter mà UI dùng để post/subscribe state, clipboard, file/url actions |
| HostCapabilities | Bản đồ capability bật/tắt surface; bridge trả về, UI ẩn surface không hỗ trợ |

## 6. Giả định và điều kiện tiên quyết

1. A1: Người dùng có Chrome hoặc Edge Chromium >= 116; extension dùng MV3 và `chrome.debugger`.
2. A2: `kilo` binary có trên `PATH` và hỗ trợ `kilo serve`, `kilo attach`, `kilo run --attach` (đã kiểm chứng trong repo).
3. A3: Bun >= 1.2 là runtime phát triển; bản phát hành bridge chạy bằng Bun hoặc Node >= 20.11 (chưa chốt bundling, xem OQ-5).
4. A4: MCP local stdio của Kilo spawn được shim với `environment` tĩnh từ `.kilo/kilo.json`.
5. A5: Plugin local path trong `plugin` config được nạp trước khi tool chạy; hook `tool.execute.before` chạy trước permission check của tool.
6. A6: `kilo serve` in ra `kilo server listening on http://<host>:<port>` để bridge parse; nếu parse thất bại, bridge fallback sang `GET /global/health`.
7. A7: Mọi thứ chạy trên cùng máy và cùng user OS; không có multi-user, không có remote bridge.
8. A8: Trình duyệt của người dùng có thể đang mở DevTools; khi đó `chrome.debugger.attach` thất bại và phải có thông báo hành động được.
9. A9: Không có OS-level read jail trên Windows; jail của bridge là kiểm soát logic, không phải sandbox.
10. A10: Agent có thể gọi tool ngoài `browser_*` (bash, read, edit); guard chỉ giảm thiểu, không thay thế policy của Kilo.
11. A11: Thư mục `.kilo/` được phép ghi trong workspace; nếu không, bridge dừng ở preflight.
12. A12: Không sửa file shared của opencode; toàn bộ code mới nằm trong các package `kilo-*` (`packages/kilo-browser/`, `packages/kilo-webview/`).
13. A13: Refactor `kilo-vscode/webview-ui` để extract `kilo-webview` là được phép, với điều kiện build/unit/visual regression của `kilo-vscode` không đổi.
14. A14: MV3 CSP cho phép `wasm-unsafe-eval`, `worker-src 'self'` và `connect-src` tới bridge loopback.

Điều kiện tiên quyết để triển khai: chốt protocol version 1.0 ([mục 10](./03-protocol-mcp.md)), chốt tên MCP server `browser` ([mục 8.2](./03-protocol-mcp.md)), và có fixture app để test ([mục 17](./09-testing-acceptance.md)).