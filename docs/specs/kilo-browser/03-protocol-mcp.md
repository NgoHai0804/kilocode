# MCP shim và protocol

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §8.2 và §10.

### 8.2 MCP shim (`kilo-browser-mcp`)

Shim là MCP server stdio do Kilo spawn từ `.kilo/kilo.json`. Server key là `browser`. Shim đăng ký **tên trần** (`status`, `navigate`, ...); Kilo áp công thức `sanitize(clientName) + "_" + sanitize(name)` để tạo tên trong tool list và permission key (`browser_status`, `browser_navigate`, ...), đúng 12 tool ở [mục 9](./05-tools-loop.md). Không đăng ký tên đã có tiền tố trong shim.

#### 8.2.1 Tool naming

| MCP tool name (shim) | Kilo-visible name | Bridge method |
|---|---|---|
| `status` | `browser_status` | `browser.status` |
| `navigate` | `browser_navigate` | `browser.navigate` |
| `snapshot` | `browser_snapshot` | `browser.snapshot` |
| `screenshot` | `browser_screenshot` | `browser.screenshot` |
| `console` | `browser_console` | `browser.console` |
| `network` | `browser_network` | `browser.network` |
| `click` | `browser_click` | `browser.click` |
| `type` | `browser_type` | `browser.type` |
| `press` | `browser_press` | `browser.press` |
| `reload` | `browser_reload` | `browser.reload` |
| `wait_for` | `browser_wait_for` | `browser.wait_for` |
| `eval` | `browser_eval` | `browser.eval` |

Công thức: `toolName(clientName, name) = sanitize(clientName) + "_" + sanitize(name)`, trong đó `sanitize` thay mọi ký tự ngoài `[a-zA-Z0-9_-]` bằng `_` (`packages/opencode/src/mcp/catalog.ts:117-119`). Vì server key là `browser`, shim phải đăng ký `status`, không phải `browser_status`; đăng ký `browser_status` sẽ tạo ra tên bị nhân đôi tiền tố (`browser_` + `browser_status`) — sai.

#### 8.2.2 Env vars

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `KILO_BROWSER_RUNTIME` | có (hoặc `--runtime`) | Đường dẫn tuyệt đối tới `runtime.json` |
| `KILO_BROWSER_URL` | không | Ghi đè `httpUrl` cho test |
| `KILO_BROWSER_TOKEN` | không | Ghi đè token cho test; không dùng trong production |
| `KILO_BROWSER_TIMEOUT_MS` | không | Timeout mặc định cho một tool call, mặc định `20000` |
| `KILO_BROWSER_SESSION` | không | Gắn mọi call với một `sessionID` để log |
| `KILO_BROWSER_LOG` | không | File JSONL riêng của shim; mặc định tắt |

#### 8.2.3 Forwarding

1. Đọc `runtime.json` lazy ở mỗi call, cache theo `mtime`; nếu thiếu hoặc không parse được, trả lỗi MCP `-32002 NOT_PAIRED` (retryable) và đọc lại ở call kế tiếp. Không cache lỗi vĩnh viễn.
2. Kiểm tra `httpUrl` là loopback (`127.0.0.1`, `localhost`, `::1`); từ chối URL khác.
3. Gọi `POST /tool` với `Authorization: Bearer`, `requestId` sinh từ `sessionID + callID` nếu có, timeout = tool timeout + 2000 ms.
4. Nếu HTTP trả 401, đọc lại `runtime.json` một lần (bridge có thể đã restart) rồi thử lại đúng một lần.
5. Trả MCP content; không retry các method không idempotent (`click`, `type`, `press`, `navigate`, `reload`, `eval`).

#### 8.2.4 Error mapping sang text cho model

