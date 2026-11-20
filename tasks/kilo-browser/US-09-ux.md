# US-09: Pairing, connection và approval UX trong UI tái dùng

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-14](./US-14-ui-parity.md) · Sau: [US-10](./US-10-e2e-release.md)

| Trường | Giá trị |
|---|---|
| ID | US-09 |
| Persona | Lập trình viên debug UI, không muốn đọc log thô |
| Giá trị | Pair, thấy trạng thái kết nối và duyệt đúng chỗ trong chat/settings tái dùng, không bị hỏi từng cú click |
| Spec | [§8.3.9](../../docs/specs/kilo-browser/04-extension.md) · [§8.3.10](../../docs/specs/kilo-browser/04-extension.md) · [§8.3.11](../../docs/specs/kilo-browser/04-extension.md) · [§22.1](../../docs/specs/kilo-browser/12-ui.md) · [§22.4](../../docs/specs/kilo-browser/12-ui.md) · [§22.5](../../docs/specs/kilo-browser/12-ui.md) |
| Phụ thuộc | US-13, US-04 |
| Mốc | M4 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 2–3 ngày |
| AC | AC-01, AC-11, AC-16, AC-21, AC-24 |

**Câu chuyện:** Là lập trình viên debug UI, tôi muốn pairing, banner kết nối và `PermissionDock`/`QuestionDock` nằm ngay trong chat/settings tái dùng, để pair nhanh, thấy mất kết nối, và chỉ duyệt khi thật sự nguy hiểm.

## Bối cảnh

§22.1 loại bỏ panel tối giản riêng: extension chỉ cung cấp host adapter và vỏ MV3, chat/settings dùng `ChatApp`/`SettingsApp` shared ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§8.3.8](../../docs/specs/kilo-browser/04-extension.md)). Vì vậy first-run pairing phải là một gate trong `ChatApp`, dùng control shared từ Settings, không dựng màn hình riêng ([§8.3.9](../../docs/specs/kilo-browser/04-extension.md), [§22.1](../../docs/specs/kilo-browser/12-ui.md)).

Approval dùng `PermissionDock`/`QuestionDock` từ `kilo-webview`, round-trip qua Port → SW → bridge → `POST /permission/:requestID/reply` ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)). AC-21 là ràng buộc trải nghiệm: chuỗi navigate + 3 interaction + reload trong origin allowlist không sinh `permission.asked` ([AC-21](../../docs/specs/kilo-browser/09-testing-acceptance.md)). AC-16 yêu cầu hướng dẫn đóng DevTools thay vì retry mù ([§8.3.11](../../docs/specs/kilo-browser/04-extension.md)).

