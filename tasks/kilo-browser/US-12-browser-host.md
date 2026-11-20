# US-12: Browser host adapter + bridge host RPC

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-11](./US-11-webview-extraction.md) · Sau: [US-13](./US-13-extension-ui-shell.md)

| Trường | Giá trị |
|---|---|
| ID | US-12 |
| Persona | Kỹ sư tích hợp browser host |
| Giá trị | UI shared nói chuyện được với bridge qua Port + host RPC, có capability và backpressure, mà UI không giữ token hay gọi `kilo serve` |
| Spec | [§22.4](../../docs/specs/kilo-browser/12-ui.md) · [§22.5](../../docs/specs/kilo-browser/12-ui.md) · [§22.6](../../docs/specs/kilo-browser/12-ui.md) · [§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md) · [§8.1.7](../../docs/specs/kilo-browser/02-bridge.md) |
| Phụ thuộc | US-01, US-11 |
| Mốc | M2 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 6–7 ngày |
| AC | Hỗ trợ AC-22, AC-23, AC-24 (không sở hữu AC chính) |

**Câu chuyện:** Là kỹ sư tích hợp browser host, tôi muốn UI page chỉ nói chuyện với service worker qua Port và SW nói chuyện với bridge qua đúng một WebSocket, để chat/settings/permission chạy trong MV3 mà không lộ credential và không phụ thuộc CORS của `kilo serve`.

## Bối cảnh

§22.4 chốt kiến trúc: UI page ⇄ SW qua `chrome.runtime.connect({ name: "kilo-ui" })`; SW ⇄ bridge qua đúng một WS đã pair; UI không bao giờ gọi `kilo serve` trực tiếp ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§7.4](../../docs/specs/kilo-browser/01-architecture.md)). §10.7 tách channel `ui.*`/`tool.*` và định nghĩa `ui.error.code`, gồm `HOST_UNSUPPORTED` ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).

Envelope Port là hợp đồng đóng băng của US này ([§22.4](../../docs/specs/kilo-browser/12-ui.md)):

```ts
type UiRequest  = { v: 1; id: string; kind: "request"; method: string; params?: unknown };
type UiResponse = { v: 1; id: string; kind: "response"; ok: boolean; result?: unknown; error?: { code: string; message: string } };
type UiEvent    = { v: 1; id: string; kind: "event"; event: string; payload: unknown };
```

Host RPC map theo §22.5, không thêm route ngoài spec ([§22.5](../../docs/specs/kilo-browser/12-ui.md)):

| Nhóm | Handler | Route/action |
|---|---|---|
| Hello/capability | `ui.hello` | trả capabilities + config snapshot, không token |
| Session/prompt | `ui.session.prompt` | `POST /session`, `POST /session/:id/message` hoặc `POST /session/:id/prompt_async` |
| Abort | `ui.session.abort` | `POST /session/:id/abort?scope=session\|tree` |
| Session list/messages | `ui.session.list` | `GET /session`, `GET /session/:id/message` |
| Permission | `ui.permission.reply` | `POST /permission/:requestID/reply` |
| Question | `ui.question.reply` | route question `(chưa xác nhận)` |
| Config/settings | `ui.config.write` | đọc snapshot trong `ui.hello`; ghi `.kilo/kilo.json` / global config qua bridge |
| Providers/models/auth | `ui.providers.list` | provider list/config `(chưa xác nhận)` |
| MCP status/actions | `ui.mcp.update` | status đọc từ config snapshot; action `POST /mcp` + config file |
| History | `ui.history.list` | sessions + index `chrome.storage.local` |
| Profile/login | `ui.profile.*` | gateway auth `(chưa xác nhận)` |
| File/diff/url/paths/clipboard | `ui.file.open`, `ui.file.diff`, `ui.url.open`, `ui.files.validate`, `ui.clipboard.*` | bridge jail, `kilo-ui`, `chrome.tabs.create`, `navigator.clipboard` |