| Nguồn | Text trả cho model |
|---|---|
| `-32001 UNAUTHORIZED` | `[browser:unauthorized] Bridge từ chối token. Chạy lại kilo-browser start và pair lại. Không thử lại tool này.` |
| `-32001 APPROVAL_TIMEOUT` | `[browser:approval_timeout] Người dùng không duyệt. Yêu cầu lại nếu cần; không retry tự động.` |
| `-32002 NOT_PAIRED` | `[browser:not_paired] Chưa có extension kết nối. Yêu cầu người dùng mở side panel và pair.` |
| `-32003 NO_TARGET` | `[browser:no_target] Không có tab hợp lệ. Gọi browser_status để kiểm tra, không đoán URL.` |
| `-32004 STALE_REF` | `[browser:stale_ref] Ref đã hết hạn sau snapshot mới. Gọi browser_snapshot rồi dùng ref mới.` |
| `-32005 TIMEOUT` | `[browser:timeout] Hết thời gian chờ. Kiểm tra app còn chạy; có thể tăng timeout tối đa 30000ms.` |
| `-32005 RATE_LIMIT` | `[browser:rate_limit] Quá nhiều call. Chờ 1 giây rồi thử lại.` |
| `-32005 BUSY` | `[browser:busy] Tool khác đang chạy. Chờ call hiện tại xong.` |
| `-32005 CANCELLED` | `[browser:cancelled] Call đã bị hủy. Chỉ thử lại nếu còn nhu cầu.` |
| `-32006 POLICY_DENIED` | `[browser:policy_denied] Bị policy/origin/path chặn. Không lách; hỏi người dùng nếu cần.` |
| `-32006 DEVTOOLS_CONFLICT` | `[browser:devtools_conflict] DevTools đang giữ tab. Yêu cầu đóng DevTools.` |
| `-32006 NETWORK_REFUSED` | `[browser:network_refused] Không kết nối được target. Kiểm tra app/port.` |
| `-32006 LOOP_STOP` | `[browser:loop_stop] Dừng do <kind>. Tổng kết bằng chứng.` |
| `-32006 SHUTTING_DOWN` | `[browser:shutting_down] Bridge đang tắt. Không retry trong turn này.` |
| `-32006 KILO_UNAVAILABLE` | `[browser:kilo_unavailable] Kilo server không phản hồi. Báo người dùng restart.` |
| `-32602 INVALID_PARAMS` | `[browser:invalid_params] <field> không hợp lệ: <reason>. Sửa tham số, không retry nguyên trạng.` |
| `-32601 METHOD_NOT_FOUND` | `[browser:unsupported] Tool không được hỗ trợ bởi bridge version này.` |
| `-32700 PARSE_ERROR` | `[browser:protocol] Lỗi framing nội bộ; báo người dùng gửi log.` |

Mọi text bắt đầu bằng `[browser:<kind>]`, nêu rõ có retry được hay không, và không chứa token/password.

#### 8.2.5 Content format

- `text/plain` cho mọi kết quả; JSON được render thành text gọn, không pretty-print quá 2 cấp.
- Screenshot trả hai content: `text` mô tả `{width,height,bytes,artifactPath}` và `image` với `mimeType:"image/png"`, `data` base64. Cap 2 MB sau encode; vượt thì trả text + artifact path, không trả image.
- Snapshot trả text dạng cây `role "name" [ref=eN]` và một dòng `snapshotId=<hash>`; không trả HTML thô.
- Khi kết quả bị truncate, thêm dòng cuối `truncated=true; X-Y/Z`.

#### 8.2.6 Timeout handling

Timeout của shim = timeout tool + 2000 ms. Khi hết giờ, shim gửi notification `browser.cancel {requestId}` (best effort) và trả `-32005`. Bridge hủy CDP command nếu còn; extension bỏ kết quả đến muộn. Không có retry tự động cho tool có side effect.

## 10. Protocol

### 10.1 Framing

- JSON-RPC 2.0 trên WebSocket text frame; mỗi frame đúng một message, không batch.
- `id` là string do bridge sinh (`req_<n>`) hoặc number nếu client là test; response phải giữ nguyên `id`.
- Notification không có `id`; dùng cho `ping`, `pong`, `browser.cancel`, `bridge.event`.
- Không dùng JSON-RPC batch; không gửi binary frame.

### 10.2 Methods

