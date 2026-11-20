# Phụ lục A–D

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa Phụ lục A–D.

## Phụ lục A: Dữ kiện repo đã kiểm chứng

Tính đến 2026-11-19, đọc trực tiếp từ worktree hiện tại.

| Dữ kiện | File và dòng |
|---|---|
| `kilo serve` command và in `kilo server listening on <url>` | `packages/opencode/src/cli/cmd/serve.ts:6-24` |
| Flags mạng (`--port`, `--hostname`, `--mdns`, `--cors`) | `packages/opencode/src/cli/network.ts` (resolve network options) |
| Port mặc định thử 4096 rồi port tự do | `packages/opencode/src/server/server.ts:133-134` |
| Basic auth, `KILO_SERVER_PASSWORD`, username mặc định `kilo`, thử thách `WWW-Authenticate: Basic realm="Secure Area"` | `packages/opencode/src/server/auth.ts:18-41` |
| CORS allowlist; không có `chrome-extension://` | `packages/server/src/cors.ts:12-22` |
| **Permission reply route** `POST /permission/:requestID/reply`, body `{reply, message?, interactive?}` | `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts:45-57`; handler `handlers/permission.ts:23-46` |
| `ReplyBody` gồm `reply: "once"\|"always"\|"reject"`, `message?`, `interactive?` | `packages/schema/src/v1/permission.ts:38-49` |
| SDK method `client.permission.reply({requestID, directory?, workspace?, reply, message?, interactive?})` | `packages/sdk/js/src/v2/gen/sdk.gen.ts:4012-4048` |
| Always-rules route `POST /permission/:requestID/always-rules` | `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts:59-71` |
| Route cũ (deprecated) `POST /session/:sessionID/permissions/:permissionID`, body `{response}` | `.../groups/session.ts:427-440`; `.../handlers/session.ts:426-445` |
| **Hook** `tool.execute.before(input{tool,sessionID,callID}, output{args})` | `packages/plugin/src/index.ts:268-271` |
| **Hook** `tool.execute.after(input{tool,sessionID,callID,args}, output{title,output,metadata})` | `packages/plugin/src/index.ts:276-283` |
| Hook `permission.ask(input: Permission, output{status})` | `packages/plugin/src/index.ts:263` |
| Hook `tool.definition(input{toolID}, output{description,parameters})` | `packages/plugin/src/index.ts:336` |
| Event `permission.asked` / `permission.replied` | `packages/schema/src/v1/permission.ts:66-70` |
| Event `message.part.delta`, `session.diff` | `packages/schema/src/v1/session.ts:680-691` |
| Event `session.status`, `session.idle` (deprecated) | `packages/schema/src/session-status-event.ts:51-60` |
| Event `session.turn.close` | `packages/sdk/js/src/v2/gen/types.gen.ts:5820`; `packages/opencode/src/kilocode/session/event.ts:18` |
| MCP local config shape `{type:"local",command[],cwd?,environment?,enabled?,timeout?}` | `packages/core/src/v1/config/mcp.ts:8-26` |
| MCP tool naming `sanitize` / `toolName` | `packages/opencode/src/mcp/catalog.ts:117-119` |
| Permission key cho MCP tool = tên đã namespace | `packages/opencode/src/session/tools.ts:502` |
| Custom tool scan `{tool,tools}/*.{js,ts}` | `packages/opencode/src/tool/registry.ts:267` |
| VS Code spawn `serve --port 0`, password, `KILO_PARENT_PID`, `KILO_CLIENT` | `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:100-153` |
| Port discovery 4097..4116 + `GET /global/health` | `packages/kilo-console/src/client.ts:125,278-305` |
| `kilo attach <url>` với `--password`/`--username` | `packages/opencode/src/cli/cmd/attach.ts:11-53` |
| `kilo run --attach <url>` + Basic headers | `packages/opencode/src/cli/cmd/run.ts:204-206,368-377` |
| SDK v2 client entry | `packages/sdk/js/src/v2/client.ts` |
| Custom tool dir scan KHÔNG gồm `.opencode/tool` | `packages/opencode/src/tool/registry.ts:267` (chỉ các config dir của Kilo) |
| `kilo-ui` host-agnostic: không `acquireVsCodeApi`/`asWebviewUri`; theme id `kilo` | `packages/kilo-ui/src/theme/context.tsx:13`; grep `packages/kilo-ui/src` = 0 host API |
| `VSCodeProvider` seam và `acquireVsCodeApi` | `packages/kilo-vscode/webview-ui/src/context/vscode.tsx:18-19,47` |
| ~70 call site `useVSCode()` | `packages/kilo-vscode/webview-ui/src` (grep 2026-11-19) |
| Message union `WebviewMessage` / `ExtensionMessage` | `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts`; `extension-messages.ts` |
| Storybook render không cần VS Code | `packages/kilo-vscode/webview-ui/src/stories/StoryProviders.tsx` |
| CSP generator: nonce inline + `wasm-unsafe-eval` | `packages/kilo-vscode/src/utils.ts:123-124`; `packages/kilo-vscode/src/webview-html-utils.ts:34` |
| Visual regression của webview | `packages/kilo-vscode/tests/visual-regression.spec.ts` |
| esbuild plugin cho worker/alias/SVG/CSS | `packages/kilo-vscode/esbuild.js:459-463` |
| `kilo-console` chỉ là SPA cũ/transport reference, không có chat transcript | `packages/kilo-console` |
| Không có desktop/Electron source trong worktree | không có `packages/desktop` |