Capability false không silent no-op cho hành động có side effect; bridge trả `ui.error` với `code:"HOST_UNSUPPORTED"` và UI ẩn surface ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Port protocol UI ⇄ SW, envelope, id, subscribe, backpressure, reconnect sau SW suspend | Vỏ Vite/MV3/CSP ([US-13](./US-13-extension-ui-shell.md)) |
| Một WS `ui.*`/`tool.*`, host RPC sessions/config/providers/permission/questions/MCP/history/profile/file/diff/clipboard | Component chat/settings và parity surface ([US-14](./US-14-ui-parity.md)) |
| SSE → `ExtensionMessage`, capability trong `ready`, `HOST_UNSUPPORTED` | Pairing/approval UX ([US-09](./US-09-ux.md)) |
| Test fake UI + real bridge + fake extension | Build/package/beta ([US-10](./US-10-e2e-release.md)) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] UI mở Port đúng `chrome.runtime.connect({ name: "kilo-ui" })`; SW chỉ chấp nhận `port.sender.id === chrome.runtime.id` ([§22.4](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Envelope `UiRequest`/`UiResponse`/`UiEvent` giữ nguyên `v:1`, `id`, `kind`; response trả đúng `id`; event có `id` riêng, không tái dùng id request ([§22.4](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Backpressure high-water 1 MB hoặc 256 message; vượt thì pause event không critical và coalesce delta, không drop response ([§22.4](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Reconnect Port khi `visibilitychange`; gửi `ui.hello {lastSeq}`; SW resync sessions/messages sau suspend ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] SW giữ state tạm trong `chrome.storage.session`; page mở lại không mất session/scroll/draft ngắn hạn ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§13.6](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Chỉ một SW giữ WS; nhiều page dùng chung Port; bridge chỉ chấp nhận token đã pair; UI không có token bridge ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] SW multiplex đúng channel `ui.*` cho chat/settings/approval và `tool.*` cho tool call; method tool vẫn là `browser.*`, không trộn namespace ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] `ui.session.prompt` tạo session mới bằng `POST /session` và gửi prompt bằng `POST /session/:id/message` hoặc `POST /session/:id/prompt_async`; stream qua SSE, không chờ blocking ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§8.1.7](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] `ui.session.abort` gọi `POST /session/:id/abort?scope=session|tree`; kết thúc turn phát `session.turn.close` ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `ui.permission.reply` gọi đúng `POST /permission/:requestID/reply`, body `{reply, message?, interactive?}` với `reply: "once"|"always"|"reject"` ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [Phụ lục A](../../docs/specs/kilo-browser/99-appendix.md)).
- [ ] `ui.config.write` ghi project `.kilo/kilo.json` hoặc global config qua bridge; không ghi secret vào log; config snapshot trong `ui.hello` không chứa token ([§13.6](../../docs/specs/kilo-browser/08-config-observability.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `ui.providers.list`, `ui.question.reply`, `ui.profile.*`, xóa session giữ đúng route spec hoặc trả `HOST_UNSUPPORTED` khi route còn `(chưa xác nhận)` ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Capability map trong `HostCapabilities` được trả trong `ready`/`ui.hello`; surface false không render nút chết ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Mọi handler thiếu trong v1 trả `ui.error.code:"HOST_UNSUPPORTED"`; không silent no-op cho hành động có side effect ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] SSE → `ExtensionMessage` map `message.part.delta`, `session.turn.close`, `permission.asked`, `permission.replied`, `session.diff`, `todo.updated`; `message.part.delta` chỉ đi channel `ui.*` ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md), [Phụ lục D](../../docs/specs/kilo-browser/99-appendix.md)).

### Implementation

