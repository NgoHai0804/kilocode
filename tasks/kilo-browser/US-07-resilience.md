# US-07: Độ bền kết nối và giám sát tiến trình
> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-06](./US-06-memory.md) · Sau: [US-08](./US-08-security.md)

| Trường | Giá trị |
|---|---|
| ID | US-07 |
| Persona | Lập trình viên chạy phiên debug dài trong Chrome |
| Giá trị | Mất WS, DevTools chiếm tab hoặc `kilo serve` chết không làm treo phiên; agent nhận lỗi có thể hành động |
| Spec | [§8.1.4](../../docs/specs/kilo-browser/02-bridge.md) · [§8.1.5](../../docs/specs/kilo-browser/02-bridge.md) · [§8.3.3](../../docs/specs/kilo-browser/04-extension.md) · [§8.3.7](../../docs/specs/kilo-browser/04-extension.md) · [§10.5](../../docs/specs/kilo-browser/03-protocol-mcp.md) · [§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md) |
| Phụ thuộc | US-01, US-02 |
| Mốc | M3 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 3 ngày |
| AC | AC-15, AC-16 |

**Câu chuyện:** Là lập trình viên chạy phiên debug dài trong Chrome, tôi muốn extension tự nối lại và bridge tự giám sát `kilo serve`, để một lần SW bị suspend hay một cú crash không biến thành phiên treo im lặng.

## Bối cảnh

MV3 suspend service worker bất kỳ lúc nào, làm rơi WebSocket; extension phải dùng `chrome.alarms` 30 giây thay vì timer dài, và reconnect theo backoff có jitter ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md)). Phía bridge, WS heartbeat đóng kết nối khi không có `pong` trong 30 giây ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md)).