Ba dữ kiện được yêu cầu xác minh lại trong tài liệu này:

1. **Permission reply**: dùng `POST /permission/:requestID/reply` với body `{"reply":"once|always|reject","message?":string,"interactive?":boolean}`; SDK tương ứng là `client.permission.reply({ requestID, reply, directory?, workspace?, message?, interactive? })`. Route cũ `POST /session/:sessionID/permissions/:permissionID` với `{response}` vẫn tồn tại nhưng đã deprecated; client mới không dùng.
2. **Plugin hooks**: `"tool.execute.before"` nhận `input = {tool, sessionID, callID}` và `output = {args}`; `"tool.execute.after"` nhận `input = {tool, sessionID, callID, args}` và `output = {title, output, metadata}`. Tham số tool nằm trong `output.args` (before) và `input.args` (after).
3. **MCP tool naming**: `sanitize(value) = value.replace(/[^a-zA-Z0-9_-]/g, "_")`; `toolName(clientName, name) = sanitize(clientName) + "_" + sanitize(name)`. Với server key `browser`, shim đăng ký `status`; Kilo hiển thị và permission-gate `browser_status`. Permission key trong `ctx.ask` là tên đã namespace, không phải tên trần.

## Phụ lục B: Danh mục lỗi

| Code/kind | Text cho model | Text cho UI | Remediation |
|---|---|---|---|
| `-32700 PARSE_ERROR` | `[browser:protocol] Frame lỗi.` | "Lỗi giao thức nội bộ." | Gửi debug export |
| `-32600 INVALID_REQUEST` | `[browser:protocol] Request sai cấu trúc.` | "Lỗi giao thức nội bộ." | Gửi debug export |
| `-32601 METHOD_NOT_FOUND` | `[browser:unsupported] Tool không hỗ trợ.` | "Bridge cũ hơn extension." | Cập nhật bridge/extension |
| `-32602 INVALID_PARAMS` | `[browser:invalid_params] <field>: <reason>.` | "Tham số không hợp lệ." | Sửa params, không retry nguyên trạng |
| `-32001 UNAUTHORIZED` | `[browser:unauthorized] Token không hợp lệ.` | "Token hết hạn." | Pair lại |
| `-32001 APPROVAL_TIMEOUT` | `[browser:approval_timeout] Người dùng không duyệt.` | "Hết thời gian duyệt." | Yêu cầu lại nếu cần |
| `-32002 NOT_PAIRED` | `[browser:not_paired] Chưa pair.` | "Chưa kết nối extension." | Nhập code |
| `-32003 NO_TARGET` | `[browser:no_target] Không có tab.` | "Chưa chọn tab." | Chọn tab |
| `-32004 STALE_REF` | `[browser:stale_ref] Ref cũ.` | "Trang đã thay đổi." | Snapshot lại |
| `-32005 TIMEOUT` | `[browser:timeout] Quá thời gian.` | "Tool quá thời gian." | Kiểm tra app; tăng timeout <= 30s |
| `-32005 RATE_LIMIT` | `[browser:rate_limit] Quá nhiều call.` | "Thao tác quá nhanh." | Chờ 1 giây |
| `-32005 BUSY` | `[browser:busy] Tool khác đang chạy.` | "Đang xử lý call khác." | Chờ call hiện tại xong |
| `-32005 CANCELLED` | `[browser:cancelled] Call đã bị hủy.` | "Call đã hủy." | Chỉ thử lại nếu cần |
| `-32006 POLICY_DENIED` | `[browser:policy_denied] Bị policy chặn.` | "Origin/path bị chặn." | Thêm allowlist có chủ đích |
| `-32006 DEVTOOLS_CONFLICT` | `[browser:devtools_conflict] DevTools đang giữ tab.` | "Đóng DevTools." | Đóng DevTools, retry |
| `-32006 NETWORK_REFUSED` | `[browser:network_refused] Không kết nối được.` | "App không chạy." | Khởi động app đúng port |
| `-32006 LOOP_STOP` | `[browser:loop_stop] Dừng do <kind>.` | "Agent đã dừng vòng lặp." | Tổng kết và hỏi người dùng |
| `-32006 SHUTTING_DOWN` | `[browser:shutdown] Bridge đang tắt.` | "Bridge đã tắt." | Start lại |
| `-32006 KILO_UNAVAILABLE` | `[browser:kilo_unavailable] Kilo server không phản hồi.` | "Kilo server đã dừng." | Khởi động lại bridge |