- [ ] `extension/ui/host.ts` implement `BrowserHostBridge` đúng `HostBridge`: `post`, `subscribe`, `getState`/`setState`, `sidebarSide`, `active`, `clipboard`, `openExternal`, `openFile`, `openDiff`, `validateFiles` ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§22.9](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `extension/src/ui-port.ts` route Port → `ui.*` handler; giữ `id`, trả response/event; log `ui.port.open`/`ui.port.close`/`ui.rpc.*` ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] `src/host/router.ts` nhận `ui.*`, kiểm tra capability, dispatch handler; từ chối method lạ bằng `HOST_UNSUPPORTED` ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] `src/host/handlers.ts` phủ sessions, prompt, abort, config, providers/models/auth, permission, questions, MCP, history, profile/login, file read, diff, validate paths, clipboard ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `src/host/events.ts` map SSE → `ExtensionMessage`; `todo.updated` forward nguyên payload, không đổi schema ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `src/bridge/ui-rpc.ts`/`ui-events.ts` nối host RPC vào bridge server do US-01 sở hữu; không sửa `src/bridge/server.ts` ngoài wiring tối thiểu ([§15](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Local history index ghi `chrome.storage.local`; không đồng bộ cloud; giữ thứ tự session ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§13.6](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Profile/login giữ token gateway trong SW memory/local có TTL; không vào log/artifact/runtime.json ([§13.6](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] `openExternal` chỉ cho `http:`/`https:` qua `chrome.tabs.create`; `openFile`/`openDiff` chỉ đọc trong jail ([§22.9](../../docs/specs/kilo-browser/12-ui.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Không có đường nào từ UI page gọi trực tiếp `kilo serve`; mọi thứ đi qua Port → SW → bridge ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§7.4](../../docs/specs/kilo-browser/01-architecture.md)).

### Test

- [ ] Integration `fake UI Port + real bridge + fake extension`: `ui.hello`, `ui.session.prompt`, `ui.config.write`, `ui.permission.reply` giữ `id` và trả đúng `ui.error.code` ([§17.2](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Test envelope: response/event ordering, id không đổi, event không chiếm id request ([§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.4](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Test backpressure: vượt 1 MB/256 message thì coalesce delta, không mất response ([§22.4](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Test reconnect/suspend: Port đóng, mở lại với `ui.hello {lastSeq}`, resync session/messages ([§22.4](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Test capability: false → UI ẩn surface; method unsupported → `HOST_UNSUPPORTED`, không retry ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md), [AC-26](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Test SSE mapping: `message.part.delta` chỉ tới `ui.*`; `session.turn.close`, `permission.asked/replied`, `session.diff`, `todo.updated` tới đúng consumer ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Test bảo mật: `sender.id` khác bị từ chối; UI không có token bridge; log không chứa token/password ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).

### Tài liệu & vận hành

- [ ] Ghi bảng `ui.*` handler, route tương ứng và `ui.error.code` vào `packages/kilo-browser/docs/ui-host-rpc.md` ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Ghi rõ route còn `(chưa xác nhận)` và hành vi `HOST_UNSUPPORTED` để US-14/US-09 ẩn surface ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Ghi JSONL event mới `ui.port.*`, `ui.rpc.*`, `ui.capability.hide` ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Ghi chú version skew `protocolVersion`/`uiVersion` trong `hello` ([§22.11](../../docs/specs/kilo-browser/12-ui.md), [§20](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

## Acceptance (Given/When/Then)

US-12 không sở hữu AC chính. Host RPC/Port là điều kiện cần cho các AC sau, được US-14/US-09 xác nhận end-to-end:

| AC | Vai trò của US-12 |
|---|---|
| AC-22 | Cung cấp `ui.session.prompt` và stream `message.part.delta` tới `MessageList`/`PromptInput` shared |
| AC-23 | Cung cấp `ui.config.write` để bridge ghi config thật và Settings đọc lại |
| AC-24 | Cung cấp `ui.permission.reply` → `POST /permission/:requestID/reply` cho `PermissionDock` |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/ui-host.test.ts
bun test test/integration/host-rpc.test.ts
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `extension/ui/host.ts` | Mới: `BrowserHostBridge` implement `HostBridge` |
| `extension/src/ui-port.ts` | Mới: Port router `kilo-ui`, envelope, backpressure |
| `src/host/router.ts` | Mới: dispatch `ui.*`, capability, `HOST_UNSUPPORTED` |
| `src/host/handlers.ts` | Mới: sessions/prompt/abort/config/providers/permission/questions/MCP/history/profile/file/diff/clipboard |
| `src/host/events.ts` | Mới: SSE → `ExtensionMessage` |
| `src/host/capabilities.ts` | Mới: map capability → surface |
| `src/bridge/ui-rpc.ts` | Mới: nối host RPC vào WS bridge |
| `src/bridge/ui-events.ts` | Mới: phát event `ui.*` |
| `test/unit/ui-host.test.ts` | Mới: envelope, backpressure, capability |
| `test/integration/host-rpc.test.ts` | Mới: fake UI + real bridge + fake extension |
| `packages/kilo-browser/docs/ui-host-rpc.md` | Mới: mapping và lỗi |

## Definition of Done

- [ ] UI page không có token bridge và không gọi `kilo serve`; mọi request đi Port → SW → bridge.
- [ ] Envelope giữ `v/id/kind`; response đúng id; event ordering và backpressure có test.
- [ ] Reconnect sau SW suspend resync được session/messages bằng `ui.hello {lastSeq}`.
- [ ] Host RPC phủ đủ nhóm §22.5; permission reply đúng route/body; unsupported trả `HOST_UNSUPPORTED`.
- [ ] Capability trả trong `ready`; surface false không render.
- [ ] SSE mapping có `message.part.delta`, `session.turn.close`, `permission.asked/replied`, `session.diff`, `todo.updated`.
- [ ] Test fake UI + real bridge + fake extension xanh; không log secret.

## Ghi chú & rủi ro

- `todo.updated` không xuất hiện trong bảng §22.5/Phụ lục D của spec 0.3.0; US này forward nguyên payload khi SSE thực tế phát, không thêm route/type mới. Đây là gap cần spec bổ sung nếu muốn test chính thức.
- `ui.question.reply`, provider list/config, profile/login và xóa session còn `(chưa xác nhận)` trong §22.5; nếu chưa xác minh thì trả `HOST_UNSUPPORTED` thay vì đoán route ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- SW bị suspend là rủi ro MV3; dùng `chrome.alarms` + state trong storage, không dựa vào timer trong SW ([§20](../../docs/specs/kilo-browser/11-risks-open-questions.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- `message.part.delta` chỉ dành cho `ui.*`; không đẩy sang `tool.*` hay MCP ([§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- Không sửa `src/bridge/server.ts`/`extension/src/background/service-worker.ts` ngoài wiring; hai file đó thuộc US-01, handoff theo wave ([plan §4](./plan.md)).

---

[← Trước: US-11: Extraction](./US-11-webview-extraction.md) · [Tiếp: US-13: UI shell](./US-13-extension-ui-shell.md)