| Method | Direction | Params | Result |
|---|---|---|---|
| `hello` | ext → bridge | `{protocolVersion, pairCode?, bridgeToken?, extensionVersion, extensionId}` | `{ok, protocolVersion, token, heartbeatMs}` |
| `ping` / `pong` | hai chiều | `{}` | `{}` |
| `browser.status` | bridge → ext | `{}` | `{tab, paired, cdp}` |
| `browser.navigate` | bridge → ext | `{url, waitUntil?, timeoutMs?}` | `{url, title, status}` |
| `browser.snapshot` | bridge → ext | `{mode?, maxNodes?, selector?}` | `{snapshotId, refs, text}` |
| `browser.screenshot` | bridge → ext | `{fullPage?, format?, quality?, clip?}` | `{artifactId, width, height, bytes, data?}` |
| `browser.console` | bridge → ext | `{level?, sinceSeq?, limit?}` | `{entries, dropped}` |
| `browser.network` | bridge → ext | `{filter?, sinceSeq?, includeBodies?, limit?}` | `{requests, bodyDropped}` |
| `browser.click` | bridge → ext | `{ref?, selector?, button?, clickCount?}` | `{clicked, ref?, url}` |
| `browser.type` | bridge → ext | `{ref?, selector?, text, clear?, submit?}` | `{typed, submitted}` |
| `browser.press` | bridge → ext | `{key, ref?}` | `{pressed, url}` |
| `browser.reload` | bridge → ext | `{ignoreCache?, waitUntil?}` | `{url, status, durationMs}` |
| `browser.wait_for` | bridge → ext | `{text?, selector?, urlIncludes?, state?, timeoutMs?}` | `{matched, elapsedMs, url}` |
| `browser.eval` | bridge → ext | `{expression, awaitPromise?, returnByValue?}` | `{value, type, truncated}` |
| `browser.cancel` | bridge → ext | `{requestId}` | none (notification) |

### 10.3 Ví dụ

Request:

```json
{"jsonrpc":"2.0","id":"req_42","method":"browser.click","params":{"ref":"e7","button":"left","clickCount":1}}
```

Response:

```json
{"jsonrpc":"2.0","id":"req_42","result":{"clicked":true,"ref":"e7","url":"http://localhost:3000/"}}
```

Error:

```json
{"jsonrpc":"2.0","id":"req_42","error":{"code":-32004,"message":"STALE_REF","data":{"kind":"STALE_REF","snapshotId":"a1b2c3d4","retryable":true,"remediation":"Gọi browser_snapshot rồi dùng ref mới."}}}
```

Notification:

```json
{"jsonrpc":"2.0","method":"browser.cancel","params":{"requestId":"req_42"}}
```

### 10.4 Error codes

| Code | Kind | Ý nghĩa | Retryable |
|---|---|---|---|
| `-32700` | `PARSE_ERROR` | Frame không phải JSON hợp lệ | không |
| `-32600` | `INVALID_REQUEST` | Thiếu `jsonrpc`/`method`/`id` sai kiểu | không |
| `-32601` | `METHOD_NOT_FOUND` | Method không tồn tại ở version này | không |
| `-32602` | `INVALID_PARAMS` | Thiếu field, sai kiểu, vượt cap | không (sửa params) |
| `-32001` | `UNAUTHORIZED` | Token sai/hết hạn | có, sau khi pair |
| `-32001` | `APPROVAL_TIMEOUT` | Người dùng không duyệt hoặc không phản hồi | có, yêu cầu lại |
| `-32002` | `NOT_PAIRED` | Chưa có extension hello | có, sau khi pair |
| `-32003` | `NO_TARGET` | Không có tab hoặc tab đã đóng | có, sau khi chọn tab |
| `-32004` | `STALE_REF` | Ref thuộc snapshot cũ | có, sau snapshot mới |
| `-32005` | `TIMEOUT` | Hết thời gian tool | có, có thể tăng timeout |
| `-32005` | `RATE_LIMIT` | Vượt rate limit | có, sau khi chờ |
| `-32005` | `BUSY` | Tool khác đang chạy | có, sau khi chờ |
| `-32005` | `CANCELLED` | Call bị hủy | có, nếu còn nhu cầu |
| `-32006` | `POLICY_DENIED` | Policy/origin/path chặn | không, trừ khi đổi policy |
| `-32006` | `DEVTOOLS_CONFLICT` | DevTools giữ debugger | có, sau khi đóng DevTools |
| `-32006` | `NETWORK_REFUSED` | Không kết nối được target | có, sau khi sửa app |
| `-32006` | `LOOP_STOP` | Debug loop dừng theo ngân sách | không |
| `-32006` | `SHUTTING_DOWN` | Bridge đang tắt | có, sau khi start lại |
| `-32006` | `KILO_UNAVAILABLE` | Kilo server không phản hồi | có, sau khi restart |