## Phụ lục C: Future work

- Multi-tab: mỗi tab một CDP session, ref namespace `t<tabId>:eN`, network buffer riêng.
- Git commit sau khi sửa: chỉ khi người dùng bật, tạo commit nháp, không push.
- Chrome Web Store: package, privacy policy, review `debugger` permission, listing.
- Firefox: WebDriver BiDi hoặc adapter WebExtension; không dùng CDP.
- Cloud memory: đồng bộ `MEMORY.md` qua Kilo gateway, mã hóa, opt-in.
- OS sandbox: dùng `packages/kilo-sandbox` cho write; read jail vẫn là logic.
- Eval hardening: AST allowlist, không cho network call từ eval, pin thời gian chạy.
- Multi-client: nhiều extension (Chrome + Edge) với tab ownership.

## Phụ lục D: Từ điển event

| Event | Payload chính | Dùng ở đâu |
|---|---|---|
| `session.turn.close` | `{sessionID, reason: "completed"\|"error"\|"interrupted"\|"superseded"}` | Kết thúc turn; dừng debug loop |
| `session.status` | `{sessionID, status: "idle"\|"busy"}` | Fallback khi thiếu `turn.close` |
| `permission.asked` | `{id, sessionID, permission, patterns, metadata, always, tool?}` | UI duyệt, log |
| `permission.replied` | `{sessionID, requestID, reply}` | Đồng bộ trạng thái duyệt |
| `session.diff` | diff của file trong session | Bằng chứng thay đổi source |
| `message.part.delta` | delta text của part | Relay cho UI channel (chat stream); `tool.*` và MCP không nhận |
| `server.connected` | `{}` | SSE mở thành công |
| `server.heartbeat` | `{}` mỗi 10 giây | Phát hiện SSE treo |
| `server.instance.disposed` | `{}` | Instance kết thúc; đóng relay |

---

[← Previous: UI reuse](./12-ui.md) · [Next: Đặc tả: Kilo Browser Agent](./README.md)