DevTools đang mở là nguyên nhân phổ biến khiến `chrome.debugger.attach` thất bại; spec yêu cầu map thành `DEVTOOLS_CONFLICT` với hướng dẫn đóng DevTools, không retry mù ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md), [§20](../../docs/specs/kilo-browser/11-risks-open-questions.md)). Bridge cũng phải restart `kilo serve` có ngân sách và dọn cây process để không để lại orphan ([§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).

## Phạm vi
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Reconnect WS, keepalive bằng `chrome.alarms`, heartbeat/ping | Thiết kế lại side panel ([US-09](./US-09-ux.md)) |
| `chrome.debugger.onDetach`, map `DEVTOOLS_CONFLICT` | Multi-tab và tab ownership ([Phụ lục C](../../docs/specs/kilo-browser/99-appendix.md)) |
| Timeout từng tool, queue, cancel, idempotency | OS sandbox hay read jail ([§12](../../docs/specs/kilo-browser/07-security-jail.md)) |
| Supervisor `kilo serve`, orphan cleanup, `Degraded` | Daemon hóa bridge ([§8.1.1](../../docs/specs/kilo-browser/02-bridge.md)) |

## Checklist

### Hợp đồng & dữ liệu
- [ ] Bảng xử lý close code `4000`, `4001`, `4002`, `4003`, `4004`, `4009` khớp §8.1.5; unit test từng code với hành vi transport tương ứng ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Backoff reconnect là 250ms, 500ms, 1s, 2s, 4s, 8s (cap 8s), jitter ±20%, tối đa 10 lần; unit test với RNG cố định ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Heartbeat: extension trả `pong` trong 2 giây; không nhận `ping` 30 giây thì đóng và reconnect; bridge đóng `4003` khi không có `pong` 30 giây ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md), [§8.1.5](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] `chrome.alarms` chu kỳ 30 giây kiểm tra WS và reconnect; không dùng `setTimeout` dài trong service worker ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Bảng timeout 12 tool khớp §9; shim timeout = tool timeout + 2000ms; test assert từng giá trị ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§8.2.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Một tool chạy tại một thời điểm; call thứ hai xếp hàng tối đa 5 giây rồi trả `-32005` kind `BUSY` ([§10.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Idempotency: `status`, `snapshot`, `console`, `network`, `wait_for` retry tự động tối đa 1 lần; `navigate`, `click`, `type`, `press`, `reload`, `eval` không bao giờ retry; cache `requestId` 60 giây ([§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Timeout gửi `browser.cancel {requestId}` best effort; extension bỏ kết quả đến muộn; caller nhận `-32005` kind `CANCELLED` ([§10.5](../../docs/specs/kilo-browser/03-protocol-mcp.md), [§8.2.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Lỗi attach `Another debugger is already attached` map thành `-32006` kind `DEVTOOLS_CONFLICT`, kèm text hành động được, không auto-retry ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md), [§8.3.11](../../docs/specs/kilo-browser/04-extension.md)).

### Implementation
- [ ] `extension/src/transport/ws.ts` kết nối `ws://127.0.0.1:<port>/ws`, subprotocol `kilo-browser.v1`, gửi `hello` bằng token đã lưu ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md), [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Nhận `4004` thì xóa token khỏi `chrome.storage.local` và đưa panel về trạng thái cần pair lại ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `extension/src/transport/keepalive.ts` đăng ký `chrome.alarms` và tự khôi phục token/`tabId` từ storage khi module được nạp lại sau suspend ([§8.3.2](../../docs/specs/kilo-browser/04-extension.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `extension/src/transport/detach.ts` đăng ký `chrome.debugger.onDetach`, xóa ref, đặt `tab=null`, call kế tiếp trả `-32003` ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Trước mỗi tool call, kiểm tra `chrome.debugger.getTargets()` còn target `attached:true`; nếu không, attach lại đúng một lần ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `src/bridge/supervisor.ts` spawn `kilo serve` với `windowsHide: true`, env `KILO_PARENT_PID`, parse `kilo server listening on`, timeout 20 giây, fallback `GET /global/health` ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Health poll 10 giây, timeout 3 giây; 3 lần fail liên tiếp thì SIGTERM, chờ 5 giây, SIGKILL; restart tối đa 5 lần trong 60 giây với backoff 1s, 2s, 4s, 8s, 8s rồi `Degraded` + `KILO_UNAVAILABLE` ([§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Trên Windows dùng `taskkill /PID <pid> /T /F` (spawn với `windowsHide: true`), trên POSIX kill process group; bridge thoát luôn kill cây và xóa `runtime.json` ([§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Bridge restart sinh token mới; extension nhận `4004` và pair lại; test hành vi này ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `Degraded` vẫn trả `browser_status`; tool khác trả lỗi có `retryable` thay vì treo ([§8.1.10](../../docs/specs/kilo-browser/02-bridge.md)).

### Test
- [ ] `bun test test/integration/restart/reconnect.test.ts`: fake extension mất WS, reconnect trong 30 giây, call sau thành công, log có `ws.open` mới; đây là AC-15 ([§17.2](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `bun test test/integration/restart/devtools-conflict.test.ts`: fake extension trả lỗi attach, bridge map `DEVTOOLS_CONFLICT` và không gửi retry thứ hai; đây là phần bridge của AC-16 ([§17.2](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `bun test test/unit/backoff.test.ts`: chuỗi delay đúng, cap 8 giây, dừng sau 10 lần, jitter nằm trong ±20%.
- [ ] `bun test test/unit/timeout.test.ts`: fake extension trả lời trễ quá timeout; caller nhận `-32005` và có `browser.cancel` ([§8.2.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] `bun test test/integration/restart/supervisor.test.ts`: kill `kilo serve`, thấy `kilo.exit` rồi `kilo.ready`, budget restart đúng, call sau thành công ([§17.2](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Test orphan: kill bridge, không còn `kilo serve` mang `KILO_PARENT_PID` cũ; `runtime.json` đã bị xóa ([§8.1.4](../../docs/specs/kilo-browser/02-bridge.md), [§20](../../docs/specs/kilo-browser/11-risks-open-questions.md)).
- [ ] Test idempotency: cùng `requestId` trong 60 giây trả kết quả cache; side effect chỉ chạy một lần ([§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).

### Tài liệu & vận hành
- [ ] Runbook ghi cách đọc `ws.close`, `pair.lockout`, `kilo.exit`, `kilo.ready` và budget restart ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md), [§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Runbook có mục "DevTools đang mở": đóng DevTools, Retry, không cần restart bridge ([§8.3.11](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ghi rõ mọi spawn trên Windows dùng `windowsHide: true` ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md), [§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).

## Acceptance (Given/When/Then)

### AC-15
- **Given:** Extension mất WS
- **When:** Bridge chờ 30 giây rồi extension reconnect
- **Then:** Tool call sau reconnect thành công; `ws.open` mới trong log

### AC-16
- **Given:** DevTools đang mở trên tab
- **When:** Gọi `browser_navigate`
- **Then:** Trả `-32006 kind:DEVTOOLS_CONFLICT`, UI hiện hướng dẫn đóng DevTools

## Verify
```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/backoff.test.ts
bun test test/unit/timeout.test.ts
bun test test/integration/restart/reconnect.test.ts
bun test test/integration/restart/devtools-conflict.test.ts
bun test test/integration/restart/supervisor.test.ts
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `extension/src/transport/ws.ts` | Sửa/mới: connect, hello, reconnect, close-code handling (handoff từ US-01) |
| `extension/src/transport/keepalive.ts` | Mới: `chrome.alarms` 30 giây, khôi phục sau suspend |
| `extension/src/transport/detach.ts` | Mới: `chrome.debugger.onDetach`, re-attach một lần |
| `extension/src/cdp/session.ts` | Re-attach và map tab (handoff từ US-02) |
| `src/bridge/supervisor.ts` | Mới: spawn, health poll, restart budget, kill tree |
| `src/bridge/ws.ts` | Heartbeat/pong và close-code hardening (handoff từ US-01) |
| `src/bridge/lifecycle.ts` | Shutdown/restart hook, xóa `runtime.json` (handoff từ US-01) |
| `test/unit/backoff.test.ts` | Mới |
| `test/unit/timeout.test.ts` | Mới |
| `test/integration/restart/reconnect.test.ts` | Mới: AC-15 |
| `test/integration/restart/devtools-conflict.test.ts` | Mới: AC-16 phần bridge |
| `test/integration/restart/supervisor.test.ts` | Mới: kill/restart, orphan |

## Definition of Done
- [ ] AC-15 và AC-16 xanh ở tầng bridge/transport.
- [ ] Reconnect không vượt quá 10 lần và không treo UI; có test backoff.
- [ ] DevTools conflict không retry mù; có test mapping.
- [ ] Timeout từng tool khớp bảng §9; có test timeout + cancel.
- [ ] `kilo serve` được restart trong budget 5 lần/60 giây; có test kill/restart.
- [ ] Không còn orphan `kilo serve` sau khi bridge thoát; có test.
- [ ] Mọi spawn trên Windows dùng `windowsHide: true`.

## Ghi chú & rủi ro
- MV3 SW suspend là rủi ro cao theo §20; `chrome.alarms` là cơ chế duy nhất đáng tin, không dựa vào timer ([§20](../../docs/specs/kilo-browser/11-risks-open-questions.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- Bridge restart làm token cũ vô hiệu; UI sẽ thấy `4004` và phải pair lại, không phải lỗi ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- `extension/src/transport/ws.ts`, `src/bridge/ws.ts` và `src/bridge/lifecycle.ts` handoff từ US-01; `extension/src/cdp/session.ts` handoff từ US-02. US-07 sở hữu phần hardening/reconnect.
- AC-16 cần UI thật để xác nhận text hướng dẫn; US này chứng minh mapping và trạng thái, phần UI thuộc US-09.

---

[← Trước: US-06: Workspace memory](./US-06-memory.md) · [Sau: US-08: Bảo mật](./US-08-security.md)