Connection banner dùng `server.connected`/`server.heartbeat` và trạng thái Port/WS; reconnect theo US-12/US-07, UI chỉ hiển thị và cho Pair again ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| First-run pairing gate trong `ChatApp`, dùng control shared | Component/context/i18n shared ([US-11](./US-11-webview-extraction.md)) |
| Banner connection/reconnect, Pair again | Port/WS/host RPC ([US-12](./US-12-browser-host.md)) |
| `PermissionDock`/`QuestionDock` round-trip, scope, timeout | Approval engine/route denial ([US-04](./US-04-eval-gate.md)) |
| DevTools conflict guidance, error mapping có hành động | Chat transcript/settings parity ([US-14](./US-14-ui-parity.md)) |
| AC-24; secondary AC-01/11/16/21 | E2E harness/packaging ([US-10](./US-10-e2e-release.md)) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] First-run pairing là gate trong `ChatApp`, không phải panel tối giản; dùng control shared từ Settings trong `kilo-webview` ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§8.3.9](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Pairing nhận `pairCode` 6 chữ số, submit, thành công chuyển `Connected` trong ≤ 2 giây; sai code quay `Disconnected` ([§8.3.9](../../docs/specs/kilo-browser/04-extension.md), [AC-01](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Pairing timeout 120 giây quay `Disconnected`; 5 lần sai lockout 60 giây; UI không giữ token ([§8.3.8](../../docs/specs/kilo-browser/04-extension.md), [§8.1.3](../../docs/specs/kilo-browser/02-bridge.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Banner connection map `server.connected`/`server.heartbeat`/`ws.close`; hiện trạng thái và nút Pair again khi mất kết nối ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `PermissionDock` post `permissionResponse` → SW → bridge → `POST /permission/:requestID/reply`; kết quả hiển thị qua `permission.replied` ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `QuestionDock` round-trip tương tự; route question còn `(chưa xác nhận)` thì ẩn dock và trả `HOST_UNSUPPORTED` thay vì đoán ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§10.7](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Approval chỉ kích hoạt cho `browser_eval` khi policy `ask`, origin ngoài allowlist, và cảnh báo password-field ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Không approval cho `navigate`/`click`/`type`/`press`/`reload` trong origin allowlist; chuỗi AC-21 không sinh `permission.asked` ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md), [AC-21](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `Allow once` chỉ một call; `Allow for tab` đến khi đổi tab hoặc 15 phút; timeout 60 giây deny với `-32001` kind `APPROVAL_TIMEOUT`, không auto-retry ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] DevTools conflict hiện đúng hướng dẫn "Đóng DevTools của tab này rồi thử lại" + Retry, không auto-retry mù ([§8.3.11](../../docs/specs/kilo-browser/04-extension.md), [AC-16](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Error mapping §8.3.11 có hành động cụ thể (Retry, chọn tab, Pair again, mở Settings), không toast chung ([§8.3.11](../../docs/specs/kilo-browser/04-extension.md)).

### Implementation

- [ ] `extension/ui/pairing/**` render gate, validate 6 số, hiện lỗi code, xử lý Pair again; không giữ token ([§8.3.9](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `extension/ui/connection/**` render banner, trạng thái reconnect, nút Pair again; không tự attach lại tab đã đóng ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md), [§8.3.8](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `extension/ui/approval/**` bọc `PermissionDock`/`QuestionDock` shared; không copy component hay dựng modal riêng ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md), [§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Approval UI post message qua `HostBridge`, không gọi bridge/`kilo serve` trực tiếp ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§7.4](../../docs/specs/kilo-browser/01-architecture.md)).
- [ ] Pairing/connection/approval chỉ dùng file trong `extension/ui/{pairing,connection,approval}/**`; không claim file shared ([plan §4](./plan.md)).
- [ ] Khi SW suspend/Port đóng, banner giữ dữ liệu cuối và resync khi mở lại; không xóa trắng ([§22.4](../../docs/specs/kilo-browser/12-ui.md), [§8.3.8](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] A11y: focus trap trong dock, Esc = Deny, label gắn input, `aria-live` cho trạng thái ([§8.3.8](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Preview approval đã redact tối đa 500 ký tự; không hiện token/password kể cả khi `redactInUi` tắt ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md), [§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).

### Test

- [ ] AC-24: `browser_eval` policy `ask`, `PermissionDock` hiện, bấm Allow once, eval chạy, log approval ([AC-24](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] AC-01 secondary: pair code đúng → `hello.ok` ≤ 2 giây, token lưu `chrome.storage.local`, UI `Connected` ([AC-01](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] AC-11 secondary: `tools.eval:"ask"`, duyệt, `browser_eval {expression:"document.title"}` trả `value:"Login"`, log approval ([AC-11](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] AC-16 secondary: DevTools mở, navigate trả `DEVTOOLS_CONFLICT`, UI hiện hướng dẫn đóng DevTools ([AC-16](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] AC-21: origin allowlist, navigate + 3 interaction + reload không có `permission.asked`, `session.turn.close` reason `completed`; eval vẫn deny/ask ([AC-21](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Test pairing sai code/timeout/lockout; trạng thái quay đúng `Disconnected` ([§8.3.9](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Test connection banner: WS đóng, reconnect, Pair again; không auto-attach tab đã đóng ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Test approval scope/timeout: Allow once/Allow for tab, 60 giây → `APPROVAL_TIMEOUT`, không retry ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Chạy `bun run test:ui` khi harness US-10 sẵn sàng; file E2E thuộc US-10, US-09 cung cấp test id/luồng ([plan §4](./plan.md), [§22.10](../../docs/specs/kilo-browser/09-testing-acceptance.md)).

### Tài liệu & vận hành

- [ ] Ghi copy pairing/connection/approval + 7 lỗi §8.3.11 vào `packages/kilo-browser/docs/ui-pairing-approval.md` ([§8.3.11](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ghi ảnh/wireframe pairing gate, banner reconnect, `PermissionDock`, `QuestionDock` ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ghi checklist keyboard-only và cách Pair again khi token hết hạn ([§8.3.7](../../docs/specs/kilo-browser/04-extension.md)).

## Acceptance (Given/When/Then)

### AC-24
- **Given:** `browser_eval` policy `ask`, `PermissionDock` hiện
- **When:** Bấm Allow once
- **Then:** UI post `permissionResponse`; bridge gọi `POST /permission/:requestID/reply`; eval chạy và có log approval

### AC-01
- **Given:** Bridge đang chạy, pairing code còn hạn
- **When:** Extension gửi code đúng
- **Then:** `hello.ok` trong <= 2 giây, token lưu vào `chrome.storage.local`, panel hiện `Connected`

### AC-11
- **Given:** `tools.eval` là `ask`, người dùng duyệt
- **When:** Gọi `browser_eval {expression:"document.title"}`
- **Then:** Trả `value:"Login"`, có bản ghi approval trong log

### AC-16
- **Given:** DevTools đang mở trên tab
- **When:** Gọi `browser_navigate`
- **Then:** Trả `-32006 kind:DEVTOOLS_CONFLICT`, UI hiện hướng dẫn đóng DevTools

### AC-21
- **Given:** Origin nằm trong allowlist, session đã cấu hình
- **When:** Agent chạy `browser_navigate` + 3 interaction + `browser_reload`
- **Then:** Không có `permission.asked` nào cho chuỗi này, `session.turn.close` reason `completed`; `browser_eval` vẫn `deny` hoặc cần approval

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/ui/pairing.test.ts
bun test test/unit/ui/connection.test.ts
bun test test/unit/ui/approval-panel.test.ts
# E2E UI do US-10 sở hữu
bun run test:ui
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `extension/ui/pairing/**` | Mới: pairing gate, 6 số, lỗi, Pair again |
| `extension/ui/connection/**` | Mới: banner connection/reconnect |
| `extension/ui/approval/**` | Mới: bọc `PermissionDock`/`QuestionDock`, scope, timeout |
| `test/unit/ui/pairing.test.ts` | Mới: AC-01 secondary, sai code, timeout |
| `test/unit/ui/connection.test.ts` | Mới: banner/reconnect |
| `test/unit/ui/approval-panel.test.ts` | Mới: AC-24, scope, timeout |
| `packages/kilo-browser/docs/ui-pairing-approval.md` | Mới: copy, wireframe, keyboard |

## Definition of Done

- [ ] First-run pairing nằm trong `ChatApp`, dùng control shared từ Settings, không panel tối giản.
- [ ] Pair code đúng ≤ 2 giây, sai code/timeout/lockout có đường thoát (AC-01).
- [ ] Banner connection/reconnect + Pair again; không auto-attach tab đã đóng.
- [ ] `PermissionDock` round-trip đúng route, eval chạy và có log approval (AC-24, AC-11).
- [ ] DevTools conflict hiện hướng dẫn đóng DevTools (AC-16).
- [ ] Chuỗi origin allowlist không sinh `permission.asked` (AC-21).
- [ ] Không dựng modal/panel riêng; không sở hữu file shared.

## Ghi chú & rủi ro

- Approval của extension là gate trước CDP, không thay permission của Kilo; trộn hai thứ làm AC-21 fail ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md), [§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- Không claim file `kilo-webview`; `PermissionDock`/`QuestionDock` do US-11 cung cấp, US-09 chỉ bọc và nối Port ([plan §4](./plan.md)).
- `QuestionDock` phụ thuộc route question còn `(chưa xác nhận)`; nếu chưa xác minh, ẩn dock thay vì đoán endpoint ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- AC-16 cần Chrome thật để thấy infobar DevTools; unit test chỉ phủ mapping/banner ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- E2E UI nằm ở `test/e2e/ui/**` do US-10 sở hữu; US-09 không tạo file trùng ([plan §4](./plan.md)).

---

[← Trước: US-14: UI parity](./US-14-ui-parity.md) · [Sau: US-10: E2E và phát hành](./US-10-e2e-release.md)