### 10.5 Limits và cancel

- Payload tối đa 8 MB mỗi chiều; vượt thì đóng `4009` hoặc trả `-32602` nếu là params.
- Một tool chạy tại một thời điểm; call thứ hai xếp hàng tối đa 5 giây rồi `-32005` kind `BUSY`.
- Kết quả text > 256 KB bị truncate, thêm `truncated=true` và artifact path.
- `browser.cancel` hủy call đang chờ; extension bỏ kết quả đến muộn; bridge trả `-32005` kind `CANCELLED` cho caller.
- Không có streaming kết quả trong v1; screenshot/snapshot trả một lần.

### 10.6 Version negotiation và reconnect

- `protocolVersion` là `major.minor`; bridge chấp nhận cùng major và minor <= minor của bridge.
- Extension gửi version trong `hello`; mismatch → close `4002` kèm `{required, got}`.
- Bridge trả `bridgeVersion` và `protocolVersion` trong `hello.ok` và `GET /health`.
- Reconnect: extension giữ token, gửi `hello` lại; bridge không tạo token mới nếu token còn hạn và cùng `extensionId`.
- Idempotency: `status`, `snapshot`, `console`, `network`, `wait_for` được retry tự động tối đa 1 lần; `navigate`, `click`, `type`, `press`, `reload`, `eval` không bao giờ retry tự động.
- Cache idempotency: `requestId` giữ 60 giây; request trùng `requestId` trả kết quả cũ thay vì chạy lại.

### 10.7 UI channel và host RPC

UI channel không phải JSON-RPC tool. Nó dùng envelope riêng ở [§22.4](./12-ui.md), được multiplex trên cùng WS với `tool.*`:

| Channel | Nguồn hợp lệ | Dùng cho |
|---|---|---|
| `ui.*` | Chỉ SW, sau khi kiểm tra `port.sender.id` | chat, sessions, settings, permission/question, file/diff/url |
| `tool.*` | Bridge/tool executor | 12 tool `browser_*` |

- Bridge route theo channel (`ui.*` hoặc `tool.*`); method của tool vẫn là `browser.*`, không trộn hai namespace.
- SW là client duy nhất giữ WS; UI page không có token bridge và không gọi `kilo serve`.
- Bridge không gửi Kilo Basic credential qua `ui.*`; mọi thao tác config/session đi qua handler.
- `message.part.delta` chỉ chuyển cho `ui.*` để stream chat; `tool.*` không nhận delta.
- Không định nghĩa lại union `WebviewMessage`/`ExtensionMessage` ở đây; mapping chi tiết ở [§22.5](./12-ui.md).

Host RPC error dùng `ui.error.code` dạng chuỗi, không tái dùng JSON-RPC code:

| `ui.error.code` | Nghĩa | UI xử lý |
|---|---|---|
| `HOST_UNSUPPORTED` | Surface/method không có trong v1 | Ẩn nút, không retry |
| `HOST_CAPABILITY_DENIED` | Capability false hoặc setting chặn | Hiện lý do, không retry |
| `HOST_NOT_FOUND` | Session/file/request không tồn tại | Refresh list |
| `HOST_CONFIG_WRITE_FAILED` | Ghi config lỗi | Hiện lỗi, giữ form |
| `HOST_BAD_REQUEST` | Payload sai schema | Log, không retry |
| `HOST_BRIDGE_DOWN` | Bridge/WS không sẵn sàng | Reconnect banner |

---

[← Previous: Bridge](./02-bridge.md) · [Next: Chrome extension (MV3)](./04-extension.md)
